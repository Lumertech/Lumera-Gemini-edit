import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import {
  assertAllowedPatientDocument,
  assertOwnedStorageKey,
  detectPatientDocumentMime,
  PATIENT_DOC_MAX_BYTES,
  PATIENT_DOC_SIGNED_URL_TTL_MS,
  PATIENT_DOCS_UNAVAILABLE_ERROR,
  readStoredPatientDocument,
  storePatientDocumentBytes,
} from "./patient-documents.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

function createClinicUser(label: string, role: "doctor" | "receptionist" | "CLINIC_ADMIN" = "doctor") {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const email = `${label}.${suffix}@patient-docs.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Clinic ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(
    userId,
    tenantId,
    email,
    hashPassword("Lumera@2026"),
    `${label} user`,
    role,
    `+91 90000 ${label.slice(0, 5).padEnd(5, "0")}`,
    `Clinic ${label}`,
    now,
    now
  );
  return { tenantId, userId, email, role };
}

function pdfBytes(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
}

function pngBytes(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
}

function heicBytes(): Buffer {
  return Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from("ftypheicheic")]);
}

describe("patient document bytes", () => {
  it("accepts PDF, JPEG, PNG, and HEIC magic and rejects other types and oversize files", () => {
    assert.equal(detectPatientDocumentMime(pdfBytes()), "application/pdf");
    assert.equal(detectPatientDocumentMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
    assert.equal(detectPatientDocumentMime(pngBytes()), "image/png");
    assert.equal(detectPatientDocumentMime(heicBytes()), "image/heic");
    assert.equal(assertAllowedPatientDocument(pdfBytes(), "application/pdf"), "application/pdf");
    assert.equal(assertAllowedPatientDocument(Buffer.from([0xff, 0xd8, 0xff]), "image/jpg"), "image/jpeg");
    assert.equal(assertAllowedPatientDocument(heicBytes(), ""), "image/heic");
    assert.throws(() => assertAllowedPatientDocument(Buffer.from("hello"), "text/plain"), /not allowed/);
    assert.throws(() => assertAllowedPatientDocument(pngBytes(), "application/pdf"), /do not match/);
    assert.throws(() => assertAllowedPatientDocument(Buffer.from("GIF89a"), "image/gif"), /not allowed/);
    const tooBig = Buffer.alloc(PATIENT_DOC_MAX_BYTES + 1);
    tooBig.write("%PDF-");
    assert.throws(() => assertAllowedPatientDocument(tooBig, "application/pdf"), /10 MB/);
    assert.equal(PATIENT_DOC_SIGNED_URL_TTL_MS, 5 * 60 * 1000);
  });

  it("refuses a storage key that escapes the tenant directory", () => {
    assert.throws(() => assertOwnedStorageKey("../etc/passwd", "tenant-a"), /not found/);
    assert.throws(() => assertOwnedStorageKey("tenant-b/pat-1/file", "tenant-a"), /not found/);
    assert.throws(() => assertOwnedStorageKey("tenant-a/pat-1/../../secret", "tenant-a"), /not found/);
    assert.doesNotThrow(() => assertOwnedStorageKey("tenant-a/pat-1/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "tenant-a"));
  });
});

describe("patient document API", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  let docsDir = "";
  const previousDir = process.env.PATIENT_DOCS_DIR;
  const previousBucket = process.env.PATIENT_DOCS_GCS_BUCKET;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-patient-docs";
    docsDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumera-patient-docs-"));
    process.env.PATIENT_DOCS_DIR = docsDir;
    delete process.env.PATIENT_DOCS_GCS_BUCKET;
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    await close?.();
    if (previousDir === undefined) delete process.env.PATIENT_DOCS_DIR;
    else process.env.PATIENT_DOCS_DIR = previousDir;
    if (previousBucket === undefined) delete process.env.PATIENT_DOCS_GCS_BUCKET;
    else process.env.PATIENT_DOCS_GCS_BUCKET = previousBucket;
    fs.rmSync(docsDir, { recursive: true, force: true });
  });

  async function login(email: string): Promise<string> {
    const loginRes = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(loginRes.status, 200, String(loginRes.json.error || "login failed"));
    return String(loginRes.json.token || "");
  }

  async function upload(
    token: string,
    patientId: string,
    bytes: Buffer,
    fields: { filename: string; mime: string; title: string; docType: string; documentDate: string }
  ) {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(bytes)], fields.filename, { type: fields.mime }));
    form.set("title", fields.title);
    form.set("docType", fields.docType);
    form.set("documentDate", fields.documentDate);
    const res = await fetch(`http://127.0.0.1:${port}/api/patients/${patientId}/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, json };
  }

  it("stores private files for the session tenant and rejects other tenants and bad types", async () => {
    const clinicA = createClinicUser("docs-a", "doctor");
    const otherDoctor = createClinicUser("docs-a2", "doctor");
    getDb().prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(clinicA.tenantId, otherDoctor.userId);
    const admin = createClinicUser("docs-admin", "CLINIC_ADMIN");
    getDb().prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(clinicA.tenantId, admin.userId);
    const desk = createClinicUser("docs-desk", "receptionist");
    getDb().prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(clinicA.tenantId, desk.userId);
    const clinicB = createClinicUser("docs-b", "doctor");

    const tokenA = await login(clinicA.email);
    const tokenOther = await login(otherDoctor.email);
    const tokenAdmin = await login(admin.email);
    const tokenDesk = await login(desk.email);
    const tokenB = await login(clinicB.email);

    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Doc Patient Nair", phone: "+91 98111 33344", age: 41, gender: "Female" },
      { Authorization: `Bearer ${tokenA}` }
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);

    const bad = await upload(tokenA, patientId, Buffer.from("not a report"), {
      filename: "notes.txt",
      mime: "text/plain",
      title: "Secret notes that must not store",
      docType: "other",
      documentDate: "2026-09-01",
    });
    assert.equal(bad.status, 400);
    assert.match(String(bad.json.error), /not allowed/);

    const mismatched = await upload(tokenA, patientId, pngBytes(), {
      filename: "report.pdf",
      mime: "application/pdf",
      title: "Fake PDF",
      docType: "lab_report",
      documentDate: "2026-09-02",
    });
    assert.equal(mismatched.status, 400);
    assert.match(String(mismatched.json.error), /do not match/);

    const storedTitle = "Private CBC for Doc Patient";
    const pdf = await upload(tokenA, patientId, pdfBytes(), {
      filename: "onlyasha-secret.pdf",
      mime: "application/pdf",
      title: storedTitle,
      docType: "lab_report",
      documentDate: "2026-09-03",
    });
    assert.equal(pdf.status, 201, String(pdf.json.error || ""));
    const pdfDoc = pdf.json.document as { id: string; uploadedByName: string; canDelete: boolean; mimeType: string };
    assert.equal(pdfDoc.canDelete, true);
    assert.equal(pdfDoc.mimeType, "application/pdf");
    assert.equal(pdfDoc.uploadedByName, "docs-a user");
    assert.equal("storageKey" in (pdf.json.document as object), false);
    assert.equal(JSON.stringify(pdf.json).includes("/uploads"), false);
    assert.equal(JSON.stringify(pdf.json).includes("http"), false);

    const image = await upload(tokenDesk, patientId, pngBytes(), {
      filename: "wound.png",
      mime: "image/png",
      title: "Desk wound photo",
      docType: "imaging",
      documentDate: "2026-09-04",
    });
    assert.equal(image.status, 201, String(image.json.error || ""));
    const imageDoc = image.json.document as { id: string; canDelete: boolean };
    assert.equal(imageDoc.canDelete, true);

    const row = getDb()
      .prepare("SELECT storage_key, storage_backend, mime_type FROM patient_documents WHERE id = ?")
      .get(pdfDoc.id) as { storage_key: string; storage_backend: string; mime_type: string };
    assert.equal(row.storage_backend, "local");
    assert.equal(row.storage_key.startsWith(`${clinicA.tenantId}/`), true);
    const full = path.join(docsDir, row.storage_key);
    assert.equal(fs.existsSync(full), true);
    assert.equal(full.includes(`${path.sep}uploads${path.sep}`), false);
    assert.equal(fs.readFileSync(full).subarray(0, 5).toString(), "%PDF-");

    const list = await jsonRequest(port, "GET", `/api/patients/${patientId}/documents`, undefined, {
      Authorization: `Bearer ${tokenA}`,
    });
    assert.equal(list.status, 200);
    const titles = ((list.json.documents as Array<{ title: string }>) || []).map((doc) => doc.title);
    assert.equal(titles.includes(storedTitle), true);
    assert.equal(titles.includes("Secret notes that must not store"), false);
    const listBody = JSON.stringify(list.json);
    assert.equal(listBody.includes("storageKey"), false);
    assert.equal(listBody.includes("storage_key"), false);
    assert.equal(listBody.includes("/uploads"), false);
    assert.equal(listBody.includes("http://"), false);
    assert.equal(listBody.includes("https://"), false);

    const otherList = await jsonRequest(port, "GET", `/api/patients/${patientId}/documents`, undefined, {
      Authorization: `Bearer ${tokenOther}`,
    });
    assert.equal(otherList.status, 200);
    const otherRow = ((otherList.json.documents as Array<{ id: string; canDelete: boolean }>) || []).find(
      (doc) => doc.id === pdfDoc.id
    );
    assert.equal(otherRow?.canDelete, false);

    for (const headers of [{ Authorization: `Bearer ${tokenB}` }]) {
      const stolenList = await jsonRequest(port, "GET", `/api/patients/${patientId}/documents`, undefined, headers);
      assert.equal(stolenList.status, 404);
      const stolenBody = JSON.stringify(stolenList.json);
      assert.equal(stolenBody.includes(storedTitle), false);
      assert.equal(stolenBody.includes("onlyasha-secret"), false);
      assert.equal(stolenBody.includes("Doc Patient"), false);

      const stolenFile = await fetch(
        `http://127.0.0.1:${port}/api/patients/${patientId}/documents/${pdfDoc.id}/file`,
        { headers }
      );
      assert.equal(stolenFile.status, 404);
      const stolenFileBody = await stolenFile.text();
      assert.equal(stolenFileBody.includes(storedTitle), false);
      assert.equal(stolenFileBody.includes("%PDF"), false);

      const stolenDelete = await jsonRequest(
        port,
        "DELETE",
        `/api/patients/${patientId}/documents/${pdfDoc.id}`,
        undefined,
        headers
      );
      assert.equal(stolenDelete.status, 404);
      assert.equal(JSON.stringify(stolenDelete.json).includes(storedTitle), false);

      const stolenTicket = await jsonRequest(
        port,
        "POST",
        `/api/patients/${patientId}/documents/${pdfDoc.id}/preview-ticket`,
        {},
        headers
      );
      assert.equal(stolenTicket.status, 404);
    }

    const deniedDelete = await jsonRequest(
      port,
      "DELETE",
      `/api/patients/${patientId}/documents/${pdfDoc.id}`,
      undefined,
      { Authorization: `Bearer ${tokenOther}` }
    );
    assert.equal(deniedDelete.status, 403);
    const stillThere = getDb()
      .prepare("SELECT deleted_at FROM patient_documents WHERE id = ?")
      .get(pdfDoc.id) as { deleted_at: string | null };
    assert.equal(stillThere.deleted_at, null);

    const fileRes = await fetch(
      `http://127.0.0.1:${port}/api/patients/${patientId}/documents/${pdfDoc.id}/file?purpose=download`,
      { headers: { Authorization: `Bearer ${tokenA}` } }
    );
    assert.equal(fileRes.status, 200);
    assert.equal(fileRes.headers.get("content-type"), "application/pdf");
    assert.match(String(fileRes.headers.get("cache-control")), /private/);
    assert.equal(fileRes.headers.get("x-content-type-options"), "nosniff");
    const downloaded = Buffer.from(await fileRes.arrayBuffer());
    assert.equal(downloaded.subarray(0, 5).toString(), "%PDF-");
    assert.equal(String(fileRes.headers.get("content-disposition")).includes(row.storage_key), false);

    const ticket = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patientId}/documents/${pdfDoc.id}/preview-ticket`,
      {},
      { Authorization: `Bearer ${tokenA}` }
    );
    assert.equal(ticket.status, 200);
    const preview = await fetch(
      `http://127.0.0.1:${port}/api/patients/${patientId}/documents/${pdfDoc.id}/file?purpose=preview&ticket=${ticket.json.ticket}`
    );
    assert.equal(preview.status, 200);
    assert.equal(Buffer.from(await preview.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");

    const replay = await fetch(
      `http://127.0.0.1:${port}/api/patients/${patientId}/documents/${pdfDoc.id}/file?purpose=preview&ticket=${ticket.json.ticket}`
    );
    assert.equal(replay.status, 401);
    const rawTicket = String(ticket.json.ticket);
    const tokenHash = crypto.createHash("sha256").update(rawTicket).digest("hex");
    const storedTicket = getDb()
      .prepare("SELECT token_hash, used_at FROM patient_document_tickets WHERE token_hash = ?")
      .get(tokenHash) as { token_hash: string; used_at: string | null };
    assert.equal(storedTicket.token_hash, tokenHash);
    assert.equal(storedTicket.used_at != null && storedTicket.used_at.length > 0, true);
    const rawStored = getDb()
      .prepare("SELECT token_hash FROM patient_document_tickets WHERE token_hash = ?")
      .get(rawTicket);
    assert.equal(rawStored, undefined);

    const ticketOnOtherDoc = await fetch(
      `http://127.0.0.1:${port}/api/patients/${patientId}/documents/${imageDoc.id}/file?ticket=${ticket.json.ticket}`
    );
    assert.equal(ticketOnOtherDoc.status, 401);

    const bearerOverridesTicket = await fetch(
      `http://127.0.0.1:${port}/api/patients/${patientId}/documents/${pdfDoc.id}/file?ticket=${ticket.json.ticket}`,
      { headers: { Authorization: `Bearer ${tokenB}` } }
    );
    assert.equal(bearerOverridesTicket.status, 404);

    const audits = getDb()
      .prepare(
        `SELECT action FROM audit_logs
         WHERE user_id = ? AND action LIKE 'patient_document.%' AND details LIKE ?
         ORDER BY timestamp ASC`
      )
      .all(clinicA.userId, `%${pdfDoc.id}%`) as Array<{ action: string }>;
    const actions = audits.map((entry) => entry.action);
    assert.equal(actions.includes("patient_document.upload"), true);
    assert.equal(actions.includes("patient_document.view"), true);

    const removed = await jsonRequest(
      port,
      "DELETE",
      `/api/patients/${patientId}/documents/${imageDoc.id}`,
      undefined,
      { Authorization: `Bearer ${tokenDesk}` }
    );
    assert.equal(removed.status, 200);
    const adminRemoved = await jsonRequest(
      port,
      "DELETE",
      `/api/patients/${patientId}/documents/${pdfDoc.id}`,
      undefined,
      { Authorization: `Bearer ${tokenAdmin}` }
    );
    assert.equal(adminRemoved.status, 200);
    assert.equal(fs.existsSync(full), false);

    const afterDelete = await jsonRequest(port, "GET", `/api/patients/${patientId}/documents`, undefined, {
      Authorization: `Bearer ${tokenA}`,
    });
    assert.equal(afterDelete.status, 200);
    assert.deepEqual(afterDelete.json.documents, []);

    const deleteAudit = getDb()
      .prepare(
        `SELECT action FROM audit_logs
         WHERE action = 'patient_document.delete' AND details LIKE ?`
      )
      .all(`%${pdfDoc.id}%`) as Array<{ action: string }>;
    assert.equal(deleteAudit.length >= 1, true);

    const badAudit = getDb()
      .prepare("SELECT id FROM audit_logs WHERE details LIKE ?")
      .all("%Secret notes that must not store%") as unknown[];
    assert.equal(badAudit.length, 0);
  });

  it("returns 503 in production when the document bucket is unset and does not write local files", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const clinic = createClinicUser("docs-prod", "doctor");
    const token = await login(clinic.email);
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Prod Docs Patient", phone: "+91 98111 44455", age: 36, gender: "Male" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);
    const uploaded = await upload(token, patientId, pdfBytes(), {
      filename: "already-stored.pdf",
      mime: "application/pdf",
      title: "Stored before production",
      docType: "other",
      documentDate: "2026-09-05",
    });
    assert.equal(uploaded.status, 201, String(uploaded.json.error || ""));
    const docId = String((uploaded.json.document as { id: string }).id);
    const filesBefore = listFiles(docsDir);
    const rowsBefore = documentCount(patientId);

    process.env.NODE_ENV = "production";
    delete process.env.PATIENT_DOCS_GCS_BUCKET;
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumera-patient-docs-prod-"));
    const savedDocsDir = process.env.PATIENT_DOCS_DIR;
    try {
      const form = new FormData();
      form.set("file", new File([new Uint8Array(pdfBytes())], "blocked.pdf", { type: "application/pdf" }));
      form.set("title", "Must not land on disk");
      form.set("docType", "lab_report");
      form.set("documentDate", "2026-09-06");
      const denied = await fetch(`http://127.0.0.1:${port}/api/patients/${patientId}/documents`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const deniedJson = (await denied.json()) as { error?: string };
      assert.equal(denied.status, 503);
      assert.equal(deniedJson.error, PATIENT_DOCS_UNAVAILABLE_ERROR);
      assert.deepEqual(listFiles(docsDir), filesBefore);
      assert.equal(documentCount(patientId), rowsBefore);

      const read = await fetch(`http://127.0.0.1:${port}/api/patients/${patientId}/documents/${docId}/file`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const readBody = await read.text();
      assert.equal(read.status, 503);
      assert.match(readBody, /PATIENT_DOCS_GCS_BUCKET/);
      assert.equal(readBody.includes("%PDF"), false);

      process.env.PATIENT_DOCS_DIR = emptyDir;
      await assert.rejects(
        () => storePatientDocumentBytes(clinic.tenantId, patientId, pdfBytes(), "application/pdf"),
        (err: unknown) => {
          assert.equal(err instanceof Error ? err.message : "", PATIENT_DOCS_UNAVAILABLE_ERROR);
          assert.equal((err as { status?: number }).status, 503);
          return true;
        }
      );
      assert.deepEqual(listFiles(emptyDir), []);
      await assert.rejects(
        () => readStoredPatientDocument(clinic.tenantId, `${clinic.tenantId}/${patientId}/missingfile`, "local"),
        (err: unknown) => err instanceof Error && err.message === PATIENT_DOCS_UNAVAILABLE_ERROR
      );
      assert.deepEqual(listFiles(emptyDir), []);
    } finally {
      process.env.PATIENT_DOCS_DIR = savedDocsDir;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out.sort();
}

function documentCount(patientId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM patient_documents WHERE patient_id = ?")
    .get(patientId) as { n: number };
  return Number(row.n);
}

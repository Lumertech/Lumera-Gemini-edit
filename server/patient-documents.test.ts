import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import {
  assertAllowedPatientDocument,
  assertOwnedStorageKey,
  detectPatientDocumentMime,
  PATIENT_DOC_MAX_FILE_BYTES,
  PATIENT_DOC_MAX_PAGES,
  PATIENT_REPORT_MAX_BYTES,
  PATIENT_DOC_SIGNED_URL_TTL_MS,
  PATIENT_DOCS_UNAVAILABLE_ERROR,
  readBytesFromSignedUrl,
  readStoredPatientDocument,
  storePatientDocumentBytes,
} from "./patient-documents.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

function createClinicUser(
  label: string,
  role: "doctor" | "receptionist" | "CLINIC_ADMIN" | "admin" | "patient" = "doctor"
) {
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

function pdfBytes(pages = 1): Buffer {
  const body = Array.from({ length: pages }, () => "1 0 obj<</Type /Page>>endobj").join("\n");
  return Buffer.from(`%PDF-1.4\n${body}\ntrailer<<>>\n%%EOF`);
}

function pngBytes(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
}

function heicBytes(): Buffer {
  return Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from("ftypheicheic")]);
}

const ONE_PIXEL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGf/9k=",
  "base64"
);

/** Chrome Save-as-PDF puts page objects in a compressed object stream, so a text scan sees no /Type /Page. */
async function chromeSaveAsPdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Lab result page ${index + 1}`, { x: 48, y: 780, size: 12 });
  }
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}

/** A scanned report is a page of image bytes and no text operators. */
async function scannedPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  // pdf-lib reads JPEG markers from the underlying ArrayBuffer at offset 0.
  // A Node Buffer is often a view into a pool, so copy into a fresh Uint8Array.
  const image = await doc.embedJpg(new Uint8Array(ONE_PIXEL_JPEG));
  page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}

describe("patient document bytes", () => {
  it("accepts PDF, JPEG, and PNG and rejects HEIC, SVG, an 11 MB file, and reports over 20 pages", async () => {
    assert.equal(detectPatientDocumentMime(pdfBytes()), "application/pdf");
    assert.equal(detectPatientDocumentMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
    assert.equal(detectPatientDocumentMime(pngBytes()), "image/png");
    assert.equal(detectPatientDocumentMime(heicBytes()), null);
    assert.equal(await assertAllowedPatientDocument(pdfBytes(), "application/pdf"), "application/pdf");
    assert.equal(await assertAllowedPatientDocument(Buffer.from([0xff, 0xd8, 0xff]), "image/jpg"), "image/jpeg");
    await assert.rejects(() => assertAllowedPatientDocument(heicBytes(), "image/heic"), /not allowed/);
    await assert.rejects(
      () => assertAllowedPatientDocument(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), "image/svg+xml"),
      /not allowed/
    );
    await assert.rejects(
      () => assertAllowedPatientDocument(Buffer.from('<?xml version="1.0"?><svg></svg>'), "image/svg+xml"),
      /not allowed/
    );
    await assert.rejects(() => assertAllowedPatientDocument(Buffer.from("hello"), "text/plain"), /not allowed/);
    await assert.rejects(() => assertAllowedPatientDocument(pngBytes(), "application/pdf"), /do not match/);
    await assert.rejects(() => assertAllowedPatientDocument(Buffer.from("GIF89a"), "image/gif"), /not allowed/);
    const tooManyPages = await chromeSaveAsPdf(21);
    await assert.rejects(() => assertAllowedPatientDocument(tooManyPages, "application/pdf"), /20 pages/);
    const elevenMb = Buffer.alloc(11 * 1024 * 1024);
    elevenMb.write("%PDF-");
    await assert.rejects(() => assertAllowedPatientDocument(elevenMb, "application/pdf"), /10 MB/);
    assert.equal(PATIENT_DOC_MAX_FILE_BYTES, 10 * 1024 * 1024);
    assert.equal(PATIENT_REPORT_MAX_BYTES, 25 * 1024 * 1024);
    assert.equal(PATIENT_DOC_MAX_PAGES, 20);
    assert.equal(PATIENT_DOC_SIGNED_URL_TTL_MS, 5 * 60 * 1000);
  });

  it("counts Chrome Save-as-PDF object streams and a scanned image-only PDF, and accepts an unreadable PDF", async () => {
    const chrome = await chromeSaveAsPdf(2);
    assert.equal(chrome.toString("latin1").match(/\/Type\s*\/Page(?!s)/g), null);
    assert.equal(await assertAllowedPatientDocument(chrome, "application/pdf"), "application/pdf");
    const scanned = await scannedPdf();
    assert.equal(scanned.includes(Buffer.from("Lab result")), false);
    assert.equal(await assertAllowedPatientDocument(scanned, "application/pdf"), "application/pdf");
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const mime = await assertAllowedPatientDocument(Buffer.from("%PDF-1.4\nnot a real pdf\n%%EOF"), "application/pdf");
      assert.equal(mime, "application/pdf");
    } finally {
      console.warn = original;
    }
    assert.match(warnings.join("\n"), /page count unavailable/i);
  });

  it("refuses an expired signed URL and does not fetch it", async () => {
    let called = false;
    await assert.rejects(
      () =>
        readBytesFromSignedUrl("https://storage.example/object", Date.now() - 1000, async () => {
          called = true;
          return new Response("no");
        }),
      /expired/
    );
    assert.equal(called, false);
    await assert.rejects(
      () =>
        readBytesFromSignedUrl(
          "https://storage.example/object",
          Date.now() + 60_000,
          async () => new Response("denied", { status: 403 })
        ),
      /expired/
    );
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
    const granted = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patientId}/document-consent`,
      { language: "en", method: "staff_attested_verbal", attested: true },
      { Authorization: `Bearer ${tokenA}` }
    );
    assert.equal(granted.status, 201, String(granted.json.error || ""));

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
    assert.equal(pdfDoc.canDelete, false);
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
    assert.equal(imageDoc.canDelete, false);

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
      { Authorization: `Bearer ${tokenDesk}` }
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

    const expiring = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patientId}/documents/${pdfDoc.id}/preview-ticket`,
      {},
      { Authorization: `Bearer ${tokenA}` }
    );
    assert.equal(expiring.status, 200);
    const expiredHash = crypto.createHash("sha256").update(String(expiring.json.ticket)).digest("hex");
    getDb()
      .prepare("UPDATE patient_document_tickets SET expires_at = ? WHERE token_hash = ?")
      .run("2000-01-01T00:00:00.000Z", expiredHash);
    const expiredTicket = await fetch(
      `http://127.0.0.1:${port}/api/patients/${patientId}/documents/${pdfDoc.id}/file?ticket=${expiring.json.ticket}`
    );
    assert.equal(expiredTicket.status, 401);
    const unused = getDb()
      .prepare("SELECT used_at FROM patient_document_tickets WHERE token_hash = ?")
      .get(expiredHash) as { used_at: string | null };
    assert.equal(unused.used_at, null);

    const audits = getDb()
      .prepare(
        `SELECT action, tenant_id, patient_id, actor_role FROM audit_logs
         WHERE action LIKE 'patient_document.%' AND details LIKE ?
         ORDER BY timestamp ASC`
      )
      .all(`%${pdfDoc.id}%`) as Array<{
        action: string;
        tenant_id: string;
        patient_id: string;
        actor_role: string;
      }>;
    const actions = audits.map((entry) => entry.action);
    assert.equal(actions.includes("patient_document.upload"), true);
    assert.equal(actions.includes("patient_document.view"), true);
    for (const entry of audits.filter((row) => row.action === "patient_document.upload" || row.action === "patient_document.view")) {
      assert.equal(entry.tenant_id, clinicA.tenantId);
      assert.equal(entry.patient_id, patientId);
      assert.equal(entry.actor_role, "doctor");
    }

    const imageStored = getDb()
      .prepare("SELECT storage_key FROM patient_documents WHERE id = ?")
      .get(imageDoc.id) as { storage_key: string };
    const imageFull = path.join(docsDir, imageStored.storage_key);
    const removed = await jsonRequest(
      port,
      "DELETE",
      `/api/patients/${patientId}/documents/${imageDoc.id}`,
      undefined,
      { Authorization: `Bearer ${tokenOther}` }
    );
    assert.equal(removed.status, 403);
    const imageUntouched = getDb()
      .prepare("SELECT deleted_at FROM patient_documents WHERE id = ?")
      .get(imageDoc.id) as { deleted_at: string | null };
    assert.equal(imageUntouched.deleted_at, null);
    const adminRemovedImage = await jsonRequest(
      port,
      "DELETE",
      `/api/patients/${patientId}/documents/${imageDoc.id}`,
      undefined,
      { Authorization: `Bearer ${tokenAdmin}` }
    );
    assert.equal(adminRemovedImage.status, 200);
    assert.equal(fs.existsSync(imageFull), true);
    const imageDeleted = getDb()
      .prepare("SELECT deleted_at FROM patient_documents WHERE id = ?")
      .get(imageDoc.id) as { deleted_at: string | null };
    assert.equal(imageDeleted.deleted_at != null && imageDeleted.deleted_at.length > 0, true);
    const adminRemoved = await jsonRequest(
      port,
      "DELETE",
      `/api/patients/${patientId}/documents/${pdfDoc.id}`,
      undefined,
      { Authorization: `Bearer ${tokenAdmin}` }
    );
    assert.equal(adminRemoved.status, 200);
    assert.equal(fs.existsSync(full), true);
    const hidden = await fetch(`http://127.0.0.1:${port}/api/patients/${patientId}/documents/${pdfDoc.id}/file`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(hidden.status, 404);

    const afterDelete = await jsonRequest(port, "GET", `/api/patients/${patientId}/documents`, undefined, {
      Authorization: `Bearer ${tokenA}`,
    });
    assert.equal(afterDelete.status, 200);
    assert.deepEqual(afterDelete.json.documents, []);

    const deleteAudit = getDb()
      .prepare(
        `SELECT action, tenant_id, patient_id, actor_role FROM audit_logs
         WHERE action = 'patient_document.delete' AND details LIKE ?`
      )
      .all(`%${pdfDoc.id}%`) as Array<{
        action: string;
        tenant_id: string;
        patient_id: string;
        actor_role: string;
      }>;
    assert.equal(deleteAudit.length >= 1, true);
    assert.equal(deleteAudit[0].tenant_id, clinicA.tenantId);
    assert.equal(deleteAudit[0].patient_id, patientId);
    assert.equal(deleteAudit[0].actor_role, "CLINIC_ADMIN");

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
    const granted = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patientId}/document-consent`,
      { language: "en", method: "in_app", attested: true },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(granted.status, 201, String(granted.json.error || ""));
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

  it("returns 403 for admin and patient on patient, chart, document, and consent routes", async () => {
    const doctor = createClinicUser("docs-role-doctor", "doctor");
    const platform = createClinicUser("docs-role-admin", "admin");
    const portal = createClinicUser("docs-role-patient", "patient");
    const token = await login(doctor.email);
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Role Gate Nair", phone: "+91 98111 55501", age: 40, gender: "Female" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);
    const adminToken = await login(platform.email);
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    const staffOnly = [
      "/api/patients",
      `/api/patients/${patientId}`,
      `/api/patients/${patientId}/chart`,
      `/api/patients/${patientId}/documents`,
      `/api/patients/${patientId}/document-consent`,
    ];
    for (const route of staffOnly) {
      const res = await jsonRequest(port, "GET", route, undefined, adminHeaders);
      assert.equal(res.status, 403, route);
      assert.equal(res.json.code, "ROLE_DENIED", route);
      assert.equal(JSON.stringify(res.json).includes("Role Gate Nair"), false, route);
    }
    const adminConsent = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patientId}/document-consent`,
      { language: "en", method: "in_app", attested: true },
      adminHeaders
    );
    assert.equal(adminConsent.status, 403);
    assert.equal(adminConsent.json.code, "ROLE_DENIED");
    assert.equal(JSON.stringify(adminConsent.json).includes("Role Gate Nair"), false);

    const portalToken = await login(portal.email);
    const portalHeaders = { Authorization: `Bearer ${portalToken}` };
    for (const route of [
      "/api/patients",
      `/api/patients/${patientId}/documents`,
      `/api/patients/${patientId}/document-consent`,
    ]) {
      const res = await jsonRequest(port, "GET", route, undefined, portalHeaders);
      assert.equal(res.status, 403, route);
      assert.equal(res.json.code, "ROLE_DENIED", route);
      assert.equal(JSON.stringify(res.json).includes("Role Gate Nair"), false, route);
    }
    for (const route of [`/api/patients/${patientId}`, `/api/patients/${patientId}/chart`]) {
      const res = await jsonRequest(port, "GET", route, undefined, portalHeaders);
      assert.equal(res.status, 404, route);
      assert.equal(JSON.stringify(res.json).includes("Role Gate Nair"), false, route);
    }
    const portalConsent = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patientId}/document-consent`,
      { language: "en", method: "in_app", attested: true },
      portalHeaders
    );
    assert.equal(portalConsent.status, 403);
    assert.equal(portalConsent.json.code, "ROLE_DENIED");
    assert.equal(JSON.stringify(portalConsent.json).includes("Role Gate Nair"), false);
  });

  it("lets only the clinic admin in the tenant soft-delete a report", async () => {
    const clinic = createClinicUser("docs-del-doc", "doctor");
    const otherDoctor = createClinicUser("docs-del-doc2", "doctor");
    getDb().prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(clinic.tenantId, otherDoctor.userId);
    const desk = createClinicUser("docs-del-desk", "receptionist");
    getDb().prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(clinic.tenantId, desk.userId);
    const admin = createClinicUser("docs-del-admin", "CLINIC_ADMIN");
    getDb().prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(clinic.tenantId, admin.userId);
    const otherAdmin = createClinicUser("docs-del-admin-b", "CLINIC_ADMIN");
    const portal = createClinicUser("docs-del-patient", "patient");

    const token = await login(clinic.email);
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Delete Gate Patient", phone: "+91 98111 55521", age: 36, gender: "Female" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);
    const granted = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patientId}/document-consent`,
      { language: "en", method: "staff_attested_verbal", attested: true },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(granted.status, 201, String(granted.json.error || ""));
    const uploaded = await upload(token, patientId, pdfBytes(), {
      filename: "delete-gate.pdf",
      mime: "application/pdf",
      title: "Delete gate report",
      docType: "lab_report",
      documentDate: "2026-10-08",
    });
    assert.equal(uploaded.status, 201, String(uploaded.json.error || ""));
    const documentId = String((uploaded.json.document as { id: string; canDelete: boolean }).id);
    assert.equal((uploaded.json.document as { canDelete: boolean }).canDelete, false);
    const stored = getDb()
      .prepare("SELECT storage_key FROM patient_documents WHERE id = ?")
      .get(documentId) as { storage_key: string };
    const full = path.join(docsDir, stored.storage_key);

    const denied: Array<[string, string]> = [
      ["doctor", token],
      ["other doctor", await login(otherDoctor.email)],
      ["reception", await login(desk.email)],
      ["patient", await login(portal.email)],
    ];
    for (const [label, deniedToken] of denied) {
      const res = await jsonRequest(
        port,
        "DELETE",
        `/api/patients/${patientId}/documents/${documentId}`,
        undefined,
        { Authorization: `Bearer ${deniedToken}` }
      );
      assert.equal(res.status, 403, label);
      const row = getDb()
        .prepare("SELECT deleted_at FROM patient_documents WHERE id = ?")
        .get(documentId) as { deleted_at: string | null };
      assert.equal(row.deleted_at, null, label);
    }

    const foreign = await jsonRequest(
      port,
      "DELETE",
      `/api/patients/${patientId}/documents/${documentId}`,
      undefined,
      { Authorization: `Bearer ${await login(otherAdmin.email)}` }
    );
    assert.equal(foreign.status, 404);
    assert.equal(JSON.stringify(foreign.json).includes("Delete gate report"), false);
    const stillThere = getDb()
      .prepare("SELECT deleted_at FROM patient_documents WHERE id = ?")
      .get(documentId) as { deleted_at: string | null };
    assert.equal(stillThere.deleted_at, null);

    const adminList = await jsonRequest(port, "GET", `/api/patients/${patientId}/documents`, undefined, {
      Authorization: `Bearer ${await login(admin.email)}`,
    });
    assert.equal(adminList.status, 200);
    const listed = ((adminList.json.documents as Array<{ id: string; canDelete: boolean }>) || []).find(
      (doc) => doc.id === documentId
    );
    assert.equal(listed?.canDelete, true);

    const removed = await jsonRequest(
      port,
      "DELETE",
      `/api/patients/${patientId}/documents/${documentId}`,
      undefined,
      { Authorization: `Bearer ${await login(admin.email)}` }
    );
    assert.equal(removed.status, 200);
    assert.equal(fs.existsSync(full), true);
    const deleted = getDb()
      .prepare("SELECT deleted_at FROM patient_documents WHERE id = ?")
      .get(documentId) as { deleted_at: string | null };
    assert.equal(deleted.deleted_at != null && deleted.deleted_at.length > 0, true);
    const audit = getDb()
      .prepare(
        `SELECT tenant_id, patient_id, actor_role FROM audit_logs
         WHERE action = 'patient_document.delete' AND details LIKE ?`
      )
      .all(`%${documentId}%`) as Array<{ tenant_id: string; patient_id: string; actor_role: string }>;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].tenant_id, clinic.tenantId);
    assert.equal(audit[0].patient_id, patientId);
    assert.equal(audit[0].actor_role, "CLINIC_ADMIN");
  });

  it("rejects an 11 MB file at the upload limit", async () => {
    const clinic = createClinicUser("docs-11mb", "doctor");
    const token = await login(clinic.email);
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Eleven Mb Patient", phone: "+91 98111 55509", age: 29, gender: "Male" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);
    const bytes = Buffer.alloc(11 * 1024 * 1024);
    bytes.write("%PDF-");
    const saved = await upload(token, patientId, bytes, {
      filename: "eleven.pdf",
      mime: "application/pdf",
      title: "Too big for one file",
      docType: "lab_report",
      documentDate: "2026-10-02",
    });
    assert.equal(saved.status, 400);
    assert.match(String(saved.json.error), /10 MB/);
    const rows = getDb().prepare("SELECT id FROM patient_documents WHERE patient_id = ?").all(patientId);
    assert.equal(rows.length, 0);
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

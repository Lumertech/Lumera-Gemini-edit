import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

function createClinicUser(label: string, role: "doctor" | "receptionist" | "CLINIC_ADMIN" = "doctor") {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const email = `${label}.${suffix}@reception-intake.example`.toLowerCase();
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
  const doctorId = `doc-${label}-${suffix}`;
  db.prepare(
    `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
     VALUES (?, ?, ?, '', '', 'General Medicine', 0, 600, '', '[]', '', ?, ?, '', '', '', 1)`
  ).run(doctorId, userId, `Dr ${label}`, `+91 90000 ${label.slice(0, 5).padEnd(5, "0")}`, email);
  return { tenantId, userId, doctorId, email, role };
}

function pdfBytes(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<</Type /Page>>endobj\ntrailer<<>>\n%%EOF");
}

function pngBytes(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
}

describe("reception intake report upload", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  let docsDir = "";
  const previousDir = process.env.PATIENT_DOCS_DIR;
  const previousBucket = process.env.PATIENT_DOCS_GCS_BUCKET;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-reception-intake";
    docsDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumera-reception-intake-"));
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

  it("lets reception upload reports onto the patient it just registered, one audit row per file", async () => {
    const desk = createClinicUser("intake-desk", "receptionist");
    const token = await login(desk.email);
    const auth = { Authorization: `Bearer ${token}` };
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Intake Meera", phone: "+91 98111 44001", age: 34, gender: "Female" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);

    const blocked = await upload(token, patientId, pdfBytes(), {
      filename: "blocked.pdf",
      mime: "application/pdf",
      title: "Blocked until consent",
      docType: "lab_report",
      documentDate: "2026-10-17",
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.code, "CONSENT_REQUIRED");
    assert.match(String(blocked.json.error), /Record consent/);
    const none = getDb().prepare("SELECT COUNT(*) AS c FROM patient_documents WHERE patient_id = ?").get(patientId) as {
      c: number;
    };
    assert.equal(Number(none.c), 0);

    const granted = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patientId}/document-consent`,
      { language: "en", method: "staff_attested_verbal", attested: true },
      auth
    );
    assert.equal(granted.status, 201, String(granted.json.error || ""));

    const pdf = await upload(token, patientId, pdfBytes(), {
      filename: "intake-cbc.pdf",
      mime: "application/pdf",
      title: "Intake CBC",
      docType: "lab_report",
      documentDate: "2026-10-17",
    });
    assert.equal(pdf.status, 201, String(pdf.json.error || ""));
    const image = await upload(token, patientId, pngBytes(), {
      filename: "intake-photo.png",
      mime: "image/png",
      title: "Intake photo",
      docType: "imaging",
      documentDate: "2026-10-17",
    });
    assert.equal(image.status, 201, String(image.json.error || ""));
    assert.equal((pdf.json.document as { canDelete: boolean }).canDelete, false);
    assert.equal((image.json.document as { canDelete: boolean }).canDelete, false);

    const rows = getDb()
      .prepare("SELECT id, tenant_id, uploaded_by_role FROM patient_documents WHERE patient_id = ? AND deleted_at IS NULL")
      .all(patientId) as Array<{ id: string; tenant_id: string; uploaded_by_role: string }>;
    assert.equal(rows.length, 2);
    assert.equal(rows.every((row) => row.tenant_id === desk.tenantId && row.uploaded_by_role === "receptionist"), true);

    const audits = getDb()
      .prepare(
        `SELECT actor_role, tenant_id, patient_id, entity_id FROM audit_logs
         WHERE action = 'patient_document.upload' AND patient_id = ?`
      )
      .all(patientId) as Array<{ actor_role: string; tenant_id: string; patient_id: string; entity_id: string }>;
    assert.equal(audits.length, 2);
    assert.equal(audits.every((row) => row.actor_role === "receptionist" && row.tenant_id === desk.tenantId), true);
    const auditedIds = new Set(audits.map((row) => row.entity_id));
    assert.equal(rows.every((row) => auditedIds.has(row.id)), true);

    const other = createClinicUser("intake-other", "doctor");
    const foreign = await upload(await login(other.email), patientId, pngBytes(), {
      filename: "stolen.png",
      mime: "image/png",
      title: "Stolen",
      docType: "other",
      documentDate: "2026-10-17",
    });
    assert.equal(foreign.status, 404);
    const still = getDb().prepare("SELECT COUNT(*) AS c FROM patient_documents WHERE patient_id = ?").get(patientId) as {
      c: number;
    };
    assert.equal(Number(still.c), 2);
  });

  it("keeps reception off other patients' clinical notes and off draft and Rx writes", async () => {
    const doctor = createClinicUser("intake-rx-doc", "doctor");
    const desk = createClinicUser("intake-rx-desk", "receptionist");
    getDb().prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(doctor.tenantId, desk.userId);
    const outsider = createClinicUser("intake-rx-out", "doctor");
    const doctorAuth = { Authorization: `Bearer ${await login(doctor.email)}` };
    const deskAuth = { Authorization: `Bearer ${await login(desk.email)}` };
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Noted Patient", phone: "+91 98111 44002", age: 40, gender: "Male" },
      doctorAuth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);
    const signed = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      {
        patientId,
        diagnosis: "INTAKE-SECRET-DIAGNOSIS",
        medicines: [{ id: "m1", drugName: "IntakeSecretol", dosage: "10 mg", frequency: "1-0-0", durationDays: 3 }],
      },
      doctorAuth
    );
    assert.equal(signed.status, 201, String(signed.json.error || ""));
    const rxId = String((signed.json.prescription as { id: string }).id);

    const chart = await jsonRequest(port, "GET", `/api/patients/${patientId}/chart`, undefined, deskAuth);
    assert.equal(chart.status, 200);
    const chartBody = JSON.stringify(chart.json);
    assert.equal(chartBody.includes("INTAKE-SECRET-DIAGNOSIS"), false);
    assert.equal(chartBody.includes("IntakeSecretol"), false);
    const deskRx = ((chart.json.prescriptions as Array<Record<string, unknown>>) || [])[0];
    assert.equal(deskRx?.redacted, true);
    assert.equal("diagnosis" in (deskRx || {}), false);
    assert.equal("medicines" in (deskRx || {}), false);

    const opened = await jsonRequest(port, "GET", `/api/prescriptions/${rxId}`, undefined, deskAuth);
    assert.equal(JSON.stringify(opened.json).includes("INTAKE-SECRET-DIAGNOSIS"), false);
    assert.equal(JSON.stringify(opened.json).includes("IntakeSecretol"), false);

    const outside = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Outside Note", phone: "+91 98111 44003", age: 28, gender: "Female" },
      { Authorization: `Bearer ${await login(outsider.email)}` }
    );
    assert.equal(outside.status, 201);
    const outsideId = String((outside.json.patient as { id: string }).id);
    const stolen = await jsonRequest(port, "GET", `/api/patients/${outsideId}/chart`, undefined, deskAuth);
    assert.equal(stolen.status, 404);
    assert.equal(JSON.stringify(stolen.json).includes("Outside Note"), false);

    for (const [method, route, body] of [
      ["POST", "/api/prescriptions", { patientId, diagnosis: "DESK-WRITE", medicines: [] }],
      ["GET", `/api/prescriptions/draft/${patientId}`, undefined],
      ["POST", "/api/prescriptions/draft", { patientId, diagnosis: "DESK-DRAFT", medicines: [] }],
    ] as const) {
      const res = await jsonRequest(port, method, route, body, deskAuth);
      assert.equal(res.status, 403, route);
      assert.equal(res.json.code, "ROLE_DENIED", route);
    }
    const drafts = getDb()
      .prepare("SELECT COUNT(*) AS c FROM prescription_drafts WHERE patient_id = ?")
      .get(patientId) as { c: number };
    assert.equal(Number(drafts.c), 0);
    const extraRx = getDb()
      .prepare("SELECT COUNT(*) AS c FROM prescriptions WHERE patient_id = ? AND diagnosis = 'DESK-WRITE'")
      .get(patientId) as { c: number };
    assert.equal(Number(extraRx.c), 0);
  });

  it("still lets only the same-tenant clinic admin delete a report reception uploaded", async () => {
    const desk = createClinicUser("intake-del-desk", "receptionist");
    const doctor = createClinicUser("intake-del-doc", "doctor");
    getDb().prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(desk.tenantId, doctor.userId);
    const admin = createClinicUser("intake-del-admin", "CLINIC_ADMIN");
    getDb().prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(desk.tenantId, admin.userId);
    const otherAdmin = createClinicUser("intake-del-admin-b", "CLINIC_ADMIN");
    const token = await login(desk.email);
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Delete Intake", phone: "+91 98111 44004", age: 51, gender: "Male" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);
    const granted = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patientId}/document-consent`,
      { language: "en", method: "signed_paper", attested: true },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(granted.status, 201, String(granted.json.error || ""));
    const uploaded = await upload(token, patientId, pdfBytes(), {
      filename: "keep.pdf",
      mime: "application/pdf",
      title: "Keep this report",
      docType: "other",
      documentDate: "2026-10-17",
    });
    assert.equal(uploaded.status, 201, String(uploaded.json.error || ""));
    const documentId = String((uploaded.json.document as { id: string }).id);

    for (const [label, email] of [
      ["reception", desk.email],
      ["doctor", doctor.email],
    ] as const) {
      const res = await jsonRequest(
        port,
        "DELETE",
        `/api/patients/${patientId}/documents/${documentId}`,
        undefined,
        { Authorization: `Bearer ${await login(email)}` }
      );
      assert.equal(res.status, 403, label);
      const row = getDb().prepare("SELECT deleted_at FROM patient_documents WHERE id = ?").get(documentId) as {
        deleted_at: string | null;
      };
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
    const still = getDb().prepare("SELECT deleted_at FROM patient_documents WHERE id = ?").get(documentId) as {
      deleted_at: string | null;
    };
    assert.equal(still.deleted_at, null);

    const removed = await jsonRequest(
      port,
      "DELETE",
      `/api/patients/${patientId}/documents/${documentId}`,
      undefined,
      { Authorization: `Bearer ${await login(admin.email)}` }
    );
    assert.equal(removed.status, 200);
    const deleted = getDb().prepare("SELECT deleted_at FROM patient_documents WHERE id = ?").get(documentId) as {
      deleted_at: string | null;
    };
    assert.equal(Boolean(deleted.deleted_at), true);
  });
});

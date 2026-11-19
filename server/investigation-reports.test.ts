import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

const TITLE = "UniqueInvestigationTitleXYZ";

function createClinicUser(label: string, role: "doctor" | "receptionist" = "doctor") {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const email = `${label}.${suffix}@investigations.example`.toLowerCase();
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
  return { tenantId, userId, doctorId, email };
}

function pdfBytes(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<</Type /Page>>endobj\ntrailer<<>>\n%%EOF");
}

describe("investigation reports", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  let docsDir = "";
  const previousDir = process.env.PATIENT_DOCS_DIR;
  const previousBucket = process.env.PATIENT_DOCS_GCS_BUCKET;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-investigations";
    docsDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumera-investigations-"));
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
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || "login failed"));
    return String(res.json.token || "");
  }

  it("uploads a lab report onto a visit, lists it for that patient only, and keeps the title out of the audit log", async () => {
    const doctor = createClinicUser("inv-doc");
    const other = createClinicUser("inv-other");
    const desk = createClinicUser("inv-desk", "receptionist");
    getDb().prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(doctor.tenantId, desk.userId);
    const token = await login(doctor.email);
    const deskToken = await login(desk.email);
    const otherToken = await login(other.email);
    const auth = { Authorization: `Bearer ${token}` };

    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Investigation Patient", phone: "+91 98111 88001", age: 40, gender: "Male" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);
    const visit = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      { patientId, doctorId: doctor.doctorId, date: "2026-11-03", timeSlot: "11:00 AM", type: "New Consultation" },
      auth
    );
    assert.equal(visit.status, 201, String(visit.json.error || ""));
    const appointmentId = String((visit.json.appointment as { id: string }).id);
    const granted = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patientId}/document-consent`,
      { language: "en", method: "staff_attested_verbal", attested: true },
      auth
    );
    assert.equal(granted.status, 201, String(granted.json.error || ""));

    const form = new FormData();
    form.set("file", new File([new Uint8Array(pdfBytes())], "report.pdf", { type: "application/pdf" }));
    form.set("title", TITLE);
    form.set("docType", "lab_report");
    form.set("documentDate", "2026-11-03");
    form.set("appointmentId", appointmentId);
    const uploaded = await fetch(`http://127.0.0.1:${port}/api/patients/${patientId}/documents`, {
      method: "POST",
      headers: auth,
      body: form,
    });
    const uploadedJson = (await uploaded.json()) as { document?: { id: string; appointmentId?: string }; error?: string };
    assert.equal(uploaded.status, 201, String(uploadedJson.error || ""));
    assert.equal(uploadedJson.document?.appointmentId, appointmentId);
    const documentId = String(uploadedJson.document?.id || "");

    const chart = await jsonRequest(port, "GET", `/api/patients/${patientId}/chart`, undefined, auth);
    assert.equal(chart.status, 200);
    const files = ((chart.json.investigations as { files?: Array<{ id: string; appointmentId: string; title: string }> }).files) || [];
    assert.equal(files.some((file) => file.id === documentId && file.appointmentId === appointmentId && file.title === TITLE), true);

    const deskChart = await jsonRequest(port, "GET", `/api/patients/${patientId}/chart`, undefined, { Authorization: `Bearer ${deskToken}` });
    assert.equal(deskChart.status, 200);
    assert.equal(JSON.stringify(deskChart.json.investigations || {}).includes(TITLE), true);

    const stolen = await jsonRequest(port, "GET", `/api/patients/${patientId}/chart`, undefined, { Authorization: `Bearer ${otherToken}` });
    assert.equal(stolen.status, 404);
    assert.equal(JSON.stringify(stolen.json).includes(TITLE), false);

    const anon = await fetch(`http://127.0.0.1:${port}/api/patients/${patientId}/documents`, { method: "POST", body: form });
    assert.equal(anon.status, 401);

    const wrongVisit = await jsonRequest(
      port,
      "PATCH",
      `/api/patients/${patientId}/documents/${documentId}`,
      { appointmentId: "visit-does-not-exist" },
      auth
    );
    assert.equal(wrongVisit.status, 400);

    const detach = await jsonRequest(
      port,
      "PATCH",
      `/api/patients/${patientId}/documents/${documentId}`,
      { appointmentId: "" },
      { Authorization: `Bearer ${deskToken}` }
    );
    assert.equal(detach.status, 200, String(detach.json.error || ""));
    assert.equal((detach.json.document as { appointmentId?: string }).appointmentId, "");

    const reattach = await jsonRequest(
      port,
      "PATCH",
      `/api/patients/${patientId}/documents/${documentId}`,
      { appointmentId },
      auth
    );
    assert.equal(reattach.status, 200, String(reattach.json.error || ""));
    assert.equal((reattach.json.document as { appointmentId?: string }).appointmentId, appointmentId);

    const otherPatch = await jsonRequest(
      port,
      "PATCH",
      `/api/patients/${patientId}/documents/${documentId}`,
      { appointmentId },
      { Authorization: `Bearer ${otherToken}` }
    );
    assert.equal(otherPatch.status, 404);

    const audits = getDb()
      .prepare("SELECT action, details FROM audit_logs WHERE patient_id = ? AND action LIKE 'patient_document.%'")
      .all(patientId) as Array<{ action: string; details: string }>;
    const joined = JSON.stringify(audits);
    assert.equal(audits.some((row) => row.action === "patient_document.upload"), true);
    assert.equal(audits.some((row) => row.action === "patient_document.attach_visit"), true);
    assert.equal(joined.includes(TITLE), false);
    assert.equal(joined.includes("report.pdf"), false);
  });
});

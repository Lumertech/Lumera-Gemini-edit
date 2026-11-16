import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { GoogleGenAI } from "@google/genai";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { flagAgainstRange, parseLabDraft } from "./lab-reading.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { setVertexClientForTests, vertexGeminiModel } from "./vertex-gemini.ts";

const VALUE = "HemoglobinDraftValueXYZ";

function createClinicUser(label: string, role: "doctor" | "receptionist" = "doctor") {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const email = `${label}.${suffix}@lab-reading.example`.toLowerCase();
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

describe("lab draft parsing", () => {
  it("keeps a printed flag and fills one from the reference range", () => {
    const rows = parseLabDraft(
      '```json\n{"results":[{"param":"Hemoglobin","value":"11.2","unit":"g/dL","normalRange":"12.0-15.0","status":"Low"},{"param":"Platelets","value":"180","unit":"10^3/uL","normalRange":"150-400"}]}\n```'
    );
    assert.equal(rows[0].status, "Low");
    assert.equal(rows[1].status, "Normal");
    assert.equal(flagAgainstRange("10", "12-16"), "Low");
    assert.equal(flagAgainstRange("18", "12-16"), "High");
    assert.equal(flagAgainstRange("seen", "12-16"), "Unknown");
  });
});

describe("lab report reading", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  let docsDir = "";
  let seenModel = "";
  const previousDir = process.env.PATIENT_DOCS_DIR;
  const previousBucket = process.env.PATIENT_DOCS_GCS_BUCKET;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-lab-reading";
    docsDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumera-lab-reading-"));
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
    setVertexClientForTests(undefined);
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

  it("stores a Vertex draft, hides it until a doctor confirms, and does not log the value", async () => {
    const doctor = createClinicUser("read-doc");
    const desk = createClinicUser("read-desk", "receptionist");
    getDb().prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(doctor.tenantId, desk.userId);
    const other = createClinicUser("read-other");
    const token = await login(doctor.email);
    const deskToken = await login(desk.email);
    const otherToken = await login(other.email);
    const auth = { Authorization: `Bearer ${token}` };

    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Reading Patient", phone: "+91 98111 89001", age: 44, gender: "Female" },
      auth
    );
    assert.equal(created.status, 201);
    const patientId = String((created.json.patient as { id: string }).id);
    const granted = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patientId}/document-consent`,
      { language: "en", method: "staff_attested_verbal", attested: true },
      auth
    );
    assert.equal(granted.status, 201, String(granted.json.error || ""));
    const form = new FormData();
    form.set("file", new File([new Uint8Array(Buffer.from("%PDF-1.4\n1 0 obj<</Type /Page>>endobj\ntrailer<<>>\n%%EOF"))], "panel.pdf", { type: "application/pdf" }));
    form.set("title", "Panel");
    form.set("docType", "lab_report");
    form.set("documentDate", "2026-11-04");
    const uploaded = await fetch(`http://127.0.0.1:${port}/api/patients/${patientId}/documents`, {
      method: "POST",
      headers: auth,
      body: form,
    });
    const uploadedJson = (await uploaded.json()) as { document?: { id: string }; error?: string };
    assert.equal(uploaded.status, 201, String(uploadedJson.error || ""));
    const documentId = String(uploadedJson.document?.id);

    setVertexClientForTests(null);
    const unconfigured = await jsonRequest(port, "POST", `/api/patients/${patientId}/documents/${documentId}/extract`, {}, auth);
    assert.equal(unconfigured.status, 503);
    assert.equal(JSON.stringify(unconfigured.json).includes(VALUE), false);

    seenModel = "";
    setVertexClientForTests({
      models: {
        generateContent: async (params: { model?: string }) => {
          seenModel = String(params.model || "");
          return {
            text: JSON.stringify({
              results: [{ param: "Hemoglobin", value: VALUE, unit: "g/dL", normalRange: "12-15", status: "Low" }],
            }),
          };
        },
      },
    } as unknown as GoogleGenAI);

    const extracted = await jsonRequest(port, "POST", `/api/patients/${patientId}/documents/${documentId}/extract`, {}, auth);
    assert.equal(extracted.status, 201, String(extracted.json.error || ""));
    assert.equal(seenModel, vertexGeminiModel());
    assert.equal(vertexGeminiModel(), "gemini-3.5-flash-lite");
    const report = extracted.json.report as { id: string; draft: boolean; results: Array<{ value: string; status: string }> };
    assert.equal(report.draft, true);
    assert.equal(report.results[0].value, VALUE);
    assert.equal(report.results[0].status, "Low");

    const deskList = await jsonRequest(port, "GET", `/api/patients/${patientId}/lab-reports`, undefined, {
      Authorization: `Bearer ${deskToken}`,
    });
    assert.equal(deskList.status, 200);
    assert.equal(JSON.stringify(deskList.json).includes(VALUE), false);
    assert.equal(((deskList.json.reports as Array<{ draft: boolean }>) || [])[0]?.draft, true);

    const stolen = await jsonRequest(port, "GET", `/api/patients/${patientId}/lab-reports`, undefined, {
      Authorization: `Bearer ${otherToken}`,
    });
    assert.equal(stolen.status, 404);
    assert.equal(JSON.stringify(stolen.json).includes(VALUE), false);

    const deskExtract = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patientId}/documents/${documentId}/extract`,
      {},
      { Authorization: `Bearer ${deskToken}` }
    );
    assert.equal(deskExtract.status, 403);

    const unconfirmedPdf = await fetch(`http://127.0.0.1:${port}/api/whatsapp/lab-report/${report.id}/pdf`, { headers: auth });
    assert.equal(unconfirmedPdf.status, 404);

    const missingConfirm = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patientId}/lab-reports/${report.id}/confirm`,
      {},
      auth
    );
    assert.equal(missingConfirm.status, 400);

    const confirmed = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patientId}/lab-reports/${report.id}/confirm`,
      { doctorConfirmed: true },
      auth
    );
    assert.equal(confirmed.status, 200, String(confirmed.json.error || ""));
    assert.equal((confirmed.json.report as { draft: boolean }).draft, false);
    assert.equal((confirmed.json.report as { results: Array<{ value: string }> }).results[0].value, VALUE);

    const again = await jsonRequest(port, "POST", `/api/patients/${patientId}/documents/${documentId}/extract`, {}, auth);
    assert.equal(again.status, 409);

    const audits = getDb()
      .prepare("SELECT action, details FROM audit_logs WHERE patient_id = ? AND action LIKE 'lab_reading.%'")
      .all(patientId) as Array<{ action: string; details: string }>;
    const joined = JSON.stringify(audits);
    assert.equal(audits.some((row) => row.action === "lab_reading.draft"), true);
    assert.equal(audits.some((row) => row.action === "lab_reading.confirmed"), true);
    assert.equal(joined.includes(VALUE), false);
  });
});

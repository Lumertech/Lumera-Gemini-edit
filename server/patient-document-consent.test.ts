import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

function createClinicUser(label: string, role: "doctor" | "receptionist" | "CLINIC_ADMIN" | "super_admin" = "doctor") {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const email = `${label}.${suffix}@doc-consent.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Sunrise ${label}`, now, now, now);
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
    `Sunrise ${label}`,
    now,
    now
  );
  return { tenantId, userId, email, role };
}

function pdfBytes(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<</Type /Page>>endobj\n%%EOF");
}

describe("health document consent gate", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  let docsDir = "";
  const previousDir = process.env.PATIENT_DOCS_DIR;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-doc-consent";
    docsDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumera-consent-docs-"));
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

  async function upload(token: string, patientId: string) {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(pdfBytes())], "report.pdf", { type: "application/pdf" }));
    form.set("title", "Consent gated report");
    form.set("docType", "lab_report");
    form.set("documentDate", "2026-10-01");
    const res = await fetch(`http://127.0.0.1:${port}/api/patients/${patientId}/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string; document?: { id?: string } };
    return { status: res.status, json };
  }

  it("blocks upload until v1 consent, then blocks it again after withdrawal", async () => {
    const doctor = createClinicUser("consent-doc", "doctor");
    const token = await login(doctor.email);
    const auth = { Authorization: `Bearer ${token}` };
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Meera Iyer", phone: "+91 98111 77701", age: 34, gender: "Female" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);

    const blocked = await upload(token, patientId);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.code, "CONSENT_REQUIRED");
    const filesAfterBlock = fs.readdirSync(docsDir);
    assert.equal(filesAfterBlock.length, 0);

    const notice = await jsonRequest(port, "GET", `/api/patients/${patientId}/document-consent`, undefined, auth);
    assert.equal(notice.status, 200);
    const body = String((notice.json.notices as { en: { body: string } }).en.body);
    assert.match(body, new RegExp(`^Sunrise ${doctor.role === "doctor" ? "consent-doc" : ""}`));
    assert.match(body, /^Sunrise consent-doc will store/);
    assert.equal(body.startsWith("Lumera will store"), false);
    assert.match(String((notice.json.notices as { hi: { body: string } }).hi.body), /^Sunrise consent-doc /);

    const granted = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patientId}/document-consent`,
      { language: "hi", method: "staff_attested_verbal", attested: true },
      auth
    );
    assert.equal(granted.status, 201, String(granted.json.error || ""));
    const saved = await upload(token, patientId);
    assert.equal(saved.status, 201, String(saved.json.error || ""));

    const withdrawn = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patientId}/document-consent/withdraw`,
      {},
      auth
    );
    assert.equal(withdrawn.status, 201, String(withdrawn.json.error || ""));
    assert.equal((withdrawn.json.status as { active?: boolean }).active, false);
    const after = await upload(token, patientId);
    assert.equal(after.status, 409);
    assert.equal(after.json.code, "CONSENT_REQUIRED");

    const chart = await jsonRequest(port, "GET", `/api/patients/${patientId}/chart`, undefined, auth);
    const titles = ((chart.json.timeline as Array<{ title: string }>) || []).map((item) => item.title);
    assert.equal(titles.includes("Consent recorded"), true);
    assert.equal(titles.includes("Consent withdrawn"), true);

    const audits = getDb()
      .prepare(
        `SELECT action, timestamp, details, tenant_id, patient_id, actor_role, entity_type FROM audit_logs
         WHERE patient_id = ? AND action LIKE 'patient_document_consent.%'`
      )
      .all(patientId) as Array<{
        action: string;
        timestamp: string;
        details: string;
        tenant_id: string;
        patient_id: string;
        actor_role: string;
        entity_type: string;
      }>;
    assert.equal(audits.length >= 2, true);
    assert.equal(audits.every((row) => row.tenant_id === doctor.tenantId && row.patient_id === patientId), true);
    assert.equal(audits.every((row) => row.actor_role === "doctor" && row.entity_type === "patient_health_document_consent"), true);
    assert.equal(
      audits.every((row) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.timestamp)),
      true
    );
    const grant = audits.find((row) => row.action === "patient_document_consent.granted");
    assert.ok(grant);
    const grantDetails = JSON.parse(grant.details) as {
      language?: string;
      guardianName?: string;
      guardianRelation?: string;
    };
    assert.equal(grantDetails.language, "hi");
    assert.equal(grantDetails.guardianName, "");
    assert.equal(grantDetails.guardianRelation, "");
  });

  it("requires a guardian for a minor and denies super_admin", async () => {
    const doctor = createClinicUser("consent-minor", "doctor");
    const platform = createClinicUser("consent-root", "super_admin");
    const token = await login(doctor.email);
    const auth = { Authorization: `Bearer ${token}` };
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Aarav Minor", phone: "+91 98111 77702", age: 8, gender: "Male" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);
    getDb().prepare("UPDATE patients SET date_of_birth = ? WHERE id = ?").run("2016-04-02", patientId);

    const missingGuardian = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patientId}/document-consent`,
      { language: "en", method: "signed_paper", attested: true },
      auth
    );
    assert.equal(missingGuardian.status, 400);
    assert.equal(missingGuardian.json.code, "GUARDIAN_REQUIRED");

    const granted = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patientId}/document-consent`,
      { language: "en", method: "signed_paper", attested: true, guardianName: "Lata Rao", guardianRelation: "Mother" },
      auth
    );
    assert.equal(granted.status, 201, String(granted.json.error || ""));
    const grantAudit = getDb()
      .prepare(
        `SELECT details, timestamp FROM audit_logs
         WHERE patient_id = ? AND action = 'patient_document_consent.granted'`
      )
      .get(patientId) as { details: string; timestamp: string };
    const minorGrant = JSON.parse(grantAudit.details) as {
      language?: string;
      guardianName?: string;
      guardianRelation?: string;
    };
    assert.equal(minorGrant.language, "en");
    assert.equal(minorGrant.guardianName, "Lata Rao");
    assert.equal(minorGrant.guardianRelation, "Mother");
    assert.match(grantAudit.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const saved = await upload(token, patientId);
    assert.equal(saved.status, 201, String(saved.json.error || ""));

    const root = await login(platform.email);
    const denied = await jsonRequest(port, "GET", "/api/patients", undefined, { Authorization: `Bearer ${root}` });
    assert.equal(denied.status, 403);
    assert.equal(JSON.stringify(denied.json).includes("Aarav"), false);
    const deniedChart = await jsonRequest(port, "GET", `/api/patients/${patientId}/chart`, undefined, {
      Authorization: `Bearer ${root}`,
    });
    assert.equal(deniedChart.status, 403);
    assert.equal(JSON.stringify(deniedChart.json).includes("Aarav"), false);
    const deniedConsent = await jsonRequest(port, "GET", `/api/patients/${patientId}/document-consent`, undefined, {
      Authorization: `Bearer ${root}`,
    });
    assert.equal(deniedConsent.status, 403);
    assert.equal(JSON.stringify(deniedConsent.json).includes("Lata"), false);
  });

  it("refuses consent capture when the tenant clinic name is blank", async () => {
    const doctor = createClinicUser("consent-noname", "doctor");
    getDb().prepare("UPDATE tenants SET name = '' WHERE id = ?").run(doctor.tenantId);
    const token = await login(doctor.email);
    const auth = { Authorization: `Bearer ${token}` };
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "No Clinic Name", phone: "+91 98111 77703", age: 40, gender: "Female" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);
    const notice = await jsonRequest(port, "GET", `/api/patients/${patientId}/document-consent`, undefined, auth);
    assert.equal(notice.status, 200);
    assert.equal(notice.json.clinicName, "");
    assert.equal(notice.json.clinicNameSet, false);
    assert.equal(String((notice.json.notices as { en: { body: string } }).en.body).includes("This clinic"), false);
    const blocked = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patientId}/document-consent`,
      { language: "en", method: "in_app", attested: true },
      auth
    );
    assert.equal(blocked.status, 400);
    assert.equal(blocked.json.code, "CLINIC_NAME_REQUIRED");
    assert.match(String(blocked.json.error), /clinic name/i);
    const rows = getDb()
      .prepare("SELECT id FROM patient_health_document_consents WHERE patient_id = ?")
      .all(patientId);
    assert.equal(rows.length, 0);
  });
});

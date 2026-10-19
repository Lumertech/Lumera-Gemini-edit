import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer, type TestHttpServer } from "./test-http.ts";
import { installWhatsAppRouterPatch, protectWhatsAppDashboard } from "./whatsapp-dashboard-guard.ts";
import { createWhatsAppRouter } from "./whatsapp.ts";

function createClinic(label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const email = `${label}.${suffix}@wa-follow.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Clinic ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(userId, tenantId, email, hashPassword("Lumera@2026"), `Dr ${label}`, `+91 97000 ${suffix.slice(0, 5)}`, `Clinic ${label}`, now, now);
  return { tenantId, userId, email, name: `Dr ${label}` };
}

function insertPatient(opts: { id: string; tenantId: string; name: string; phone: string; uhid: string }) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO patients (
         id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions,
         emergency_contact, address, last_visit, created_at
       ) VALUES (?, ?, ?, ?, 34, 'Female', ?, '', 'O+', '[]', '[]', '', '', ?, ?)`
    )
    .run(opts.id, opts.tenantId, opts.uhid, opts.name, opts.phone, now, now);
}

describe("WhatsApp bot lookup audit and first-name replies", () => {
  let server: TestHttpServer;
  const cleanup = {
    patients: [] as string[],
    rxs: [] as string[],
    labs: [] as string[],
    tenants: [] as string[],
    users: [] as string[],
    appointments: [] as string[],
    phones: [] as string[],
  };

  before(async () => {
    installWhatsAppRouterPatch();
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-wa-follow";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    server = await startTestServer((app) => {
      app.use("/api/whatsapp", protectWhatsAppDashboard(createWhatsAppRouter(() => null)));
      app.use("/api", createApiRouter());
    });
  });

  after(async () => {
    const db = getDb();
    for (const phone of cleanup.phones) {
      db.prepare("DELETE FROM whatsapp_messages WHERE patient_phone = ?").run(phone);
      db.prepare("DELETE FROM whatsapp_conversations WHERE patient_phone = ?").run(phone);
    }
    for (const id of cleanup.appointments) db.prepare("DELETE FROM appointments WHERE id = ?").run(id);
    for (const id of cleanup.labs) db.prepare("DELETE FROM lab_reports WHERE id = ?").run(id);
    for (const id of cleanup.rxs) db.prepare("DELETE FROM prescriptions WHERE id = ?").run(id);
    for (const id of cleanup.patients) db.prepare("DELETE FROM patients WHERE id = ?").run(id);
    db.prepare(
      "DELETE FROM audit_logs WHERE action IN ('WhatsApp bot Rx lookup', 'WhatsApp bot lab lookup') AND user_id IN (SELECT id FROM users WHERE email LIKE '%@wa-follow.example')"
    ).run();
    for (const id of cleanup.users) db.prepare("DELETE FROM users WHERE id = ?").run(id);
    for (const id of cleanup.tenants) db.prepare("DELETE FROM tenants WHERE id = ?").run(id);
    await server.close();
  });

  async function login(email: string): Promise<string> {
    const res = await jsonRequest(server.port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || "login failed"));
    return String(res.json.token || "");
  }

  it("records one PHI-free audit row for each Rx and lab lookup, found or not", async () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const clinic = createClinic("phiAud");
    cleanup.tenants.push(clinic.tenantId);
    cleanup.users.push(clinic.userId);
    const phone = `+91 89${String(Date.now()).slice(-8)}`;
    const missingPhone = `+91 88${String(Date.now() + 3).slice(-8)}`;
    cleanup.phones.push(phone, missingPhone);
    const patientId = `pat-aud-${suffix}`;
    const rxId = `rx-aud-${suffix}`;
    const labId = `lab-aud-${suffix}`;
    cleanup.patients.push(patientId);
    cleanup.rxs.push(rxId);
    cleanup.labs.push(labId);
    const diagnosis = `ZXQDIAG${suffix}`;
    const interpretation = `ZXQLAB${suffix}`;
    insertPatient({ id: patientId, tenantId: clinic.tenantId, name: "Audit Patient", phone, uhid: `UHID-AUD-${suffix}` });
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO prescriptions (
           id, tenant_id, rx_number, patient_id, patient_name, patient_phone, patient_uhid,
           doctor_id, doctor_name, doctor_specialty, doctor_reg_number, date, diagnosis,
           medicines, lab_tests, advice, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'doc-aud', 'Dr Audit', 'Medicine', 'REG-AUD', '2026-10-15', ?, '[]', '[]', '[]', ?)`
      )
      .run(rxId, clinic.tenantId, `RX-AUD-${suffix}`, patientId, "Audit Patient", phone, `UHID-AUD-${suffix}`, diagnosis, now);
    getDb()
      .prepare(
        `INSERT INTO lab_reports (
           id, tenant_id, patient_id, patient_uhid, patient_name, date, lab_name, category,
           doctor_interpretation, results, pdf_url, created_at
         ) VALUES (?, ?, ?, ?, 'Audit Patient', '2026-10-15', 'City Lab', 'Chemistry', ?, '[]', '', ?)`
      )
      .run(labId, clinic.tenantId, patientId, `UHID-AUD-${suffix}`, interpretation, now);

    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const foundRx = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      { patientPhone: phone, patientName: "Audit Patient", sender: "user", content: "rx" },
      auth
    );
    assert.equal(foundRx.status, 201);
    assert.equal((foundRx.json.botReply as { content?: string }).content, "your prescription is ready");

    const missedRx = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      { patientPhone: missingPhone, patientName: "Nobody", sender: "user", content: "rx" },
      auth
    );
    assert.equal(missedRx.status, 201);
    assert.notEqual((missedRx.json.botReply as { content?: string }).content, "your prescription is ready");

    const foundLab = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      { patientPhone: phone, patientName: "Someone Else", sender: "user", content: "lab" },
      auth
    );
    assert.equal(foundLab.status, 201);
    assert.equal((foundLab.json.botReply as { content?: string }).content, "your lab report is ready");

    const missedLab = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      { patientPhone: missingPhone, patientName: "Nobody", sender: "user", content: "lab" },
      auth
    );
    assert.equal(missedLab.status, 201);
    assert.notEqual((missedLab.json.botReply as { content?: string }).content, "your lab report is ready");

    const rows = getDb()
      .prepare(
        `SELECT user_id, user_name, action, details, tenant_id, patient_id, actor_role, entity_type, entity_id
         FROM audit_logs
         WHERE user_id = ? AND action IN ('WhatsApp bot Rx lookup', 'WhatsApp bot lab lookup')`
      )
      .all(clinic.userId) as {
      user_id: string;
      user_name: string;
      action: string;
      details: string;
      tenant_id: string;
      patient_id: string;
      actor_role: string;
      entity_type: string;
      entity_id: string;
    }[];
    assert.equal(rows.length, 4);
    const expectRow = (action: string, details: string, patient: string, entityType: string) => {
      const match = rows.filter((row) => row.action === action && row.details === details && row.patient_id === patient);
      assert.equal(match.length, 1, `${action} ${details}`);
      assert.equal(match[0].entity_type, entityType);
    };
    expectRow("WhatsApp bot Rx lookup", "found", patientId, "prescription");
    expectRow("WhatsApp bot Rx lookup", "not_found", "", "prescription");
    expectRow("WhatsApp bot lab lookup", "found", patientId, "lab_report");
    expectRow("WhatsApp bot lab lookup", "not_found", "", "lab_report");
    for (const row of rows) {
      assert.equal(row.user_id, clinic.userId);
      assert.equal(row.user_name, clinic.name);
      assert.equal(row.actor_role, "doctor");
      assert.equal(row.tenant_id, clinic.tenantId);
      assert.equal(row.entity_id, "");
      const blob = JSON.stringify(row);
      assert.equal(blob.includes(diagnosis), false);
      assert.equal(blob.includes(interpretation), false);
      assert.equal(blob.includes(phone), false);
      assert.equal(blob.includes("Audit Patient"), false);
      assert.equal(blob.includes(`RX-AUD-${suffix}`), false);
    }
  });

  it("queue and the Namaste fallback use the first name and do not echo the message", async () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const clinic = createClinic("phiName");
    cleanup.tenants.push(clinic.tenantId);
    cleanup.users.push(clinic.userId);
    const phone = `+91 87${String(Date.now()).slice(-8)}`;
    cleanup.phones.push(phone);
    const patientId = `pat-name-${suffix}`;
    const appointmentId = `appt-name-${suffix}`;
    cleanup.patients.push(patientId);
    cleanup.appointments.push(appointmentId);
    const fullName = `Meera ZXQSECRET${suffix}`;
    insertPatient({ id: patientId, tenantId: clinic.tenantId, name: fullName, phone, uhid: `UHID-N-${suffix}` });
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO appointments (
           id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name,
           specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at
         ) VALUES (?, ?, 42, ?, ?, ?, ?, 'doc-name', 'Dr Queue', 'Medicine', '2026-10-19', '09:00 AM', 'New Consultation', 'Waiting', 'Desk', 0, 0, ?)`
      )
      .run(appointmentId, clinic.tenantId, patientId, fullName, phone, `UHID-N-${suffix}`, now);

    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const queued = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      { patientPhone: phone, patientName: fullName, sender: "user", content: "queue" },
      auth
    );
    assert.equal(queued.status, 201, String(queued.json.error || ""));
    const queueText = String((queued.json.botReply as { content?: string }).content || "");
    assert.match(queueText, /Live OPD Token/);
    assert.match(queueText, /\*Patient\*: Meera\b/);
    assert.equal(queueText.includes(`ZXQSECRET${suffix}`), false);

    const echo = `ZXQECHO${suffix}`;
    const fallback = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      { patientPhone: phone, patientName: fullName, sender: "user", content: `hello ${echo}` },
      auth
    );
    assert.equal(fallback.status, 201, String(fallback.json.error || ""));
    const fallbackText = String((fallback.json.botReply as { content?: string }).content || "");
    assert.match(fallbackText, /Namaste Meera!/);
    assert.equal(fallbackText.includes(`ZXQSECRET${suffix}`), false);
    assert.equal(fallbackText.includes(echo), false);
    assert.equal(fallbackText.includes(`hello ${echo}`), false);
  });

  it("documents that exact E.164 matching is not on main yet", () => {
    const source = fs.readFileSync(fileURLToPath(new URL("./whatsapp-tenant-resolve.ts", import.meta.url)), "utf8");
    assert.match(source, /isDemoWhatsAppAllowlisted/);
    assert.match(source, /phonesMatch\(String\(row\.phone \|\| ""\), phone\)/);
  });
});

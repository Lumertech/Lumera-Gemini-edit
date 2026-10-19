import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer, type TestHttpServer } from "./test-http.ts";
import { installWhatsAppRouterPatch, protectWhatsAppDashboard } from "./whatsapp-dashboard-guard.ts";
import { createWhatsAppRouter } from "./whatsapp.ts";
import { findPatientByPhoneInTenant } from "./whatsapp-tenant-resolve.ts";

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

  it("a super admin in clinic B cannot book, queue, or cancel clinic A by posting tenantId A", async () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const clinicA = createClinic("phiOwnA");
    const clinicB = createClinic("phiOwnB");
    const adminId = `user-follow-sa-${suffix}`;
    const adminEmail = `phi.sa.${suffix}@wa-follow.example`.toLowerCase();
    const now = new Date().toISOString();
    getDb()
      .prepare("UPDATE tenants SET name = ? WHERE id = ?")
      .run(`ZXQCLINICA ${suffix}`, clinicA.tenantId);
    getDb()
      .prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
         VALUES (?, ?, ?, ?, ?, 'super_admin', 'active', ?, 'Lumera', 1, 'individual', 'General Medicine', ?, ?)`
      )
      .run(adminId, clinicB.tenantId, adminEmail, hashPassword("Lumera@2026"), `SA ${suffix}`, `+91 86${suffix.slice(0, 8)}`, now, now);
    cleanup.tenants.push(clinicA.tenantId, clinicB.tenantId);
    cleanup.users.push(clinicA.userId, clinicB.userId, adminId);

    const phoneA = `+91 85${String(Date.now()).slice(-8)}`;
    const bookPhone = `+91 84${String(Date.now() + 9).slice(-8)}`;
    cleanup.phones.push(phoneA, bookPhone);
    const patientId = `pat-own-a-${suffix}`;
    const appointmentId = `appt-own-a-${suffix}`;
    cleanup.patients.push(patientId);
    cleanup.appointments.push(appointmentId);
    const storedName = `ZXQROWA ${suffix}`;
    const uhid = `UHID-A-${suffix}`;
    const tokenNumber = 870000 + (Date.now() % 1000);
    insertPatient({ id: patientId, tenantId: clinicA.tenantId, name: storedName, phone: phoneA, uhid });
    getDb()
      .prepare(
        `INSERT INTO appointments (
           id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name,
           specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'doc-a', 'Dr SecretA', 'ZXQSPEC', '2026-10-19', '09:00 AM', 'New Consultation', 'Waiting', 'Desk', 0, 0, ?)`
      )
      .run(appointmentId, clinicA.tenantId, tokenNumber, patientId, storedName, phoneA, uhid, now);

    const token = await login(adminEmail);
    const auth = { Authorization: `Bearer ${token}` };
    const secrets = [storedName, uhid, String(tokenNumber), "Dr SecretA", `ZXQCLINICA ${suffix}`];

    const booked = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      { patientPhone: bookPhone, patientName: "Booker Name", sender: "user", content: "book dr. siddharth", tenantId: clinicA.tenantId },
      auth
    );
    assert.equal(booked.status, 201, String(booked.json.error || ""));
    const bookedBody = JSON.stringify(booked.json);
    for (const secret of secrets) assert.equal(bookedBody.includes(secret), false, `book leaked ${secret}`);
    const bookDigits = bookPhone.replace(/\D/g, "").slice(-10);
    const bookedRows = getDb()
      .prepare("SELECT id, tenant_id, patient_phone FROM appointments WHERE tenant_id = ?")
      .all(clinicB.tenantId) as { id: string; tenant_id: string; patient_phone: string }[];
    assert.ok(bookedRows.length >= 1);
    for (const row of bookedRows) {
      cleanup.appointments.push(row.id);
      assert.equal(row.tenant_id, clinicB.tenantId);
      assert.equal(String(row.patient_phone || "").replace(/\D/g, "").endsWith(bookDigits), true);
    }
    const patientsInA = getDb().prepare("SELECT id, phone FROM patients WHERE tenant_id = ?").all(clinicA.tenantId) as {
      id: string;
      phone: string;
    }[];
    assert.equal(
      patientsInA.some((row) => row.phone === bookPhone || String(row.phone || "").replace(/\D/g, "").endsWith(bookDigits)),
      false
    );
    const bookedPatients = getDb().prepare("SELECT id, phone FROM patients WHERE tenant_id = ?").all(clinicB.tenantId) as {
      id: string;
      phone: string;
    }[];
    for (const row of bookedPatients) {
      if (String(row.phone || "").replace(/\D/g, "").endsWith(bookDigits)) cleanup.patients.push(row.id);
    }

    const queued = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      { patientPhone: phoneA, patientName: "Caller Name", sender: "user", content: "queue", tenantId: clinicA.tenantId },
      auth
    );
    assert.equal(queued.status, 201, String(queued.json.error || ""));
    const queuedBody = JSON.stringify(queued.json);
    for (const secret of secrets) assert.equal(queuedBody.includes(secret), false, `queue leaked ${secret}`);

    const cancelled = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      { patientPhone: phoneA, patientName: "Caller Name", sender: "user", content: "❌ cancel", tenantId: clinicA.tenantId },
      auth
    );
    assert.equal(cancelled.status, 201, String(cancelled.json.error || ""));
    const cancelledBody = JSON.stringify(cancelled.json);
    for (const secret of secrets) assert.equal(cancelledBody.includes(secret), false, `cancel leaked ${secret}`);

    const appointment = getDb().prepare("SELECT status, tenant_id FROM appointments WHERE id = ?").get(appointmentId) as {
      status: string;
      tenant_id: string;
    };
    assert.equal(appointment.status, "Waiting");
    assert.equal(appointment.tenant_id, clinicA.tenantId);
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS c FROM appointments WHERE tenant_id = ?").get(clinicA.tenantId) as { c: number }).c,
      1
    );
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS c FROM whatsapp_messages WHERE tenant_id = ?").get(clinicA.tenantId) as { c: number }).c,
      0
    );
  });

  it("two patients in one clinic who share the last 10 digits collide", () => {
    // TODO(#168): exact E.164 matching waits for isDemoWhatsAppAllowlisted
    // (graph-whatsapp.ts: digits only, country code included). That helper is
    // not on main. The SELECT has no ORDER BY, so last-10 makes both numbers
    // resolve to the same row. After #168, each phone should return only its
    // own patient.
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const clinic = createClinic("phiE164");
    cleanup.tenants.push(clinic.tenantId);
    cleanup.users.push(clinic.userId);
    const national = `9${String(Date.now()).slice(-9)}`;
    const firstId = `pat-e164-a-${suffix}`;
    const secondId = `pat-e164-b-${suffix}`;
    cleanup.patients.push(firstId, secondId);
    insertPatient({
      id: firstId,
      tenantId: clinic.tenantId,
      name: "First Twin",
      phone: `+91${national}`,
      uhid: `UHID-E1-${suffix}`,
    });
    insertPatient({
      id: secondId,
      tenantId: clinic.tenantId,
      name: "Second Twin",
      phone: `+1${national}`,
      uhid: `UHID-E2-${suffix}`,
    });

    const byIndia = findPatientByPhoneInTenant(clinic.tenantId, `+91${national}`);
    const byOther = findPatientByPhoneInTenant(clinic.tenantId, `+1${national}`);
    assert.equal(String(byIndia?.id || ""), String(byOther?.id || ""));
    assert.ok([firstId, secondId].includes(String(byIndia?.id || "")));
  });
});

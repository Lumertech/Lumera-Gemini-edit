import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { clinicCalendarDate, shiftIsoDate } from "../src/lib/clinicDay.ts";
import { createApiRouter } from "./api.ts";
import {
  AMBIENT_SCRIBE_CONSENT_TEXT,
  AMBIENT_WALKIN_SOURCE,
  hasAmbientScribeConsent,
  istClinicDay,
  mountAmbientScribeConsentRoutes,
} from "./ambient-scribe-consent.ts";
import { listTenantAppointments, nextTokenNumber } from "./clinical.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

function seedDoctor(label: string, role = "doctor") {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-asc-${label}-${suffix}`;
  const userId = `user-asc-${label}-${suffix}`;
  const email = `asc.${label}.${suffix}@scribe-consent.example`.toLowerCase();
  const phone = `+91${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', ?, ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Consent ${label}`, phone, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(userId, tenantId, email, hashPassword("Lumera@2026"), `Dr ${label}`, role, `${phone}1`, `Clinic ${label}`, now, now);
  return { tenantId, userId, email };
}

describe("ambient scribe per-visit consent", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
      mountAmbientScribeConsentRoutes(app);
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    await close?.();
  });

  async function login(email: string) {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || "login failed"));
    return String(res.json.token || "");
  }

  it("records one audit per appointment and does not grant the health-document consent", async () => {
    assert.equal(
      AMBIENT_SCRIBE_CONSENT_TEXT,
      "I have told the patient that this consult will be recorded and transcribed by an AI service to draft notes, and the patient agreed. Audio is not stored."
    );
    const doctor = seedDoctor("doc");
    const token = await login(doctor.email);
    const auth = { Authorization: `Bearer ${token}` };
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Meera Iyer", phone: `+91 98${String(Date.now()).slice(-8)}`, age: 34, gender: "Female" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);
    const patientRow = getDb()
      .prepare("SELECT name, phone, uhid FROM patients WHERE id = ?")
      .get(patientId) as { name: string; phone: string; uhid: string };
    const appointmentId = `apt-${patientId}`;
    getDb()
      .prepare(
        `INSERT INTO appointments (
          id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name,
          specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 'General Medicine', ?, '10:00', 'New Consultation', 'Waiting', 'Walk-in', 0, 0, ?)`
      )
      .run(
        appointmentId,
        doctor.tenantId,
        patientId,
        patientRow.name,
        patientRow.phone,
        patientRow.uhid,
        doctor.userId,
        "Dr doc",
        istClinicDay(),
        new Date().toISOString()
      );

    const before = await jsonRequest(
      port,
      "GET",
      `/api/ambient-scribe/consent?appointmentId=${encodeURIComponent(appointmentId)}`,
      undefined,
      auth
    );
    assert.equal(before.status, 200);
    assert.equal(before.json.confirmed, false);

    const saved = await jsonRequest(
      port,
      "POST",
      "/api/ambient-scribe/consent",
      { appointmentId, patientId, attested: true, statement: AMBIENT_SCRIBE_CONSENT_TEXT },
      auth
    );
    assert.equal(saved.status, 201, String(saved.json.error || ""));
    assert.equal(saved.json.confirmed, true);

    const again = await jsonRequest(
      port,
      "GET",
      `/api/ambient-scribe/consent?appointmentId=${encodeURIComponent(appointmentId)}`,
      undefined,
      auth
    );
    assert.equal(again.status, 200);
    assert.equal(again.json.confirmed, true);
    assert.equal(typeof again.json.recordedAt, "string");

    const other = await jsonRequest(
      port,
      "GET",
      `/api/ambient-scribe/consent?appointmentId=${encodeURIComponent(appointmentId)}-other`,
      undefined,
      auth
    );
    assert.equal(other.json.confirmed, false);

    const row = getDb()
      .prepare(
        `SELECT user_id, tenant_id, entity_id, timestamp, details FROM audit_logs
         WHERE action = 'ambient_scribe_consent' AND tenant_id = ? AND entity_id = ?`
      )
      .get(doctor.tenantId, appointmentId) as {
      user_id: string;
      tenant_id: string;
      entity_id: string;
      timestamp: string;
      details: string;
    };
    assert.equal(row.user_id, doctor.userId);
    assert.equal(row.tenant_id, doctor.tenantId);
    assert.equal(row.entity_id, appointmentId);
    assert.match(row.timestamp, /T/);
    assert.equal(row.details.includes("phi-transcript"), false);

    const duplicate = await jsonRequest(
      port,
      "POST",
      "/api/ambient-scribe/consent",
      { appointmentId, patientId, attested: true, statement: AMBIENT_SCRIBE_CONSENT_TEXT },
      auth
    );
    assert.equal(duplicate.status, 200);
    const count = getDb()
      .prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'ambient_scribe_consent' AND tenant_id = ? AND entity_id = ?")
      .get(doctor.tenantId, appointmentId) as { c: number };
    assert.equal(Number(count.c), 1);

    const documents = await jsonRequest(port, "GET", `/api/patients/${patientId}/document-consent`, undefined, auth);
    assert.equal(documents.status, 200);
    assert.equal(documents.json.active, false);

    const anonymous = await jsonRequest(port, "POST", "/api/ambient-scribe/consent", {
      appointmentId,
      patientId,
      attested: true,
      statement: AMBIENT_SCRIBE_CONSENT_TEXT,
    });
    assert.equal(anonymous.status, 401);

    const desk = seedDoctor("desk", "receptionist");
    const deskToken = await login(desk.email);
    const denied = await jsonRequest(
      port,
      "POST",
      "/api/ambient-scribe/consent",
      { appointmentId: "apt-desk", patientId, attested: true, statement: AMBIENT_SCRIBE_CONSENT_TEXT },
      { Authorization: `Bearer ${deskToken}` }
    );
    assert.equal(denied.status, 403);
  });

  it("rejects an appointment that is missing or belongs to another patient, and mints a walk-in id", async () => {
    const doctor = seedDoctor("own");
    const token = await login(doctor.email);
    const auth = { Authorization: `Bearer ${token}` };
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Arun Shah", phone: `+91 97${String(Date.now()).slice(-8)}`, age: 41, gender: "Male" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);
    const other = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Lata Shah", phone: `+91 96${String(Date.now()).slice(-8)}`, age: 38, gender: "Female" },
      auth
    );
    assert.equal(other.status, 201, String(other.json.error || ""));
    const otherPatientId = String((other.json.patient as { id: string }).id);
    const patientRow = getDb()
      .prepare("SELECT name, phone, uhid FROM patients WHERE id = ?")
      .get(patientId) as { name: string; phone: string; uhid: string };
    const appointmentId = `apt-owned-${patientId}`;
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO appointments (
          id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name,
          specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at
        ) VALUES (?, ?, 2, ?, ?, ?, ?, ?, ?, 'General Medicine', ?, '11:00', 'New Consultation', 'Waiting', 'Walk-in', 0, 0, ?)`
      )
      .run(
        appointmentId,
        doctor.tenantId,
        patientId,
        patientRow.name,
        patientRow.phone,
        patientRow.uhid,
        doctor.userId,
        "Dr own",
        istClinicDay(),
        now
      );

    const invented = "client-made-visit-key";
    const unknown = await jsonRequest(
      port,
      "POST",
      "/api/ambient-scribe/consent",
      { appointmentId: invented, patientId, attested: true, statement: AMBIENT_SCRIBE_CONSENT_TEXT },
      auth
    );
    assert.equal(unknown.status, 404);
    const inventedRow = getDb().prepare("SELECT id FROM appointments WHERE id = ?").get(invented);
    assert.equal(inventedRow, undefined);

    const mismatch = await jsonRequest(
      port,
      "POST",
      "/api/ambient-scribe/consent",
      { appointmentId, patientId: otherPatientId, attested: true, statement: AMBIENT_SCRIBE_CONSENT_TEXT },
      auth
    );
    assert.equal(mismatch.status, 403);
    const mismatchAudit = getDb()
      .prepare("SELECT id FROM audit_logs WHERE action = 'ambient_scribe_consent' AND entity_id = ? AND patient_id = ?")
      .get(appointmentId, otherPatientId);
    assert.equal(mismatchAudit, undefined);

    const minted = await jsonRequest(
      port,
      "POST",
      "/api/ambient-scribe/consent",
      { patientId, attested: true, statement: AMBIENT_SCRIBE_CONSENT_TEXT },
      auth
    );
    assert.equal(minted.status, 201, String(minted.json.error || ""));
    const mintedId = String(minted.json.appointmentId || "");
    assert.match(mintedId, /^apt-[a-f0-9]{32}$/);
    assert.notEqual(mintedId, invented);
    const stored = getDb()
      .prepare("SELECT patient_id, tenant_id FROM appointments WHERE id = ?")
      .get(mintedId) as { patient_id: string; tenant_id: string };
    assert.equal(stored.patient_id, patientId);
    assert.equal(stored.tenant_id, doctor.tenantId);
    const audit = getDb()
      .prepare("SELECT entity_id FROM audit_logs WHERE action = 'ambient_scribe_consent' AND tenant_id = ? AND entity_id = ?")
      .get(doctor.tenantId, mintedId) as { entity_id: string };
    assert.equal(audit.entity_id, mintedId);

    const byPatient = await jsonRequest(
      port,
      "GET",
      `/api/ambient-scribe/consent?patientId=${encodeURIComponent(patientId)}`,
      undefined,
      auth
    );
    assert.equal(byPatient.status, 200);
    assert.equal(byPatient.json.confirmed, true);
    assert.equal(byPatient.json.appointmentId, mintedId);

    const sentinel = await jsonRequest(
      port,
      "POST",
      "/api/ambient-scribe/consent",
      { appointmentId: "unscheduled", patientId: otherPatientId, attested: true, statement: AMBIENT_SCRIBE_CONSENT_TEXT },
      auth
    );
    assert.equal(sentinel.status, 201, String(sentinel.json.error || ""));
    assert.match(String(sentinel.json.appointmentId || ""), /^apt-[a-f0-9]{32}$/);
    assert.notEqual(sentinel.json.appointmentId, "unscheduled");
    const sentinelStored = getDb().prepare("SELECT id FROM appointments WHERE id = 'unscheduled'").get();
    assert.equal(sentinelStored, undefined);
  });

  function insertVisit(input: {
    id: string;
    tenantId: string;
    patientId: string;
    doctorId: string;
    date: string;
    status: string;
    tokenNumber?: number;
    source?: string;
    specialty?: string;
  }) {
    getDb()
      .prepare(
        `INSERT INTO appointments (
          id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name,
          specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at
        ) VALUES (?, ?, ?, ?, 'Visit', '+910000000000', 'UHID', ?, 'Dr', ?, ?, '10:00', 'New Consultation', ?, ?, 600, 0, ?)`
      )
      .run(
        input.id,
        input.tenantId,
        input.tokenNumber ?? 1,
        input.patientId,
        input.doctorId,
        input.specialty || "General Medicine",
        input.date,
        input.status,
        input.source || "Walk-in",
        new Date().toISOString()
      );
  }

  function recordConsent(tenantId: string, userId: string, patientId: string, appointmentId: string) {
    getDb()
      .prepare(
        `INSERT INTO audit_logs (
          id, timestamp, user_id, user_name, action, details, tenant_id, patient_id, actor_role, entity_type, entity_id
        ) VALUES (?, ?, ?, 'Dr', 'ambient_scribe_consent', 'recorded', ?, ?, 'doctor', 'appointment', ?)`
      )
      .run(`audit-${appointmentId}`, new Date().toISOString(), userId, tenantId, patientId, appointmentId);
  }

  it("asks again for yesterday's walk-in and rejects a closed visit", async () => {
    const doctor = seedDoctor("day");
    const token = await login(doctor.email);
    const auth = { Authorization: `Bearer ${token}` };
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Nila Rao", phone: `+91 95${String(Date.now()).slice(-8)}`, age: 29, gender: "Female" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);
    const today = istClinicDay();
    assert.equal(today, clinicCalendarDate(new Date(), "Asia/Kolkata"));
    const yesterday = shiftIsoDate(today, -1);
    const yesterdayId = `apt-yest-${patientId}`;
    insertVisit({
      id: yesterdayId,
      tenantId: doctor.tenantId,
      patientId,
      doctorId: doctor.userId,
      date: yesterday,
      status: "Open",
      source: AMBIENT_WALKIN_SOURCE,
      tokenNumber: 0,
    });
    recordConsent(doctor.tenantId, doctor.userId, patientId, yesterdayId);

    const askedAgain = await jsonRequest(
      port,
      "GET",
      `/api/ambient-scribe/consent?patientId=${encodeURIComponent(patientId)}`,
      undefined,
      auth
    );
    assert.equal(askedAgain.status, 200);
    assert.equal(askedAgain.json.confirmed, false);
    assert.equal(hasAmbientScribeConsent(doctor.tenantId, yesterdayId), false);

    for (const status of ["Completed", "Cancelled"]) {
      const id = `apt-${status}-${patientId}`;
      insertVisit({
        id,
        tenantId: doctor.tenantId,
        patientId,
        doctorId: doctor.userId,
        date: today,
        status,
      });
      recordConsent(doctor.tenantId, doctor.userId, patientId, id);
      const closed = await jsonRequest(
        port,
        "GET",
        `/api/ambient-scribe/consent?appointmentId=${encodeURIComponent(id)}`,
        undefined,
        auth
      );
      assert.equal(closed.json.confirmed, false, status);
      assert.equal(hasAmbientScribeConsent(doctor.tenantId, id), false, status);
      const rejected = await jsonRequest(
        port,
        "POST",
        "/api/ambient-scribe/consent",
        { appointmentId: id, patientId, attested: true, statement: AMBIENT_SCRIBE_CONSENT_TEXT },
        auth
      );
      assert.equal(rejected.status, 409, status);
      assert.equal(rejected.json.code, "visit_closed");
    }

    const openId = `apt-open-${patientId}`;
    insertVisit({
      id: openId,
      tenantId: doctor.tenantId,
      patientId,
      doctorId: doctor.userId,
      date: today,
      status: "Waiting",
    });
    recordConsent(doctor.tenantId, doctor.userId, patientId, openId);
    const open = await jsonRequest(
      port,
      "GET",
      `/api/ambient-scribe/consent?appointmentId=${encodeURIComponent(openId)}`,
      undefined,
      auth
    );
    assert.equal(open.json.confirmed, true);
    assert.equal(hasAmbientScribeConsent(doctor.tenantId, openId), true);
  });

  it("reuses today's open walk-in and keeps it out of the queue, tokens, and invoices", async () => {
    const doctor = seedDoctor("queue");
    getDb().prepare("UPDATE users SET specialty = ? WHERE id = ?").run("Physiotherapy & Rehabilitation", doctor.userId);
    getDb().prepare("UPDATE tenants SET specialty = ? WHERE id = ?").run("General Medicine", doctor.tenantId);
    const token = await login(doctor.email);
    const auth = { Authorization: `Bearer ${token}` };
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Kabir Sen", phone: `+91 94${String(Date.now()).slice(-8)}`, age: 46, gender: "Male" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);
    const today = istClinicDay();
    const queuedId = `apt-queue-${patientId}`;
    insertVisit({
      id: queuedId,
      tenantId: doctor.tenantId,
      patientId,
      doctorId: doctor.userId,
      date: today,
      status: "Waiting",
      tokenNumber: 4,
      source: "Walk-in",
    });
    const beforeToken = nextTokenNumber(doctor.tenantId, today);
    assert.equal(beforeToken, 5);

    const first = await jsonRequest(
      port,
      "POST",
      "/api/ambient-scribe/consent",
      { patientId, attested: true, statement: AMBIENT_SCRIBE_CONSENT_TEXT },
      auth
    );
    assert.equal(first.status, 201, String(first.json.error || ""));
    const visitId = String(first.json.appointmentId || "");
    const stored = getDb()
      .prepare(
        "SELECT token_number, status, source, specialty, consultation_fee, is_paid, date, doctor_id FROM appointments WHERE id = ?"
      )
      .get(visitId) as {
      token_number: number;
      status: string;
      source: string;
      specialty: string;
      consultation_fee: number;
      is_paid: number;
      date: string;
      doctor_id: string;
    };
    assert.equal(stored.source, AMBIENT_WALKIN_SOURCE);
    assert.equal(Number(stored.token_number), 0);
    assert.equal(stored.status, "Open");
    assert.equal(stored.specialty, "Physiotherapy & Rehabilitation");
    assert.notEqual(stored.specialty, "General Medicine");
    assert.equal(Number(stored.consultation_fee), 0);
    assert.equal(Number(stored.is_paid), 0);
    assert.equal(stored.date, today);
    assert.equal(stored.doctor_id, doctor.userId);
    assert.equal(nextTokenNumber(doctor.tenantId, today), beforeToken);
    const queued = listTenantAppointments(doctor.tenantId, today).map((row) => String(row.id));
    assert.equal(queued.includes(visitId), false);
    assert.equal(queued.includes(queuedId), true);
    const invoice = getDb().prepare("SELECT id FROM invoices WHERE appointment_id = ?").get(visitId);
    assert.equal(invoice, undefined);

    const second = await jsonRequest(
      port,
      "POST",
      "/api/ambient-scribe/consent",
      { patientId, attested: true, statement: AMBIENT_SCRIBE_CONSENT_TEXT },
      auth
    );
    assert.equal(second.status, 200, String(second.json.error || ""));
    assert.equal(second.json.appointmentId, visitId);
    const copies = getDb()
      .prepare("SELECT COUNT(*) AS c FROM appointments WHERE tenant_id = ? AND patient_id = ? AND source = ?")
      .get(doctor.tenantId, patientId, AMBIENT_WALKIN_SOURCE) as { c: number };
    assert.equal(Number(copies.c), 1);
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { clinicCalendarDate, shiftIsoDate } from "../src/lib/clinicDay.ts";
import { createApiRouter } from "./api.ts";
import { findTenantEncounterDoctor } from "./abdm-internal.ts";
import {
  AMBIENT_WALKIN_CLOSED_DUP_ACTION,
  AMBIENT_WALKIN_DUP_SOURCE,
  ensureAmbientWalkInUniqueIndex,
  HIDDEN_AMBIENT_SOURCES,
  hiddenVisitSourceSql,
  isHiddenVisitSource,
  isUniqueViolation,
  SQLITE_CONSTRAINT_UNIQUE,
  visitStatusIsOpen,
  openVisitStatusSql,
} from "./ambient-walkin.ts";
import {
  AMBIENT_SCRIBE_CONSENT_TEXT,
  AMBIENT_WALKIN_SOURCE,
  closeStaleAmbientWalkIns,
  hasAmbientScribeConsent,
  istClinicDay,
  mountAmbientScribeConsentRoutes,
  sweepStaleAmbientWalkIns,
} from "./ambient-scribe-consent.ts";
import { BOOTSTRAP_DDL } from "./db-bootstrap-ddl.ts";
import { listTenantAppointments, nextTokenNumber } from "./clinical.ts";
import { buildPatientTimeline } from "./patient-timeline.ts";
import { findActiveAppointment } from "./whatsapp-calendar-booking.ts";
import { runAppointmentReminders } from "./whatsapp-calendar-reminders.ts";
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

  it("agrees the open-status allowlist in SQL and JS, and closes a previous day's hidden walk-in", async () => {
    assert.equal(visitStatusIsOpen(null), false);
    assert.equal(visitStatusIsOpen(""), false);
    assert.equal(visitStatusIsOpen("   "), false);
    assert.equal(visitStatusIsOpen("Waiting"), true);
    assert.equal(visitStatusIsOpen("TRIAGE / VITALS"), true);
    assert.equal(visitStatusIsOpen("Checked-in"), true);
    const doctor = seedDoctor("allow");
    const token = await login(doctor.email);
    const auth = { Authorization: `Bearer ${token}` };
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Allow List", phone: `+91 93${String(Date.now()).slice(-8)}`, age: 40, gender: "Female" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);
    const today = istClinicDay();
    const statuses = ["Waiting", "Open", "Scheduled", "Confirmed", "Checked-in", "Triage / Vitals", "In Consultation", "", "Completed", "No-Show", "Archived"];
    for (const status of statuses) {
      const id = `apt-st-${status.replace(/[^A-Za-z0-9]+/g, "") || "empty"}-${patientId}`.slice(0, 80);
      insertVisit({
        id,
        tenantId: doctor.tenantId,
        patientId,
        doctorId: doctor.userId,
        date: today,
        status: status || "Waiting",
      });
      if (!status) getDb().prepare("UPDATE appointments SET status = '' WHERE id = ?").run(id);
      const sqlOpen = getDb()
        .prepare(`SELECT id FROM appointments WHERE id = ? AND ${openVisitStatusSql("status")}`)
        .get(id);
      assert.equal(Boolean(sqlOpen), visitStatusIsOpen(status), status || "(empty)");
    }

    const yesterday = shiftIsoDate(today, -1);
    const staleId = `apt-stale-${patientId}`;
    const realId = `apt-real-yest-${patientId}`;
    const todayHidden = `apt-today-hidden-${patientId}`;
    insertVisit({
      id: staleId,
      tenantId: doctor.tenantId,
      patientId,
      doctorId: doctor.userId,
      date: yesterday,
      status: "Open",
      source: AMBIENT_WALKIN_SOURCE,
      tokenNumber: 0,
    });
    insertVisit({
      id: realId,
      tenantId: doctor.tenantId,
      patientId,
      doctorId: doctor.userId,
      date: yesterday,
      status: "Waiting",
      source: "Walk-in",
    });
    insertVisit({
      id: todayHidden,
      tenantId: doctor.tenantId,
      patientId,
      doctorId: doctor.userId,
      date: today,
      status: "Open",
      source: AMBIENT_WALKIN_SOURCE,
      tokenNumber: 0,
    });
    const closed = closeStaleAmbientWalkIns();
    assert.ok(closed >= 1);
    const statusOf = (id: string) =>
      (getDb().prepare("SELECT status FROM appointments WHERE id = ?").get(id) as { status: string }).status;
    assert.equal(statusOf(staleId), "Completed");
    assert.equal(statusOf(realId), "Waiting");
    assert.equal(statusOf(todayHidden), "Open");

    const duplicateId = `apt-dup-${patientId}`;
    assert.throws(() =>
      insertVisit({
        id: duplicateId,
        tenantId: doctor.tenantId,
        patientId,
        doctorId: doctor.userId,
        date: today,
        status: "Open",
        source: AMBIENT_WALKIN_SOURCE,
        tokenNumber: 0,
      })
    );
    const kept = await jsonRequest(
      port,
      "POST",
      "/api/ambient-scribe/consent",
      { patientId, attested: true, statement: AMBIENT_SCRIBE_CONSENT_TEXT },
      auth
    );
    assert.equal(kept.status, 201, String(kept.json.error || ""));
    assert.equal(kept.json.appointmentId, todayHidden);
  });

  it("recognizes a unique violation by driver code", () => {
    assert.equal(isUniqueViolation({ code: "23505" }), true);
    assert.equal(isUniqueViolation({ code: "SQLITE_CONSTRAINT_UNIQUE" }), true);
    assert.equal(isUniqueViolation({ code: "ERR_SQLITE_ERROR", errcode: SQLITE_CONSTRAINT_UNIQUE }), true);
    assert.equal(isUniqueViolation({ code: "23503", message: "unique constraint failed" }), false);
    assert.equal(isUniqueViolation({ message: "UNIQUE constraint failed: appointments.source" }), false);
  });

  it("closes stale hidden walk-ins for one tenant", () => {
    const here = seedDoctor("staleHere");
    const other = seedDoctor("staleOther");
    const yesterday = shiftIsoDate(istClinicDay(), -1);
    const hereId = `apt-stale-here-${here.userId}`;
    const otherId = `apt-stale-other-${other.userId}`;
    insertVisit({
      id: hereId,
      tenantId: here.tenantId,
      patientId: `pat-${here.userId}`,
      doctorId: here.userId,
      date: yesterday,
      status: "Open",
      source: AMBIENT_WALKIN_SOURCE,
      tokenNumber: 0,
    });
    insertVisit({
      id: otherId,
      tenantId: other.tenantId,
      patientId: `pat-${other.userId}`,
      doctorId: other.userId,
      date: yesterday,
      status: "Open",
      source: AMBIENT_WALKIN_SOURCE,
      tokenNumber: 0,
    });
    const closed = closeStaleAmbientWalkIns(new Date(), here.tenantId);
    assert.ok(closed >= 1);
    const statusOf = (id: string) =>
      (getDb().prepare("SELECT status FROM appointments WHERE id = ?").get(id) as { status: string }).status;
    assert.equal(statusOf(hereId), "Completed");
    assert.equal(statusOf(otherId), "Open");
  });

  it("keeps both consent audits when a duplicate hidden walk-in is closed in place", async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, "ambient-walkin.ts"), "utf8");
    const migration = source.slice(source.indexOf("export function ensureAmbientWalkInUniqueIndex"));
    assert.doesNotMatch(migration, /DELETE\s+FROM\s+appointments/i);
    assert.match(source, /BEGIN IMMEDIATE/);
    assert.match(source, /AMBIENT_WALKIN_CLOSED_DUP_ACTION/);
    const auditDdl = BOOTSTRAP_DDL.split("CREATE TABLE IF NOT EXISTS audit_logs")[1]?.split("CREATE TABLE")[0] || "";
    assert.match(auditDdl, /user_id/);
    assert.doesNotMatch(auditDdl, /REFERENCES\s+appointments/i);
    const dialect = (getDb() as { dialect?: string }).dialect;
    if (dialect !== "postgres") {
      const keys = getDb().prepare("PRAGMA foreign_key_list(audit_logs)").all() as Array<{ table?: string }>;
      assert.equal(
        keys.some((row) => String(row.table || "").toLowerCase() === "appointments"),
        false
      );
    }
    for (const file of [
      "clinical.ts",
      "billing.ts",
      "patient-timeline.ts",
      "whatsapp-calendar-booking.ts",
      "whatsapp-calendar-reminders.ts",
      "whatsapp-tenant-resolve.ts",
      "abdm-internal.ts",
      "demo-book-dates.ts",
      "db-seed-clinical.ts",
    ]) {
      const text = fs.readFileSync(path.join(here, file), "utf8");
      assert.match(text, /hiddenVisitSourceSql|isHiddenVisitSource/);
    }

    const doctor = seedDoctor("dupkeep");
    const token = await login(doctor.email);
    const auth = { Authorization: `Bearer ${token}` };
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Dup Keep", phone: `+91 97${String(Date.now()).slice(-8)}`, age: 40, gender: "Male" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);
    const day = istClinicDay();
    const older = `old-${doctor.userId}`;
    const newer = `new-${doctor.userId}`;
    const realId = `real-${doctor.userId}`;
    const insert = getDb().prepare(
      `INSERT INTO appointments (
        id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name,
        specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at
      ) VALUES (?, ?, ?, ?, 'Visit', '+910000000000', 'UHID', ?, 'Dr', 'General Medicine', ?, '', 'Ambient scribe', 'Open', ?, 0, 0, ?)`
    );
    getDb().exec("DROP INDEX IF EXISTS idx_appointments_ambient_walkin");
    try {
      insert.run(older, doctor.tenantId, 50, patientId, doctor.userId, day, AMBIENT_WALKIN_SOURCE, "2020-01-01T00:00:00.000Z");
      insert.run(newer, doctor.tenantId, 0, patientId, doctor.userId, day, AMBIENT_WALKIN_SOURCE, "2099-01-01T00:00:00.000Z");
      recordConsent(doctor.tenantId, doctor.userId, patientId, older);
      recordConsent(doctor.tenantId, doctor.userId, patientId, newer);
      const consentBefore = getDb()
        .prepare(
          `SELECT COUNT(*) AS n FROM audit_logs
           WHERE action = 'ambient_scribe_consent' AND entity_id IN (?, ?)`
        )
        .get(older, newer) as { n: number };
      ensureAmbientWalkInUniqueIndex(getDb());

      const olderRow = getDb()
        .prepare("SELECT id, status, source, patient_phone FROM appointments WHERE id = ?")
        .get(older) as { id: string; status: string; source: string; patient_phone: string };
      const newerRow = getDb()
        .prepare("SELECT id, status, source, patient_phone FROM appointments WHERE id = ?")
        .get(newer) as { id: string; status: string; source: string; patient_phone: string };
      assert.equal(olderRow.id, older);
      assert.equal(olderRow.status, "Completed");
      assert.equal(olderRow.source, AMBIENT_WALKIN_DUP_SOURCE);
      assert.equal(newerRow.id, newer);
      assert.equal(newerRow.status, "Open");
      assert.equal(newerRow.source, AMBIENT_WALKIN_SOURCE);
      const consentAfter = getDb()
        .prepare(
          `SELECT COUNT(*) AS n FROM audit_logs
           WHERE action = 'ambient_scribe_consent' AND entity_id IN (?, ?)`
        )
        .get(older, newer) as { n: number };
      assert.equal(Number(consentAfter.n), Number(consentBefore.n));
      assert.equal(Number(consentAfter.n), 2);
      const closures = getDb()
        .prepare(
          `SELECT action, details, user_name, patient_id, tenant_id, entity_type, entity_id
           FROM audit_logs WHERE action = ? AND entity_id IN (?, ?)`
        )
        .all(AMBIENT_WALKIN_CLOSED_DUP_ACTION, older, newer) as Array<{
        action: string;
        details: string;
        user_name: string;
        patient_id: string;
        tenant_id: string;
        entity_type: string;
        entity_id: string;
      }>;
      assert.equal(closures.length, 1);
      assert.equal(closures[0].entity_id, older);
      assert.equal(closures[0].tenant_id, doctor.tenantId);
      assert.equal(closures[0].entity_type, "appointment");
      assert.equal(closures[0].user_name, "System");
      assert.equal(closures[0].patient_id, "");
      assert.equal(closures[0].details, "");
      const joined = getDb()
        .prepare(
          `SELECT apt.id AS id, apt.source AS source
           FROM audit_logs audit
           INNER JOIN appointments apt ON apt.id = audit.entity_id AND apt.tenant_id = audit.tenant_id
           WHERE audit.action = 'ambient_scribe_consent' AND audit.entity_id = ?`
        )
        .get(older) as { id: string; source: string };
      assert.equal(joined.id, older);
      assert.equal(joined.source, AMBIENT_WALKIN_DUP_SOURCE);
      assert.equal(isHiddenVisitSource(olderRow.source), true);
      assert.equal(isHiddenVisitSource(newerRow.source), true);
      const hidden = getDb()
        .prepare(`SELECT id FROM appointments WHERE id = ? AND ${hiddenVisitSourceSql()}`)
        .get(older, ...HIDDEN_AMBIENT_SOURCES);
      assert.equal(hidden, undefined);
      if (dialect !== "postgres") {
        const idx = getDb()
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_appointments_ambient_walkin'")
          .get() as { sql: string };
        assert.match(idx.sql, /source = 'ambient_walkin'/);
        assert.match(idx.sql, /lower\(trim\(COALESCE\(status/i);
        assert.match(idx.sql, /'open'/);
        assert.doesNotMatch(idx.sql, /completed/i);
      }

      insertVisit({
        id: realId,
        tenantId: doctor.tenantId,
        patientId,
        doctorId: doctor.userId,
        date: day,
        status: "Waiting",
        source: "Walk-in",
        tokenNumber: 2,
      });
      assert.equal(nextTokenNumber(doctor.tenantId, day), 3);
      const queued = listTenantAppointments(doctor.tenantId, day).map((row) => String(row.id));
      assert.equal(queued.includes(older), false);
      assert.equal(queued.includes(newer), false);
      assert.equal(queued.includes(realId), true);

      const active = findActiveAppointment({
        tenantId: doctor.tenantId,
        patientId,
        doctorId: doctor.userId,
        date: day,
      });
      assert.equal(String(active?.id || ""), realId);
      assert.equal(findActiveAppointment({ tenantId: doctor.tenantId, appointmentId: older }), undefined);
      assert.equal(findActiveAppointment({ tenantId: doctor.tenantId, appointmentId: newer }), undefined);

      const past = new Date("2000-01-01T00:00:00.000Z");
      const hiddenReminders = await runAppointmentReminders({
        now: past,
        tenantId: doctor.tenantId,
        appointmentId: newer,
      });
      assert.equal(hiddenReminders.sent.length + hiddenReminders.failed.length + hiddenReminders.skipped, 0);
      const visibleReminders = await runAppointmentReminders({
        now: past,
        tenantId: doctor.tenantId,
        appointmentId: realId,
      });
      assert.equal(visibleReminders.skipped, 1);

      const timeline = buildPatientTimeline(doctor.tenantId, patientId, "doctor").map((item) => item.id);
      assert.equal(timeline.includes(`visit:${older}`), false);
      assert.equal(timeline.includes(`visit:${newer}`), false);
      assert.equal(timeline.includes(`visit:${realId}`), true);

      getDb()
        .prepare(
          `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
           VALUES (?, ?, 'Dr Dup', 'MBBS', ?, 'General Medicine', 1, 0, '', '[]', '', '', ?, '', '', '', 1)`
        )
        .run(doctor.userId, doctor.userId, `REG-${doctor.userId}`, doctor.email);
      assert.equal(findTenantEncounterDoctor(doctor.tenantId, patientId, older), undefined);
      assert.equal(findTenantEncounterDoctor(doctor.tenantId, patientId, newer), undefined);
      assert.equal(findTenantEncounterDoctor(doctor.tenantId, patientId, realId)?.id, doctor.userId);

      const billedDup = await jsonRequest(
        port,
        "POST",
        "/api/invoices",
        { appointmentId: older, totalAmount: 100, items: [{ description: "Consult", quantity: 1, unitPrice: 100, total: 100 }] },
        auth
      );
      assert.equal(billedDup.status, 404);
      assert.equal(billedDup.json.error, "Appointment not found");
      const billedReal = await jsonRequest(
        port,
        "POST",
        "/api/invoices",
        { appointmentId: realId, totalAmount: 100, items: [{ description: "Consult", quantity: 1, unitPrice: 100, total: 100 }] },
        auth
      );
      assert.notEqual(billedReal.status, 404);

      const nextPhone = `+91 96${String(Date.now()).slice(-8)}`;
      const patched = await jsonRequest(port, "PATCH", `/api/patients/${patientId}`, { phone: nextPhone }, auth);
      assert.equal(patched.status, 200, String(patched.json.error || ""));
      const phoneOf = (id: string) =>
        (getDb().prepare("SELECT patient_phone FROM appointments WHERE id = ?").get(id) as { patient_phone: string }).patient_phone;
      assert.equal(phoneOf(older), "+910000000000");
      assert.equal(phoneOf(newer), "+910000000000");
      assert.notEqual(phoneOf(realId), "+910000000000");

      const patientUserId = `pu-${doctor.userId}`;
      const patientEmail = `pat.${doctor.userId}@scribe-consent.example`;
      getDb()
        .prepare(
          `INSERT INTO users (
             id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed,
             practice_type, specialty, last_login, created_at, patient_id
           ) VALUES (?, ?, ?, ?, 'Dup Keep', 'patient', 'active', ?, 'Clinic', 1, 'individual', '', ?, ?, ?)`
        )
        .run(
          patientUserId,
          doctor.tenantId,
          patientEmail,
          hashPassword("Lumera@2026"),
          `+91 95${String(Date.now()).slice(-8)}`,
          new Date().toISOString(),
          new Date().toISOString(),
          patientId
        );
      const patientToken = await login(patientEmail);
      const patientAuth = { Authorization: `Bearer ${patientToken}` };
      const hiddenGet = await jsonRequest(port, "GET", `/api/appointments/${older}`, undefined, patientAuth);
      assert.equal(hiddenGet.status, 404);
      const visibleGet = await jsonRequest(port, "GET", `/api/appointments/${realId}`, undefined, patientAuth);
      assert.equal(visibleGet.status, 200, String(visibleGet.json.error || ""));
      const prescriberGet = await jsonRequest(port, "GET", `/api/appointments/${older}`, undefined, auth);
      assert.equal(prescriberGet.status, 200, String(prescriberGet.json.error || ""));
    } finally {
      ensureAmbientWalkInUniqueIndex(getDb());
    }
  });

  it("mints a new walk-in when today's hidden visit is already completed", async () => {
    ensureAmbientWalkInUniqueIndex(getDb());
    const doctor = seedDoctor("closedtoday");
    const token = await login(doctor.email);
    const auth = { Authorization: `Bearer ${token}` };
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Closed Today", phone: `+91 94${String(Date.now()).slice(-8)}`, age: 28, gender: "Female" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);
    const body = { patientId, attested: true, statement: AMBIENT_SCRIBE_CONSENT_TEXT };
    const first = await jsonRequest(port, "POST", "/api/ambient-scribe/consent", body, auth);
    assert.equal(first.status, 201, String(first.json.error || ""));
    const firstId = String(first.json.appointmentId || "");
    getDb().prepare("UPDATE appointments SET status = 'Completed' WHERE id = ?").run(firstId);
    const second = await jsonRequest(port, "POST", "/api/ambient-scribe/consent", body, auth);
    assert.equal(second.status, 201, String(second.json.error || second.json.appointmentId || ""));
    const secondId = String(second.json.appointmentId || "");
    assert.notEqual(secondId, firstId);
    const rowOf = (id: string) =>
      getDb().prepare("SELECT status, source FROM appointments WHERE id = ?").get(id) as { status: string; source: string };
    assert.equal(rowOf(firstId).status, "Completed");
    assert.equal(rowOf(firstId).source, AMBIENT_WALKIN_SOURCE);
    assert.equal(rowOf(secondId).status, "Open");
    assert.equal(rowOf(secondId).source, AMBIENT_WALKIN_SOURCE);
  });

  it("logs the daily sweep count once per clinic day", () => {
    const here = seedDoctor("sweep");
    const yesterday = shiftIsoDate(istClinicDay(), -1);
    const firstId = `apt-sweep-${here.userId}`;
    const secondId = `apt-sweep2-${here.userId}`;
    insertVisit({
      id: firstId,
      tenantId: here.tenantId,
      patientId: `pat-a-${here.userId}`,
      doctorId: here.userId,
      date: yesterday,
      status: "Open",
      source: AMBIENT_WALKIN_SOURCE,
      tokenNumber: 0,
    });
    const state = { day: "" };
    const logs: string[] = [];
    const original = console.info;
    console.info = (...args: unknown[]) => {
      logs.push(args.map((part) => String(part)).join(" "));
    };
    try {
      const closed = sweepStaleAmbientWalkIns(new Date(), state);
      assert.ok(closed >= 1);
      assert.match(logs.join("\n"), new RegExp(`ambient walk-in daily sweep closed ${closed}$`, "m"));
      const statusOf = (id: string) =>
        (getDb().prepare("SELECT status FROM appointments WHERE id = ?").get(id) as { status: string }).status;
      assert.equal(statusOf(firstId), "Completed");
      insertVisit({
        id: secondId,
        tenantId: here.tenantId,
        patientId: `pat-b-${here.userId}`,
        doctorId: here.userId,
        date: yesterday,
        status: "Open",
        source: AMBIENT_WALKIN_SOURCE,
        tokenNumber: 0,
      });
      logs.length = 0;
      const again = sweepStaleAmbientWalkIns(new Date(), state);
      assert.equal(again, 0);
      assert.equal(logs.length, 0);
      assert.equal(statusOf(secondId), "Open");
    } finally {
      console.info = original;
    }
  });
});

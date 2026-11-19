import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

const NOTE = "MonsoonPenicillinNoteXYZ kept for the next visit";
const ALLERGY = "CashewChartOnly";
const DIAGNOSIS = "IssuedChartDiagnosisXYZ";

function createClinicUser(label: string, role: "doctor" | "receptionist" | "CLINIC_ADMIN" | "patient" = "doctor") {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const email = `${label}.${suffix}@patient-record.example`.toLowerCase();
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
  if (role !== "patient") {
    db.prepare(
      `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
       VALUES (?, ?, ?, '', '', 'General Medicine', 0, 600, '', '[]', '', ?, ?, '', '', '', 1)`
    ).run(doctorId, userId, `Dr ${label}`, `+91 90000 ${label.slice(0, 5).padEnd(5, "0")}`, email);
  }
  return { tenantId, userId, doctorId, email, role };
}

describe("longitudinal patient chart", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-patient-record";
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
  });

  async function login(email: string): Promise<string> {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || "login failed"));
    const token = String(res.json.token || "");
    assert.ok(token);
    return token;
  }

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  it("stores a note, diagnosis, vitals, and allergy on the chart and keeps them out of other tenants, reception text, and logs", async () => {
    const doctor = createClinicUser("chart-doc", "doctor");
    const desk = createClinicUser("chart-desk", "receptionist");
    // Reception must share the clinic. Rebuild the desk user onto the doctor's tenant.
    getDb().prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(doctor.tenantId, desk.userId);
    const other = createClinicUser("chart-other", "doctor");
    const doctorToken = await login(doctor.email);
    const deskToken = await login(desk.email);
    const otherToken = await login(other.email);

    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Chart Patient One", phone: "+91 98111 77001", age: 34, gender: "Female" },
      auth(doctorToken)
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patient = created.json.patient as { id: string; name: string; phone: string };

    const visit = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      {
        patientId: patient.id,
        doctorId: doctor.doctorId,
        date: "2026-11-02",
        timeSlot: "10:00 AM",
        type: "New Consultation",
      },
      auth(doctorToken)
    );
    assert.equal(visit.status, 201, String(visit.json.error || ""));
    const appointmentId = String((visit.json.appointment as { id: string }).id);

    const vitals = await jsonRequest(
      port,
      "PATCH",
      `/api/appointments/${appointmentId}`,
      { vitals: { recordedAt: "2026-11-02T04:30:00.000Z", bloodPressureSystolic: 118, bloodPressureDiastolic: 76, heartRate: 72 } },
      auth(doctorToken)
    );
    assert.equal(vitals.status, 200, String(vitals.json.error || ""));

    const now = new Date().toISOString();
    const suffix = patient.id.slice(-6);
    getDb()
      .prepare(
        `INSERT INTO prescriptions (
          id, tenant_id, rx_number, patient_id, patient_name, patient_phone, patient_uhid,
          doctor_id, doctor_name, doctor_specialty, doctor_reg_number, date, diagnosis, icd10_code,
          medicines, lab_tests, advice, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'UHID-C', ?, 'Dr Chart', 'General Medicine', 'REG-C', '2026-11-02', ?, 'J30.1', '[]', '[]', '[]', ?)`
      )
      .run(`rx-c-${suffix}`, doctor.tenantId, `RX-C-${suffix}`, patient.id, patient.name, patient.phone, doctor.doctorId, DIAGNOSIS, now);

    const note = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patient.id}/notes`,
      { body: NOTE, appointmentId },
      auth(doctorToken)
    );
    assert.equal(note.status, 201, String(note.json.error || ""));
    assert.equal((note.json.note as { body?: string }).body, NOTE);

    const allergies = await jsonRequest(
      port,
      "PATCH",
      `/api/patients/${patient.id}`,
      { allergies: [ALLERGY] },
      auth(doctorToken)
    );
    assert.equal(allergies.status, 200, String(allergies.json.error || ""));

    const chart = await jsonRequest(port, "GET", `/api/patients/${patient.id}/chart`, undefined, auth(doctorToken));
    assert.equal(chart.status, 200);
    const body = JSON.stringify(chart.json);
    assert.equal(body.includes(NOTE), true);
    assert.equal(body.includes(DIAGNOSIS), true);
    assert.equal(body.includes("BP 118/76"), true);
    assert.equal(((chart.json.patient as { allergies: string[] }).allergies || []).includes(ALLERGY), true);
    const timeline = (chart.json.timeline || []) as Array<{ type: string; summary: string }>;
    assert.equal(timeline.some((item) => item.type === "note" && item.summary.includes(NOTE.slice(0, 20))), true);

    const deskChart = await jsonRequest(port, "GET", `/api/patients/${patient.id}/chart`, undefined, auth(deskToken));
    assert.equal(deskChart.status, 200);
    const deskBody = JSON.stringify(deskChart.json);
    assert.equal(deskBody.includes(NOTE), false);
    assert.equal(deskBody.includes(DIAGNOSIS), false);
    assert.equal(deskBody.includes("Note recorded"), true);
    assert.equal(deskBody.includes("BP 118/76"), true);
    const deskNotes = (deskChart.json.notes || []) as Array<{ body?: string; redacted?: boolean }>;
    assert.equal(deskNotes[0]?.redacted, true);
    assert.equal(deskNotes[0]?.body, undefined);
    assert.equal(((deskChart.json.diagnoses as unknown[]) || []).length, 0);

    const stolen = await jsonRequest(port, "GET", `/api/patients/${patient.id}/chart`, undefined, auth(otherToken));
    assert.equal(stolen.status, 404);
    assert.equal(JSON.stringify(stolen.json).includes(NOTE), false);
    assert.equal(JSON.stringify(stolen.json).includes(patient.name), false);

    const anon = await jsonRequest(port, "GET", `/api/patients/${patient.id}/chart`);
    assert.equal(anon.status, 401);
    const anonNote = await jsonRequest(port, "POST", `/api/patients/${patient.id}/notes`, { body: NOTE });
    assert.equal(anonNote.status, 401);

    const deskWrite = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patient.id}/notes`,
      { body: "Desk must not write this sentence" },
      auth(deskToken)
    );
    assert.equal(deskWrite.status, 403);
    assert.equal(JSON.stringify(deskWrite.json).includes("Desk must not write"), false);

    const audits = getDb()
      .prepare("SELECT action, details FROM audit_logs WHERE patient_id = ?")
      .all(patient.id) as Array<{ action: string; details: string }>;
    const joined = JSON.stringify(audits);
    assert.equal(audits.some((row) => row.action === "clinical_note.recorded"), true);
    assert.equal(audits.some((row) => row.action === "patient.allergies.updated"), true);
    assert.equal(joined.includes(NOTE), false);
    assert.equal(joined.includes(ALLERGY), false);
    assert.equal(joined.includes(DIAGNOSIS), false);

    const email = `chart.patient.${suffix}@patient-record.example`;
    getDb()
      .prepare(
        `INSERT INTO users (
          id, tenant_id, email, password_hash, name, role, status, phone, clinic_name,
          onboarding_completed, practice_type, specialty, last_login, created_at, patient_id
        ) VALUES (?, ?, ?, ?, 'Chart Patient One', 'patient', 'active', ?, 'Clinic chart', 1, 'individual', 'General Medicine', ?, ?, ?)`
      )
      .run(`user-pat-${suffix}`, doctor.tenantId, email, hashPassword("Lumera@2026"), patient.phone, now, now, patient.id);
    const patientToken = await login(email);
    const own = await jsonRequest(port, "GET", `/api/patients/${patient.id}/chart`, undefined, auth(patientToken));
    assert.equal(own.status, 200);
    assert.equal(JSON.stringify(own.json).includes(NOTE), true);
    assert.equal(JSON.stringify(own.json).includes(DIAGNOSIS), true);
    const patientWrite = await jsonRequest(
      port,
      "POST",
      `/api/patients/${patient.id}/notes`,
      { body: "Patients do not write chart notes" },
      auth(patientToken)
    );
    assert.equal(patientWrite.status, 403);
  });
});

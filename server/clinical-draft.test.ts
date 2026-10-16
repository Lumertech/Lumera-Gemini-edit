import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

function createClinicUser(label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const email = `${label}.${suffix}@opd-test.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Clinic ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(
    userId,
    tenantId,
    email,
    hashPassword("Lumera@2026"),
    `Dr ${label}`,
    `+91 90000 ${label.slice(0, 5).padEnd(5, "0")}`,
    `Clinic ${label}`,
    now,
    now
  );
  return { tenantId, userId, email };
}

const RAW_TRANSCRIPT = "UNIQUE-RAW-TRANSCRIPT-NOT-IN-SOAP patient reports fever";

function fullDraft(patientId: string) {
  return {
    patientId,
    doctorId: "doctor-1",
    diagnosis: "DX-UNIQUE",
    icd10Code: "I20.9",
    chiefComplaints: ["crushing chest pain"],
    historyOfPresentIllness: "HPI-UNIQUE",
    pastMedicalHistory: "PMH-UNIQUE",
    reviewOfSystems: "ROS-UNIQUE",
    vitals: { recordedAt: "2026-10-15T02:00:00.000Z", heartRate: 88, spO2: 97 },
    physicalExamination: "EXAM-UNIQUE",
    clinicalFindings: ["finding-a"],
    differentialDiagnoses: ["DDX-1"],
    riskLevel: "High",
    medicines: [{ id: "med-a", drugName: "DRUG-A" }],
    labTests: [{ id: "lab-a", testName: "LAB-A" }],
    advice: ["ADVICE-A"],
    redFlags: ["syncope", "chest pain"],
    followUpDays: 11,
    followUpDate: "2026-10-26",
    performedTherapies: [{ id: "proc-a", name: "IFT-UNIQUE" }],
    aiSource: "pulse-local-parser",
    aiGeneratedAt: "2026-10-15T02:00:00.000Z",
    transcript: RAW_TRANSCRIPT,
  };
}

describe("prescription draft scoping and AI review gate", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-rx-draft";
    }
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
    const loginRes = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(loginRes.status, 200, String(loginRes.json.error || "login failed"));
    const token = String(loginRes.json.token || "");
    assert.ok(token);
    return token;
  }

  async function createPatient(auth: Record<string, string>, name: string, phone: string) {
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name, phone, age: 44, gender: "Male" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    return created.json.patient as { id: string; name: string };
  }

  it("denies cross-tenant draft GET and POST and restores every field", async () => {
    const clinicA = createClinicUser("draftA");
    const clinicB = createClinicUser("draftB");
    const tokenA = await login(clinicA.email);
    const tokenB = await login(clinicB.email);
    const authA = { Authorization: `Bearer ${tokenA}` };
    const authB = { Authorization: `Bearer ${tokenB}` };

    const patientA = await createPatient(authA, "Draft Patient A", `+91 98100 ${clinicA.tenantId.slice(-4)}`);
    const patientB = await createPatient(authB, "Draft Patient B", `+91 98200 ${clinicB.tenantId.slice(-4)}`);

    const saved = await jsonRequest(port, "POST", "/api/prescriptions/draft", fullDraft(patientA.id), authA);
    assert.equal(saved.status, 200, String(saved.json.error || ""));

    const stolenGet = await jsonRequest(port, "GET", `/api/prescriptions/draft/${patientA.id}`, undefined, authB);
    assert.equal(stolenGet.status, 404);

    const stolenPost = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions/draft",
      { ...fullDraft(patientA.id), diagnosis: "STOLEN" },
      authB
    );
    assert.equal(stolenPost.status, 404);

    const ownEmpty = await jsonRequest(port, "GET", `/api/prescriptions/draft/${patientB.id}`, undefined, authB);
    assert.equal(ownEmpty.status, 200);
    assert.equal(ownEmpty.json.draft, null);

    const loaded = await jsonRequest(port, "GET", `/api/prescriptions/draft/${patientA.id}`, undefined, authA);
    assert.equal(loaded.status, 200);
    const draft = loaded.json.draft as Record<string, unknown>;
    assert.equal(draft.historyOfPresentIllness, "HPI-UNIQUE");
    assert.equal(draft.pastMedicalHistory, "PMH-UNIQUE");
    assert.equal(draft.reviewOfSystems, "ROS-UNIQUE");
    assert.equal((draft.vitals as { heartRate: number }).heartRate, 88);
    assert.equal(draft.physicalExamination, "EXAM-UNIQUE");
    assert.deepEqual(draft.clinicalFindings, ["finding-a"]);
    assert.deepEqual(draft.differentialDiagnoses, ["DDX-1"]);
    assert.equal(draft.riskLevel, "High");
    assert.deepEqual(draft.redFlags, ["syncope", "chest pain"]);
    assert.equal(draft.followUpDays, 11);
    assert.equal((draft.performedTherapies as Array<{ name: string }>)[0].name, "IFT-UNIQUE");
    assert.equal(draft.diagnosis, "DX-UNIQUE");
    assert.equal(draft.transcript, undefined);
    assert.equal(
      draft.transcriptHash,
      createHash("sha256").update(RAW_TRANSCRIPT).digest("hex")
    );

    const row = getDb()
      .prepare("SELECT tenant_id, draft_json FROM prescription_drafts WHERE patient_id = ?")
      .get(patientA.id) as { tenant_id: string; draft_json: string };
    assert.equal(row.tenant_id, clinicA.tenantId);
    assert.equal(row.draft_json.includes(RAW_TRANSCRIPT), false);
    assert.equal(row.draft_json.includes("HPI-UNIQUE"), true);
  });

  it("rejects finalize of an AI draft without reviewedBy and accepts an explicit review", async () => {
    const clinic = createClinicUser("review");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const patient = await createPatient(auth, "Review Patient", `+91 98300 ${clinic.tenantId.slice(-4)}`);

    const blocked = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      {
        patientId: patient.id,
        diagnosis: "DX-UNIQUE",
        aiSource: "pulse-local-parser",
        aiGeneratedAt: "2026-10-15T02:00:00.000Z",
        medicines: [],
      },
      auth
    );
    assert.equal(blocked.status, 400);
    assert.match(String(blocked.json.error), /reviewedBy/);

    const signed = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      {
        patientId: patient.id,
        diagnosis: "DX-UNIQUE",
        aiSource: "pulse-local-parser",
        aiGeneratedAt: "2026-10-15T02:00:00.000Z",
        reviewedBy: clinic.userId,
        historyOfPresentIllness: "HPI-UNIQUE",
        redFlags: ["syncope"],
        followUpDays: 11,
        riskLevel: "High",
        medicines: [],
      },
      auth
    );
    assert.equal(signed.status, 201, String(signed.json.error || ""));
    const prescription = signed.json.prescription as {
      reviewedBy?: string;
      historyOfPresentIllness?: string;
      followUpDays?: number;
      riskLevel?: string;
      redFlags?: string[];
    };
    assert.equal(prescription.reviewedBy, clinic.userId);
    assert.equal(prescription.historyOfPresentIllness, "HPI-UNIQUE");
    assert.equal(prescription.followUpDays, 11);
    assert.equal(prescription.riskLevel, "High");
    assert.deepEqual(prescription.redFlags, ["syncope"]);

    const manual = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      { patientId: patient.id, diagnosis: "Handwritten note", medicines: [] },
      auth
    );
    assert.equal(manual.status, 201, String(manual.json.error || ""));
  });

  it("keeps visit drafts apart, drops them when the visit closes, and hides them from the chart list", async () => {
    const clinic = createClinicUser("visits");
    const other = createClinicUser("visits-b");
    const token = await login(clinic.email);
    const otherToken = await login(other.email);
    const auth = { Authorization: `Bearer ${token}` };
    const otherAuth = { Authorization: `Bearer ${otherToken}` };
    const patient = await createPatient(auth, "Visit Draft Patient", `+91 98400 ${clinic.tenantId.slice(-4)}`);

    async function book(timeSlot: string) {
      const res = await jsonRequest(
        port,
        "POST",
        "/api/appointments",
        { patientId: patient.id, date: "2026-10-16", timeSlot, doctorId: clinic.userId },
        auth
      );
      assert.equal(res.status, 201, String(res.json.error || ""));
      return res.json.appointment as { id: string };
    }

    const first = await book("09:00");
    const second = await book("09:30");
    const before = await jsonRequest(port, "GET", "/api/appointments?date=2026-10-16", undefined, auth);
    const beforeIds = ((before.json.appointments as Array<{ id: string }>) || []).map((row) => row.id).sort();

    const savedA = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions/draft",
      { ...fullDraft(patient.id), appointmentId: first.id, diagnosis: "VISIT-A", doctorId: clinic.userId },
      auth
    );
    assert.equal(savedA.status, 200, String(savedA.json.error || ""));
    const savedB = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions/draft",
      { ...fullDraft(patient.id), appointmentId: second.id, diagnosis: "VISIT-B", doctorId: other.userId },
      otherAuth
    );
    assert.equal(savedB.status, 404);

    const sameClinicOtherDoctor = `user-visits-peer-${clinic.tenantId.slice(-6)}`;
    getDb()
      .prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
         VALUES (?, ?, ?, ?, 'Dr Peer', 'doctor', 'active', '+91 90000 44444', 'Clinic visits', 1, 'individual', 'General Medicine', ?, ?)`
      )
      .run(
        sameClinicOtherDoctor,
        clinic.tenantId,
        `peer.${clinic.tenantId.slice(-6)}@opd-test.example`,
        hashPassword("Lumera@2026"),
        new Date().toISOString(),
        new Date().toISOString()
      );
    const peerToken = await login(`peer.${clinic.tenantId.slice(-6)}@opd-test.example`);
    const peerAuth = { Authorization: `Bearer ${peerToken}` };
    const savedPeer = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions/draft",
      { ...fullDraft(patient.id), appointmentId: second.id, diagnosis: "VISIT-B", doctorId: sameClinicOtherDoctor },
      peerAuth
    );
    assert.equal(savedPeer.status, 200, String(savedPeer.json.error || ""));

    const loadA = await jsonRequest(
      port,
      "GET",
      `/api/prescriptions/draft/${patient.id}?appointmentId=${encodeURIComponent(first.id)}`,
      undefined,
      auth
    );
    assert.equal((loadA.json.draft as { diagnosis: string }).diagnosis, "VISIT-A");
    const loadB = await jsonRequest(
      port,
      "GET",
      `/api/prescriptions/draft/${patient.id}?appointmentId=${encodeURIComponent(second.id)}`,
      undefined,
      peerAuth
    );
    assert.equal((loadB.json.draft as { diagnosis: string }).diagnosis, "VISIT-B");

    const listed = await jsonRequest(port, "GET", "/api/prescriptions", undefined, auth);
    const prescriptions = (listed.json.prescriptions as Array<{ diagnosis?: string }>) || [];
    assert.equal(prescriptions.some((row) => row.diagnosis === "VISIT-A" || row.diagnosis === "VISIT-B"), false);
    const queued = await jsonRequest(port, "GET", "/api/appointments?date=2026-10-16", undefined, auth);
    const queuedIds = ((queued.json.appointments as Array<{ id: string }>) || []).map((row) => row.id).sort();
    assert.deepEqual(queuedIds, beforeIds);
    assert.equal(JSON.stringify(queued.json).includes("VISIT-A"), false);

    const completed = await jsonRequest(port, "PATCH", `/api/appointments/${first.id}`, { status: "Completed" }, auth);
    assert.equal(completed.status, 200, String(completed.json.error || ""));
    const afterComplete = await jsonRequest(
      port,
      "GET",
      `/api/prescriptions/draft/${patient.id}?appointmentId=${encodeURIComponent(first.id)}`,
      undefined,
      auth
    );
    assert.equal(afterComplete.json.draft, null);
    const stillB = await jsonRequest(
      port,
      "GET",
      `/api/prescriptions/draft/${patient.id}?appointmentId=${encodeURIComponent(second.id)}`,
      undefined,
      auth
    );
    assert.equal((stillB.json.draft as { diagnosis: string }).diagnosis, "VISIT-B");

    const signed = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      { patientId: patient.id, appointmentId: second.id, diagnosis: "Signed note", medicines: [] },
      auth
    );
    assert.equal(signed.status, 201, String(signed.json.error || ""));
    const afterSign = await jsonRequest(
      port,
      "GET",
      `/api/prescriptions/draft/${patient.id}?appointmentId=${encodeURIComponent(second.id)}`,
      undefined,
      auth
    );
    assert.equal(afterSign.json.draft, null);
    const chart = await jsonRequest(port, "GET", "/api/prescriptions", undefined, auth);
    const diagnoses = ((chart.json.prescriptions as Array<{ diagnosis?: string }>) || []).map((row) => row.diagnosis);
    assert.equal(diagnoses.includes("Signed note"), true);
    assert.equal(diagnoses.includes("VISIT-A"), false);
    assert.equal(diagnoses.includes("VISIT-B"), false);

    const third = await book("10:00");
    const savedC = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions/draft",
      { ...fullDraft(patient.id), appointmentId: third.id, diagnosis: "VISIT-C" },
      auth
    );
    assert.equal(savedC.status, 200, String(savedC.json.error || ""));
    const cancelled = await jsonRequest(port, "PATCH", `/api/appointments/${third.id}`, { status: "Cancelled" }, auth);
    assert.equal(cancelled.status, 200, String(cancelled.json.error || ""));
    const afterCancel = await jsonRequest(
      port,
      "GET",
      `/api/prescriptions/draft/${patient.id}?appointmentId=${encodeURIComponent(third.id)}`,
      undefined,
      auth
    );
    assert.equal(afterCancel.json.draft, null);
  });

  it("rejects a draft whose appointment belongs to another patient", async () => {
    const clinic = createClinicUser("mismatch");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const owner = await createPatient(auth, "Visit Owner", `+91 98510 ${clinic.tenantId.slice(-4)}`);
    const other = await createPatient(auth, "Other Patient", `+91 98511 ${clinic.tenantId.slice(-4)}`);
    const booked = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      { patientId: owner.id, date: "2026-10-16", timeSlot: "12:00", doctorId: clinic.userId },
      auth
    );
    assert.equal(booked.status, 201, String(booked.json.error || ""));
    const appointmentId = (booked.json.appointment as { id: string }).id;

    const posted = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions/draft",
      { ...fullDraft(other.id), appointmentId, diagnosis: "WRONG-PATIENT" },
      auth
    );
    assert.equal(posted.status, 404);
    const loaded = await jsonRequest(
      port,
      "GET",
      `/api/prescriptions/draft/${other.id}?appointmentId=${encodeURIComponent(appointmentId)}`,
      undefined,
      auth
    );
    assert.equal(loaded.status, 404);
    const stored = getDb()
      .prepare("SELECT patient_id FROM prescription_drafts WHERE tenant_id = ? AND appointment_id = ?")
      .get(clinic.tenantId, appointmentId);
    assert.equal(stored, undefined);
  });

  it("rejects a cross-tenant doctor id on a draft", async () => {
    const clinic = createClinicUser("draft-doc");
    const other = createClinicUser("draft-doc-b");
    const now = new Date().toISOString();
    const receptionId = `user-desk-${clinic.tenantId.slice(-6)}`;
    const receptionEmail = `desk.${clinic.tenantId.slice(-6)}@opd-test.example`;
    getDb()
      .prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
         VALUES (?, ?, ?, ?, 'Desk Clerk', 'receptionist', 'active', '+91 90000 55555', 'Clinic draft-doc', 1, 'individual', 'General Medicine', ?, ?)`
      )
      .run(receptionId, clinic.tenantId, receptionEmail, hashPassword("Lumera@2026"), now, now);
    const foreignDoctorId = `doc-foreign-${other.tenantId.slice(-6)}`;
    getDb()
      .prepare(
        `INSERT INTO doctors (
           id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee,
           opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active
         ) VALUES (?, ?, 'Dr Foreign', '', 'REG-F', 'General Medicine', 1, 0, '', '[]', '', '', '', '', '', '', 1)`
      )
      .run(foreignDoctorId, other.userId);
    const token = await login(receptionEmail);
    const auth = { Authorization: `Bearer ${token}` };
    const patient = await createPatient(auth, "Desk Patient", `+91 98520 ${clinic.tenantId.slice(-4)}`);
    const saved = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions/draft",
      { ...fullDraft(patient.id), doctorId: foreignDoctorId, diagnosis: "FOREIGN-DOC" },
      auth
    );
    assert.equal(saved.status, 400);
    assert.match(String(saved.json.error), /Consulting doctor/);
    const stored = getDb()
      .prepare("SELECT doctor_id FROM prescription_drafts WHERE tenant_id = ? AND patient_id = ?")
      .get(clinic.tenantId, patient.id);
    assert.equal(stored, undefined);
  });

  it("clears only this patient's visit draft and records the deletion", async () => {
    const clinic = createClinicUser("draft-del");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const patient = await createPatient(auth, "Signed Patient", `+91 98530 ${clinic.tenantId.slice(-4)}`);
    const neighbour = await createPatient(auth, "Neighbour Patient", `+91 98531 ${clinic.tenantId.slice(-4)}`);

    async function book(patientId: string, timeSlot: string) {
      const res = await jsonRequest(
        port,
        "POST",
        "/api/appointments",
        { patientId, date: "2026-10-16", timeSlot, doctorId: clinic.userId },
        auth
      );
      assert.equal(res.status, 201, String(res.json.error || ""));
      return res.json.appointment as { id: string };
    }

    const visit = await book(patient.id, "13:00");
    const otherVisit = await book(neighbour.id, "13:30");
    const saved = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions/draft",
      { ...fullDraft(patient.id), appointmentId: visit.id, diagnosis: "KEEP-UNTIL-SIGN" },
      auth
    );
    assert.equal(saved.status, 200, String(saved.json.error || ""));
    const neighbourDraft = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions/draft",
      { ...fullDraft(neighbour.id), appointmentId: otherVisit.id, diagnosis: "NEIGHBOUR" },
      auth
    );
    assert.equal(neighbourDraft.status, 200, String(neighbourDraft.json.error || ""));
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO prescription_drafts (tenant_id, patient_id, appointment_id, doctor_id, draft_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        clinic.tenantId,
        neighbour.id,
        visit.id,
        clinic.userId,
        JSON.stringify({ diagnosis: "SAME-VISIT-OTHER-PATIENT" }),
        now
      );

    const signed = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      { patientId: patient.id, diagnosis: "Signed without visit id", medicines: [] },
      auth
    );
    assert.equal(signed.status, 201, String(signed.json.error || ""));
    assert.equal(signed.json.draftCleanupError, undefined);
    const afterSign = await jsonRequest(
      port,
      "GET",
      `/api/prescriptions/draft/${patient.id}?appointmentId=${encodeURIComponent(visit.id)}`,
      undefined,
      auth
    );
    assert.equal(afterSign.json.draft, null);
    const neighbourStill = await jsonRequest(
      port,
      "GET",
      `/api/prescriptions/draft/${neighbour.id}?appointmentId=${encodeURIComponent(otherVisit.id)}`,
      undefined,
      auth
    );
    assert.equal((neighbourStill.json.draft as { diagnosis: string }).diagnosis, "NEIGHBOUR");
    const sharedVisit = getDb()
      .prepare(
        "SELECT draft_json FROM prescription_drafts WHERE tenant_id = ? AND patient_id = ? AND appointment_id = ?"
      )
      .get(clinic.tenantId, neighbour.id, visit.id) as { draft_json: string } | undefined;
    assert.match(String(sharedVisit?.draft_json || ""), /SAME-VISIT-OTHER-PATIENT/);

    const signAudit = getDb()
      .prepare(
        "SELECT user_name, details FROM audit_logs WHERE action = ? AND details LIKE ? ORDER BY timestamp DESC LIMIT 1"
      )
      .get("Prescription draft deleted", `%patient ${patient.id}; appointment ${visit.id}; reason sign%`) as
      | { user_name: string; details: string }
      | undefined;
    assert.ok(signAudit);
    assert.match(signAudit.user_name, /draft-del/);
    assert.match(signAudit.details, new RegExp(`tenant ${clinic.tenantId}`));

    const next = await book(patient.id, "14:00");
    const again = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions/draft",
      { ...fullDraft(patient.id), appointmentId: next.id, diagnosis: "CLOSE-ME" },
      auth
    );
    assert.equal(again.status, 200, String(again.json.error || ""));
    const completed = await jsonRequest(port, "PATCH", `/api/appointments/${next.id}`, { status: "Completed" }, auth);
    assert.equal(completed.status, 200, String(completed.json.error || ""));
    const afterComplete = await jsonRequest(
      port,
      "GET",
      `/api/prescriptions/draft/${patient.id}?appointmentId=${encodeURIComponent(next.id)}`,
      undefined,
      auth
    );
    assert.equal(afterComplete.json.draft, null);
    const neighbourAfterComplete = await jsonRequest(
      port,
      "GET",
      `/api/prescriptions/draft/${neighbour.id}?appointmentId=${encodeURIComponent(otherVisit.id)}`,
      undefined,
      auth
    );
    assert.equal((neighbourAfterComplete.json.draft as { diagnosis: string }).diagnosis, "NEIGHBOUR");
    const completeAudit = getDb()
      .prepare("SELECT details FROM audit_logs WHERE action = ? AND details LIKE ?")
      .get("Prescription draft deleted", `%appointment ${next.id}; reason Completed%`) as { details: string } | undefined;
    assert.match(String(completeAudit?.details || ""), new RegExp(`patient ${patient.id}`));
    assert.match(String(completeAudit?.details || ""), new RegExp(`tenant ${clinic.tenantId}`));

    const last = await book(patient.id, "14:30");
    const cancelDraft = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions/draft",
      { ...fullDraft(patient.id), appointmentId: last.id, diagnosis: "CANCEL-ME" },
      auth
    );
    assert.equal(cancelDraft.status, 200, String(cancelDraft.json.error || ""));
    const cancelled = await jsonRequest(port, "PATCH", `/api/appointments/${last.id}`, { status: "Cancelled" }, auth);
    assert.equal(cancelled.status, 200, String(cancelled.json.error || ""));
    const cancelAudit = getDb()
      .prepare("SELECT details FROM audit_logs WHERE action = ? AND details LIKE ?")
      .get("Prescription draft deleted", `%appointment ${last.id}; reason Cancelled%`) as { details: string } | undefined;
    assert.match(String(cancelAudit?.details || ""), new RegExp(`patient ${patient.id}`));
    const neighbourAfter = getDb()
      .prepare("SELECT patient_id FROM prescription_drafts WHERE tenant_id = ? AND patient_id = ?")
      .all(clinic.tenantId, neighbour.id) as Array<{ patient_id: string }>;
    assert.equal(neighbourAfter.length, 2);
  });

  it("returns a fixed draft error and keeps the database message in the log", async () => {
    const clinic = createClinicUser("draft-err");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const patient = await createPatient(auth, "Error Patient", `+91 98540 ${clinic.tenantId.slice(-4)}`);
    const marker = "no such table: prescription_drafts";
    const logged: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args.map((part) => String(part)).join(" "));
      original.apply(console, args);
    };
    const hide = () => getDb().exec("ALTER TABLE prescription_drafts RENAME TO prescription_drafts__hidden");
    const restore = () => getDb().exec("ALTER TABLE prescription_drafts__hidden RENAME TO prescription_drafts");
    try {
      hide();
      const saved = await jsonRequest(
        port,
        "POST",
        "/api/prescriptions/draft",
        { ...fullDraft(patient.id), diagnosis: "SHOULD-NOT-LEAK" },
        auth
      );
      assert.equal(saved.status, 500);
      assert.equal(saved.json.error, "draft_save_failed");
      assert.equal(JSON.stringify(saved.json).includes(marker), false);
      assert.equal(JSON.stringify(saved.json).includes("SQLITE"), false);
      restore();

      const seeded = await jsonRequest(
        port,
        "POST",
        "/api/prescriptions/draft",
        { ...fullDraft(patient.id), diagnosis: "BEFORE-CLEANUP" },
        auth
      );
      assert.equal(seeded.status, 200, String(seeded.json.error || ""));
      hide();
      const signed = await jsonRequest(
        port,
        "POST",
        "/api/prescriptions",
        { patientId: patient.id, diagnosis: "Signed while cleanup fails", medicines: [] },
        auth
      );
      assert.equal(signed.status, 201, String(signed.json.error || ""));
      assert.equal(signed.json.draftCleanupError, "draft_cleanup_failed");
      const signedBody = JSON.stringify(signed.json);
      assert.equal(signedBody.includes(marker), false);
      assert.equal(signedBody.includes("SQLITE"), false);
      assert.equal(signedBody.includes("prescription_drafts"), false);
    } finally {
      console.error = original;
      try {
        restore();
      } catch {
        /* the draft table already has its real name */
      }
    }
    assert.match(logged.join("\n"), /no such table: prescription_drafts/);
  });
});

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
});

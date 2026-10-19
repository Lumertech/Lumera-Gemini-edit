import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { requireAuth } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { mountGeminiClinicalRoutes, setGeminiSafetyCheckForTests } from "./gemini-clinical.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { recordWhatsAppOptIn } from "./whatsapp-opt-in.ts";
import { SAFETY_REVIEW_REQUIRED } from "./rx-safety-store.ts";
import { RULE_BASED_SAFETY_SOURCE } from "../src/lib/safetyCheckGate.ts";

const MEDICINE = {
  id: "med-amox",
  drugName: "Amoxicillin",
  composition: "amoxicillin",
  dosage: "500 mg",
  frequency: "1-0-1",
  durationDays: 5,
};

const SAFE_MEDICINE = {
  id: "med-para",
  drugName: "Paracetamol",
  composition: "paracetamol",
  dosage: "650 mg",
  frequency: "1-0-1",
  durationDays: 3,
};

function seedDoctor(label: string, role: "doctor" | "CLINIC_ADMIN" = "doctor") {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-safe-${label}-${suffix}`;
  const userId = `user-safe-${label}-${suffix}`;
  const email = `safe.${label}.${suffix}@rx-safety.example`.toLowerCase();
  const now = new Date().toISOString();
  const name = `Dr ${label} ${suffix}`;
  getDb()
    .prepare(
      `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
       VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', ?, ?, 500, 0, 1, '', ?, ?)`
    )
    .run(tenantId, `Clinic ${label}`, `+9180${suffix.slice(0, 8)}`, now, now, now);
  getDb()
    .prepare(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
    )
    .run(userId, tenantId, email, hashPassword("Lumera@2026"), name, role, `+9181${suffix.slice(0, 8)}`, `Clinic ${label}`, now, now);
  return { tenantId, userId, email, name };
}

function seedColleague(tenantId: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const userId = `user-safe-other-${suffix}`;
  const email = `safe.other.${suffix}@rx-safety.example`.toLowerCase();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
       VALUES (?, ?, ?, ?, 'Dr Other', 'doctor', 'active', ?, 'Clinic', 1, 'individual', 'General Medicine', ?, ?)`
    )
    .run(userId, tenantId, email, hashPassword("Lumera@2026"), `+9182${suffix.slice(0, 8)}`, now, now);
  return { userId, email };
}

describe("signed prescription safety override", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    setGeminiSafetyCheckForTests(async () => {
      throw new Error("boom");
    });
    const server = await startTestServer((app) => {
      app.use("/api/gemini", requireAuth);
      mountGeminiClinicalRoutes(app);
      app.use("/api", createApiRouter());
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    setGeminiSafetyCheckForTests(undefined);
    await close?.();
  });

  async function login(email: string) {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || "login"));
    return { Authorization: `Bearer ${String(res.json.token || "")}` };
  }

  async function createPatient(auth: Record<string, string>, phone: string, allergies: string[]) {
    const res = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Asha Rao", phone, age: 42, gender: "Female", allergies },
      auth
    );
    assert.ok(res.status === 200 || res.status === 201, String(res.json.error || res.status));
    return res.json.patient as { id: string };
  }

  async function checkSafety(auth: Record<string, string>, patientId: string, medicines: unknown, allergies: string[]) {
    return jsonRequest(
      port,
      "POST",
      "/api/gemini/safety-check",
      {
        patientId,
        patientAge: 42,
        patientGender: "Female",
        patientAllergies: allergies,
        chronicConditions: [],
        medicines,
      },
      auth
    );
  }

  async function signRx(
    auth: Record<string, string>,
    patientId: string,
    userId: string,
    medicines: unknown,
    extra: Record<string, unknown> = {}
  ) {
    return jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      {
        patientId,
        diagnosis: "Infection",
        medicines,
        doctorId: userId,
        doctorName: "Forged Name",
        reviewedBy: userId,
        ...extra,
      },
      auth
    );
  }

  it("stores REVIEW when Gemini throws and blocks WhatsApp send", async () => {
    const clinic = seedDoctor("fallback");
    const auth = await login(clinic.email);
    const phone = `+919811${String(Date.now()).slice(-7)}`;
    const patient = await createPatient(auth, phone, []);
    const checked = await checkSafety(auth, patient.id, [SAFE_MEDICINE], []);
    assert.equal(checked.status, 200, JSON.stringify(checked.json));
    assert.equal(checked.json.safetyStatus, "REVIEW");
    assert.equal(checked.json.source, RULE_BASED_SAFETY_SOURCE);
    assert.notEqual(checked.json.safetyStatus, "SAFE");
    const signed = await signRx(auth, patient.id, clinic.userId, [SAFE_MEDICINE]);
    assert.equal(signed.status, 201, JSON.stringify(signed.json));
    const rxNumber = String((signed.json.prescription as { rxNumber?: string }).rxNumber || "");
    const sent = await jsonRequest(port, "POST", "/api/whatsapp/send-rx", { rxNumber }, auth);
    assert.equal(sent.status, 409);
    assert.equal(sent.json.code, SAFETY_REVIEW_REQUIRED);
    assert.equal(JSON.stringify(sent.json).includes("HIGH_RISK"), false);
  });

  it("requires a typed treating-doctor override before a real HIGH_RISK check can be sent", async () => {
    const clinic = seedDoctor("high");
    const other = seedColleague(clinic.tenantId);
    const auth = await login(clinic.email);
    const otherAuth = await login(other.email);
    const phone = `+919812${String(Date.now()).slice(-7)}`;
    const patient = await createPatient(auth, phone, ["Penicillin"]);
    const checked = await checkSafety(auth, patient.id, [MEDICINE], ["Penicillin"]);
    assert.equal(checked.status, 200, JSON.stringify(checked.json));
    assert.equal(checked.json.safetyStatus, "HIGH_RISK");
    assert.equal(checked.json.source, RULE_BASED_SAFETY_SOURCE);
    const signed = await signRx(auth, patient.id, clinic.userId, [MEDICINE]);
    assert.equal(signed.status, 201, JSON.stringify(signed.json));
    const rxNumber = String((signed.json.prescription as { rxNumber?: string }).rxNumber || "");

    const blocked = await jsonRequest(port, "POST", "/api/whatsapp/send-rx", { rxNumber }, auth);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.code, SAFETY_REVIEW_REQUIRED);
    assert.equal(JSON.stringify(blocked.json).includes("HIGH_RISK"), false);

    const short = await jsonRequest(
      port,
      "POST",
      `/api/prescriptions/${encodeURIComponent(rxNumber)}/safety-override`,
      { reason: "too short", doctorName: "Forged Name" },
      auth
    );
    assert.equal(short.status, 400);

    const stranger = await jsonRequest(
      port,
      "POST",
      `/api/prescriptions/${encodeURIComponent(rxNumber)}/safety-override`,
      { reason: "I reviewed the penicillin allergy and still choose this antibiotic." },
      otherAuth
    );
    assert.equal(stranger.status, 403);

    const unsigned = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      {
        patientId: patient.id,
        diagnosis: "Unsigned",
        medicines: [MEDICINE],
        doctorId: clinic.userId,
        doctorName: "Forged Name",
      },
      auth
    );
    assert.equal(unsigned.status, 201, JSON.stringify(unsigned.json));
    const unsignedNumber = String((unsigned.json.prescription as { rxNumber?: string }).rxNumber || "");
    const beforeSign = await jsonRequest(
      port,
      "POST",
      `/api/prescriptions/${encodeURIComponent(unsignedNumber)}/safety-override`,
      { reason: "I reviewed the penicillin allergy and still choose this antibiotic." },
      auth
    );
    assert.equal(beforeSign.status, 409);

    const overridden = await jsonRequest(
      port,
      "POST",
      `/api/prescriptions/${encodeURIComponent(rxNumber)}/safety-override`,
      { reason: "I reviewed the penicillin allergy and still choose this antibiotic.", doctorName: "Forged Name" },
      auth
    );
    assert.equal(overridden.status, 200, JSON.stringify(overridden.json));
    const row = getDb()
      .prepare(`SELECT override_user_name, override_reason, override_alerts_json, rx_updated_at, patient_id FROM rx_signed_safety WHERE tenant_id = ? AND rx_number = ?`)
      .get(clinic.tenantId, rxNumber) as {
      override_user_name: string;
      override_reason: string;
      override_alerts_json: string;
      rx_updated_at: string;
      patient_id: string;
    };
    assert.equal(row.override_user_name, clinic.name);
    assert.equal(row.override_user_name.includes("Forged"), false);
    assert.match(row.override_reason, /penicillin allergy/);
    assert.match(row.override_alerts_json, /ALLERGY/);
    assert.ok(row.rx_updated_at);
    assert.equal(row.patient_id, patient.id);
    const audit = getDb()
      .prepare(`SELECT user_name, action, details FROM audit_logs WHERE action = 'safety_override' AND entity_id = ?`)
      .get(rxNumber) as { user_name: string; action: string; details: string };
    assert.equal(audit.user_name, clinic.name);
    assert.match(audit.details, new RegExp(rxNumber));
    assert.equal(audit.details.includes("Amoxicillin"), false);

    recordWhatsAppOptIn(getDb(), { tenantId: clinic.tenantId, phone, optedIn: true, source: "test", actorId: clinic.userId });
    const sent = await jsonRequest(port, "POST", "/api/whatsapp/send-rx", { rxNumber }, auth);
    assert.notEqual(sent.status, 409);
    assert.notEqual(sent.json.code, SAFETY_REVIEW_REQUIRED);

    getDb().prepare(`UPDATE patients SET age = 99 WHERE id = ? AND tenant_id = ?`).run(patient.id, clinic.tenantId);
    const rebound = await jsonRequest(port, "POST", "/api/whatsapp/send-rx", { rxNumber }, auth);
    assert.equal(rebound.status, 409);
    assert.equal(rebound.json.code, SAFETY_REVIEW_REQUIRED);
  });

  it("records the typed reason on sign and writes the override audit", async () => {
    const clinic = seedDoctor("onsign");
    const auth = await login(clinic.email);
    const phone = `+919813${String(Date.now()).slice(-7)}`;
    const patient = await createPatient(auth, phone, ["Penicillin"]);
    const checked = await checkSafety(auth, patient.id, [MEDICINE], ["Penicillin"]);
    assert.equal(checked.json.safetyStatus, "HIGH_RISK");
    const reason = "Reviewed the penicillin alert with the patient and kept this antibiotic.";
    const signed = await signRx(auth, patient.id, clinic.userId, [MEDICINE], { safetyOverrideReason: reason });
    assert.equal(signed.status, 201, JSON.stringify(signed.json));
    const rxNumber = String((signed.json.prescription as { rxNumber?: string }).rxNumber || "");
    const row = getDb()
      .prepare(`SELECT override_user_name, override_reason FROM rx_signed_safety WHERE tenant_id = ? AND rx_number = ?`)
      .get(clinic.tenantId, rxNumber) as { override_user_name: string; override_reason: string };
    assert.equal(row.override_user_name, clinic.name);
    assert.equal(row.override_reason, reason);
    const audit = getDb()
      .prepare(`SELECT action, user_name FROM audit_logs WHERE action = 'safety_override' AND entity_id = ?`)
      .get(rxNumber) as { action: string; user_name: string };
    assert.equal(audit.action, "safety_override");
    assert.equal(audit.user_name, clinic.name);
    recordWhatsAppOptIn(getDb(), { tenantId: clinic.tenantId, phone, optedIn: true, source: "test", actorId: clinic.userId });
    const sent = await jsonRequest(port, "POST", "/api/whatsapp/send-rx", { rxNumber }, auth);
    assert.notEqual(sent.json.code, SAFETY_REVIEW_REQUIRED);
  });
});

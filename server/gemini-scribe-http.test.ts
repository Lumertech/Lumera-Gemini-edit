import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { requireAuth } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { attachGeminiSoapRoute, setGeminiSoapGeneratorForTests } from "./gemini-soap-route.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import {
  applyWalletTransaction,
  estimateScribeMinutesFromTranscript,
  ensureUsageWalletSchema,
} from "./usage-billing.ts";

const STUB_SOAP = {
  subjective: { chiefComplaints: ["cough"], historyOfPresentIllness: "x", pastMedicalHistory: "", reviewOfSystems: "" },
  objective: { vitals: {}, physicalExamination: "", clinicalFindings: [] },
  assessment: { primaryDiagnosis: "URI", icd10Code: "J06.9", differentialDiagnoses: [], riskLevel: "Low" },
  plan: { medicines: [], labTests: [], lifestyleAdvice: [], redFlags: [], followUpDays: 5 },
  transcriptSummary: "stub",
};

function longTranscript(wordCount: number): string {
  return Array.from({ length: wordCount }, (_, i) => `word${i}`).join(" ");
}

function seedDoctor() {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-scribe-${suffix}`;
  const userId = `user-scribe-${suffix}`;
  const email = `scribe.${suffix}@scribe-http.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Scribe Clinic ${suffix}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(userId, tenantId, email, hashPassword("Lumera@2026"), `Dr Scribe ${suffix}`, `+91 91000 ${suffix.slice(0, 5)}`, `Scribe Clinic`, now, now);
  ensureUsageWalletSchema(db);
  return { tenantId, userId, email };
}

describe("HTTP AI Scribe metering", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  let clinic: { tenantId: string; email: string };

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret";
    process.env.GEMINI_SCRIBE_RAW_COST_INR = "10";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    clinic = seedDoctor();
    applyWalletTransaction(clinic.tenantId, "topup", 500, { note: "scribe http test float", createdBy: "test" });
    setGeminiSoapGeneratorForTests(async () => STUB_SOAP);
    const server = await startTestServer((app) => {
      app.use("/api/gemini", requireAuth);
      attachGeminiSoapRoute(app);
      app.use("/api", createApiRouter());
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    setGeminiSoapGeneratorForTests(undefined);
    await close?.();
  });

  async function login() {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email: clinic.email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || "login failed"));
    return String(res.json.token || "");
  }

  it("successful generation writes usage_events and a wallet debit", async () => {
    const token = await login();
    const transcript = "Patient has fever and cough for two days with body ache.";
    const beforeWallet = getDb().prepare("SELECT balance FROM tenant_wallets WHERE tenant_id = ?").get(clinic.tenantId) as {
      balance: number;
    };
    const res = await jsonRequest(
      port,
      "POST",
      "/api/gemini/generate-soap",
      { transcript, durationMinutes: 5 },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(res.status, 200, String(res.json.error || JSON.stringify(res.json)));
    assert.equal(res.json.success, true);
    const event = getDb()
      .prepare("SELECT quantity, raw_cost FROM usage_events WHERE tenant_id = ? AND resource = 'ai_scribe_minutes' ORDER BY created_at DESC LIMIT 1")
      .get(clinic.tenantId) as { quantity: number; raw_cost: number };
    assert.ok(event);
    assert.ok(Number(event.quantity) > 0);
    const debit = getDb()
      .prepare("SELECT amount FROM wallet_transactions WHERE tenant_id = ? AND type = 'usage_debit' ORDER BY created_at DESC LIMIT 1")
      .get(clinic.tenantId) as { amount: number };
    assert.ok(debit);
    assert.ok(Number(debit.amount) < 0);
    const afterWallet = getDb().prepare("SELECT balance FROM tenant_wallets WHERE tenant_id = ?").get(clinic.tenantId) as {
      balance: number;
    };
    assert.ok(Number(afterWallet.balance) < Number(beforeWallet.balance));
  });

  it("insufficient wallet balance returns 402", async () => {
    const empty = seedDoctor();
    const loginRes = await jsonRequest(port, "POST", "/api/auth/login", {
      email: empty.email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(loginRes.status, 200);
    const token = String(loginRes.json.token || "");
    const res = await jsonRequest(
      port,
      "POST",
      "/api/gemini/generate-soap",
      { transcript: "Short consult note about cough and fever today." },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(res.status, 402);
    assert.equal(res.json.code, "WALLET_INSUFFICIENT");
  });

  it("understated client durationMinutes does not reduce billed quantity", async () => {
    const token = await login();
    const transcript = longTranscript(1300);
    const estimated = estimateScribeMinutesFromTranscript(transcript);
    assert.ok(estimated >= 8, `expected ~10 min estimate, got ${estimated}`);
    const res = await jsonRequest(
      port,
      "POST",
      "/api/gemini/generate-soap",
      { transcript, durationMinutes: 1 },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(res.status, 200, String(res.json.error || JSON.stringify(res.json)));
    const event = getDb()
      .prepare("SELECT quantity FROM usage_events WHERE tenant_id = ? AND resource = 'ai_scribe_minutes' ORDER BY created_at DESC LIMIT 1")
      .get(clinic.tenantId) as { quantity: number };
    assert.equal(Number(event.quantity), estimated);
    assert.notEqual(Number(event.quantity), 1);
  });
});

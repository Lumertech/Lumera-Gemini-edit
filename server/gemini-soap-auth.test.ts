import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { mountGeminiClinicalRoutes, setGeminiSoapGeneratorForTests } from "./gemini-clinical.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function seedDoctor() {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-soap-${suffix}`;
  const userId = `user-soap-${suffix}`;
  const email = `soap.${suffix}@soap-auth.example`.toLowerCase();
  const phone = `+91${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', ?, ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Soap ${suffix}`, phone, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(userId, tenantId, email, hashPassword("Lumera@2026"), "Dr Soap", phone, "Clinic Soap", now, now);
  return { email };
}

describe("POST /api/gemini/generate-soap auth and errors", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret";
    setGeminiSoapGeneratorForTests(undefined);
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
      mountGeminiClinicalRoutes(app);
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    setGeminiSoapGeneratorForTests(undefined);
    await close?.();
  });

  it("requires auth on the route and returns a fixed code instead of an error message", async () => {
    const clinical = fs.readFileSync(path.join(root, "server/gemini-clinical.ts"), "utf8");
    const route = clinical.slice(
      clinical.indexOf('"/api/gemini/generate-soap"'),
      clinical.indexOf("const handleGeminiCopilot")
    );
    assert.match(route, /requireAuth/);
    assert.match(route, /soap_failed/);
    assert.doesNotMatch(route, /details:\s*error\.message/);
    assert.doesNotMatch(route, /json\(\{\s*error:\s*error\.message/);

    const anonymous = await jsonRequest(port, "POST", "/api/gemini/generate-soap", {
      transcript: "Patient has fever and cough for two days.",
    });
    assert.equal(anonymous.status, 401);

    const doctor = seedDoctor();
    const login = await jsonRequest(port, "POST", "/api/auth/login", {
      email: doctor.email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(login.status, 200, String(login.json.error || ""));
    setGeminiSoapGeneratorForTests(async () => {
      throw new Error("leak-soap-vendor-detail");
    });
    const failed = await jsonRequest(
      port,
      "POST",
      "/api/gemini/generate-soap",
      { transcript: "Patient has fever and cough for two days." },
      { Authorization: `Bearer ${login.json.token}` }
    );
    assert.equal(failed.status, 500);
    assert.equal(failed.json.code, "soap_failed");
    assert.equal(JSON.stringify(failed.json).includes("leak-soap-vendor-detail"), false);
  });
});

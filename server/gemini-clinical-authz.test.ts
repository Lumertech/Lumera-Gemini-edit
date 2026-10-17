import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import {
  mountGeminiClinicalRoutes,
  setGeminiCopilotGeneratorForTests,
  setGeminiSafetyCheckGeneratorForTests,
} from "./gemini-clinical.ts";
import { resetClinicalGeminiRateLimits, setClinicalGeminiRateLimitForTests } from "./gemini-clinical-rate-limit.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ROUTES = [
  "/api/gemini/copilot",
  "/api/gemini/pulse-assistant",
  "/api/gemini/hexa-assistant",
  "/api/gemini/safety-check",
] as const;

const LEAK = "leak-clinical-vendor-detail";
const PATIENT_MARKER = "SECRET_PATIENT_MARKER";

function seedUser(label: string, role: string, tenantId?: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const tenant = tenantId || `tenant-clin-${label}-${suffix}`;
  const userId = `user-clin-${label}-${suffix}`;
  const email = `clin.${label}.${suffix}@clinical-authz.example`.toLowerCase();
  const phone = `+91${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const now = new Date().toISOString();
  const db = getDb();
  if (!tenantId) {
    db.prepare(
      `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
       VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', ?, ?, 500, 0, 1, '', ?, ?)`
    ).run(tenant, `Clinical ${label} ${suffix}`, phone, now, now, now);
  }
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(userId, tenant, email, hashPassword("Lumera@2026"), `Staff ${label}`, role, phone, `Clinic ${label}`, now, now);
  return { tenantId: tenant, email, userId };
}

describe("clinical Gemini route auth", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  let doctor: { tenantId: string; email: string };
  let clinicAdmin: { email: string };
  let otherTenant: { tenantId: string };
  const previousKey = process.env.GEMINI_API_KEY;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret";
    delete process.env.GEMINI_API_KEY;
    resetClinicalGeminiRateLimits();
    setGeminiCopilotGeneratorForTests(undefined);
    setGeminiSafetyCheckGeneratorForTests(undefined);
    try {
      getDb();
    } catch {
      initDatabase();
    }
    doctor = seedUser("doctor", "doctor");
    clinicAdmin = seedUser("admin", "CLINIC_ADMIN", doctor.tenantId);
    otherTenant = seedUser("other", "doctor");
    const server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
      mountGeminiClinicalRoutes(app);
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    resetClinicalGeminiRateLimits();
    setGeminiCopilotGeneratorForTests(undefined);
    setGeminiSafetyCheckGeneratorForTests(undefined);
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

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  it("keeps the global /api/gemini session check in front of the clinical routes", () => {
    const serverSrc = fs.readFileSync(path.join(root, "server.ts"), "utf8");
    const authAt = serverSrc.indexOf('app.use("/api/gemini", requireAuth)');
    const mountAt = serverSrc.indexOf("mountGeminiClinicalRoutes(app)");
    assert.ok(authAt >= 0, "server.ts does not mount requireAuth on /api/gemini");
    assert.ok(mountAt > authAt, "clinical routes are mounted before the /api/gemini session check");
  });

  it("returns 401 for an anonymous post on each route", async () => {
    for (const route of ROUTES) {
      const res = await jsonRequest(port, "POST", route, {
        query: "paracetamol dose",
        patientContext: { name: PATIENT_MARKER },
      });
      assert.equal(res.status, 401, route);
      assert.match(String(res.json.error || ""), /authentication required/i);
      assert.equal(JSON.stringify(res.json).includes(PATIENT_MARKER), false);
    }
  });

  it("returns 403 for patient, reception, and super_admin", async () => {
    for (const role of ["patient", "receptionist", "super_admin"]) {
      const staff = seedUser(role, role);
      const token = await login(staff.email);
      for (const route of ROUTES) {
        const res = await jsonRequest(
          port,
          "POST",
          route,
          { query: "paracetamol dose", patientContext: { name: PATIENT_MARKER } },
          auth(token)
        );
        assert.equal(res.status, 403, `${role} ${route}`);
        assert.equal(res.json.code, "ROLE_DENIED");
        assert.equal(JSON.stringify(res.json).includes(PATIENT_MARKER), false);
      }
    }
  });

  it("allows a prescriber and a clinic admin, and rejects a forged tenant id", async () => {
    const doctorToken = await login(doctor.email);
    const adminToken = await login(clinicAdmin.email);
    for (const route of ROUTES) {
      const allowed = await jsonRequest(
        port,
        "POST",
        route,
        { query: "paracetamol dose", medicines: [] },
        auth(doctorToken)
      );
      assert.equal(allowed.status, 200, `${route} ${JSON.stringify(allowed.json)}`);
      const adminAllowed = await jsonRequest(
        port,
        "POST",
        route,
        { query: "paracetamol dose", medicines: [] },
        auth(adminToken)
      );
      assert.equal(adminAllowed.status, 200, `admin ${route}`);
      const forged = await jsonRequest(
        port,
        "POST",
        route,
        { query: "paracetamol dose", medicines: [], tenantId: otherTenant.tenantId, patientContext: { name: PATIENT_MARKER } },
        auth(doctorToken)
      );
      assert.equal(forged.status, 403, `forged ${route}`);
      assert.equal(forged.json.code, undefined);
      assert.equal(JSON.stringify(forged.json).includes(PATIENT_MARKER), false);
    }
  });

  it("returns a fixed code and does not echo the thrown message or patient context", async () => {
    resetClinicalGeminiRateLimits();
    const token = await login(doctor.email);
    setGeminiCopilotGeneratorForTests(async () => {
      throw new Error(LEAK);
    });
    setGeminiSafetyCheckGeneratorForTests(async () => {
      throw new Error(LEAK);
    });
    for (const route of ROUTES) {
      const res = await jsonRequest(
        port,
        "POST",
        route,
        { query: "paracetamol dose", patientContext: { name: PATIENT_MARKER }, history: { text: PATIENT_MARKER } },
        auth(token)
      );
      assert.equal(res.status, 500, route);
      const expected = route === "/api/gemini/safety-check" ? "safety_check_failed" : "copilot_failed";
      assert.equal(res.json.code, expected);
      const body = JSON.stringify(res.json);
      assert.equal(body.includes(LEAK), false);
      assert.equal(body.includes(PATIENT_MARKER), false);
      assert.equal(body.includes("patientContext"), false);
      assert.equal(res.json.error, undefined);
    }

    const clinical = fs.readFileSync(path.join(root, "server/gemini-clinical.ts"), "utf8");
    assert.match(clinical, /function prescriberOnly[\s\S]*denyUnlessPrescriber/);
    const mounted = clinical.slice(clinical.indexOf('"/api/gemini/copilot"'), clinical.indexOf('"/api/gemini/transcribe"'));
    for (const route of ROUTES) assert.match(mounted, new RegExp(route.replaceAll("/", "\\/")));
    assert.equal((mounted.match(/requireAuth/g) || []).length, 4);
    assert.equal((mounted.match(/prescriberOnly/g) || []).length, 4);
    assert.equal((mounted.match(/clinicalGeminiRateLimit/g) || []).length, 4);
    assert.equal((mounted.match(/rejectUntrustedTenantClaim/g) || []).length, 4);
    const handlers = clinical.slice(clinical.indexOf("const handleGeminiCopilot"), clinical.indexOf('"/api/gemini/transcribe"'));
    assert.match(handlers, /copilot_failed/);
    assert.match(handlers, /safety_check_failed/);
    assert.doesNotMatch(handlers, /error\.message/);
    assert.doesNotMatch(handlers, /err\?\.message/);
    assert.doesNotMatch(handlers, /err\.message/);
    const logs = handlers.match(/console\.(?:error|log|info|warn|debug)\(([^)]*)\)/g) || [];
    assert.ok(logs.length >= 2);
    for (const log of logs) {
      assert.doesNotMatch(log, /patientContext|query|prompt|contents|message/);
    }
    setGeminiCopilotGeneratorForTests(undefined);
    setGeminiSafetyCheckGeneratorForTests(undefined);
  });

  it("returns 429 per user and per tenant", async () => {
    resetClinicalGeminiRateLimits();
    setClinicalGeminiRateLimitForTests({ userMax: 2, tenantMax: 20 });
    const token = await login(doctor.email);
    const headers = auth(token);
    const body = { query: "paracetamol dose", medicines: [] };
    const first = await jsonRequest(port, "POST", "/api/gemini/copilot", body, headers);
    const second = await jsonRequest(port, "POST", "/api/gemini/pulse-assistant", body, headers);
    const third = await jsonRequest(port, "POST", "/api/gemini/hexa-assistant", body, headers);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 429);
    assert.ok(Number(third.headers.get("retry-after")) >= 1);
    assert.equal(JSON.stringify(third.json).includes(LEAK), false);
    assert.match(String(third.json.error || ""), /too many clinical assistant requests/i);

    const colleague = seedUser("colleague", "doctor", doctor.tenantId);
    const colleagueToken = await login(colleague.email);
    setClinicalGeminiRateLimitForTests({ userMax: 5, tenantMax: 1 });
    const tenantFirst = await jsonRequest(port, "POST", "/api/gemini/safety-check", body, headers);
    const tenantSecond = await jsonRequest(
      port,
      "POST",
      "/api/gemini/safety-check",
      body,
      auth(colleagueToken)
    );
    assert.equal(tenantFirst.status, 200);
    assert.equal(tenantSecond.status, 429);
    assert.equal(JSON.stringify(tenantSecond.json).includes("Error"), false);
    resetClinicalGeminiRateLimits();
  });
});

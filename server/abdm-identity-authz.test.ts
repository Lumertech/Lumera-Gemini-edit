import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { createAbdmRouter } from "./abdm.ts";
import { readAadhaarOtpSessionForTests, setAadhaarOtpTestFault } from "./abdm-identity-routes.ts";
import { signAbdmCallback } from "./abdm-hmac.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { resetSendOtpRateLimits } from "./otp-rate-limit.ts";

/**
 * Production mounts the same ABDM router at /api/abdm, /api/v3, and /v3.
 * Identity guards live on the handlers, so every alias on every mount is gated.
 * Handlers stay local stubs: this file refuses any non-loopback fetch.
 */
const BRIDGE_PATHS = ["/v3/bridgesession", "/bridgesession", "/v3/sessions", "/sessions"] as const;
const GENERATE_PATHS = [
  "/v3/registration/aadhaar/generateOtp",
  "/registration/aadhaar/generateOtp",
  "/aadhaar/generate-otp",
] as const;
const VERIFY_PATHS = [
  "/v3/registration/aadhaar/verifyOTP",
  "/registration/aadhaar/verifyOTP",
  "/aadhaar/verify-otp",
] as const;
const MOUNTS = ["/api/abdm", "/api/v3", "/v3"] as const;

const AADHAAR = "999988887777";

type Call = [string, string, Record<string, unknown>];

function gatedCalls(): Call[] {
  const calls: Call[] = [];
  for (const mount of MOUNTS) {
    for (const path of BRIDGE_PATHS) calls.push(["POST", `${mount}${path}`, {}]);
    for (const path of GENERATE_PATHS) calls.push(["POST", `${mount}${path}`, { aadhaar: AADHAAR }]);
    for (const path of VERIFY_PATHS) calls.push(["POST", `${mount}${path}`, { txnId: "txn-missing", otp: "123456" }]);
  }
  return calls;
}

async function startAbdmServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(attachUser);
  app.use("/api/v3", createAbdmRouter());
  app.use("/v3", createAbdmRouter());
  app.use("/api", createApiRouter());
  const server: Server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("server did not bind a port");
  return {
    port: addr.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function jsonRequest(
  port: number,
  method: string,
  urlPath: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const createdTenantIds: string[] = [];

function purgeTenant(tenantId: string) {
  const db = getDb();
  const run = (sql: string, ...params: string[]) => {
    try {
      db.prepare(sql).run(...params);
    } catch {
      /* table missing only before migrate */
    }
  };
  run("DELETE FROM audit_logs WHERE details LIKE ?", `%tenant: ${tenantId}%`);
  run("DELETE FROM patients WHERE tenant_id = ?", tenantId);
  run("DELETE FROM users WHERE tenant_id = ?", tenantId);
  run("DELETE FROM tenants WHERE id = ?", tenantId);
}

function purgeIdentityFixtures() {
  const rows = getDb()
    .prepare("SELECT id FROM tenants WHERE id LIKE 'tidn%'")
    .all() as Array<{ id: string }>;
  for (const row of rows) purgeTenant(row.id);
}

function seedClinic(label: string, role: "CLINIC_ADMIN" | "doctor" | "receptionist") {
  const suffix = Math.random().toString(36).slice(2, 10);
  const tenantId = `tidn${label.slice(0, 3)}${suffix}`;
  const userId = `uidn${label.slice(0, 3)}${suffix}`;
  const email = `${label.slice(0, 8)}.${suffix}@identity-authz-test.example`.toLowerCase();
  createdTenantIds.push(tenantId);
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at, waba_id, phone_number_id, meta_onboarding_status)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?, '', '', 'disconnected')`
  ).run(tenantId, `Identity AuthZ Clinic ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', '+91 90000 00000', ?, 1, 'polyclinic', 'General Medicine', ?, ?)`
  ).run(
    userId,
    tenantId,
    email,
    hashPassword("Lumera@2026"),
    `${role} ${label}`,
    role,
    `Identity AuthZ Clinic ${label}`,
    now,
    now
  );
  return { tenantId, userId, email, role };
}

describe("ABDM identity AuthZ", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  const realFetch = globalThis.fetch;
  const previousAbdmMode = process.env.ABDM_MODE;
  const previousHashKey = process.env.AADHAAR_HASH_KEY;

  before(async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!/^http:\/\/127\.0\.0\.1:\d+/.test(url)) {
        throw new Error(`stub refused outbound call: ${url}`);
      }
      return realFetch(input, init);
    }) as typeof fetch;

    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-identity-authz";
    process.env.ABDM_MODE = "stub";
    process.env.AADHAAR_HASH_KEY = "test-aadhaar-hash-key";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    purgeIdentityFixtures();
    const server = await startAbdmServer();
    port = server.port;
    close = server.close;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    if (previousAbdmMode === undefined) delete process.env.ABDM_MODE;
    else process.env.ABDM_MODE = previousAbdmMode;
    if (previousHashKey === undefined) delete process.env.AADHAAR_HASH_KEY;
    else process.env.AADHAAR_HASH_KEY = previousHashKey;
    setAadhaarOtpTestFault(null);
    try {
      for (const tenantId of createdTenantIds) purgeTenant(tenantId);
      purgeIdentityFixtures();
    } catch {
      /* init never ran */
    }
    await close?.();
  });

  async function login(email: string): Promise<string> {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || `${email} login failed`));
    const token = String(res.json.token || "");
    assert.ok(token);
    return token;
  }

  it("anonymous callers are 401 on every identity alias and mount", async () => {
    for (const [method, path, body] of gatedCalls()) {
      const res = await jsonRequest(port, method, path, body);
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.equal(res.json.error, "Authentication required");
    }
    const invalid = await jsonRequest(port, "POST", "/api/abdm/aadhaar/generate-otp", { aadhaar: "12" });
    assert.equal(invalid.status, 401);
    assert.equal(invalid.json.error, "Authentication required");
  });

  it("patients are 403 on every identity alias and mount", async () => {
    const token = await login("patient@lumera.me");
    for (const [method, path, body] of gatedCalls()) {
      const res = await jsonRequest(port, method, path, body, auth(token));
      assert.equal(res.status, 403, `${method} ${path}`);
      assert.equal(res.json.error, "Insufficient permissions");
    }
    const invalid = await jsonRequest(port, "POST", "/api/abdm/aadhaar/generate-otp", { aadhaar: "12" }, auth(token));
    assert.equal(invalid.status, 403);
    assert.equal(invalid.json.error, "Insufficient permissions");
  });

  it("patient-record staff pass OTP stubs and clinic admin passes bridgesession", async () => {
    resetSendOtpRateLimits();
    const doctor = await login("doctor@lumera.me");
    const reception = await login("reception@lumera.me");
    const clinicAdmin = await login("clinic.admin@lumera.me");
    const superAdmin = await login("admin@lumera.me");

    for (const [label, token] of [
      ["doctor", doctor],
      ["reception", reception],
    ] as const) {
      const bridge = await jsonRequest(port, "POST", "/api/abdm/bridgesession", {}, auth(token));
      assert.equal(bridge.status, 403, `${label} bridgesession`);
      assert.equal(bridge.json.error, "Insufficient permissions");
    }

    for (const [label, token] of [
      ["clinic admin", clinicAdmin],
      ["super admin", superAdmin],
    ] as const) {
      const bridge = await jsonRequest(port, "POST", "/api/abdm/bridgesession", {}, auth(token));
      assert.equal(bridge.status, 200, `${label} bridgesession: ${String(bridge.json.error || "")}`);
      assert.equal(typeof bridge.json.accessToken, "string");
      assert.ok(String(bridge.json.accessToken).length > 0);
      assert.equal(bridge.json.tokenType, "Bearer");
    }

    const staff = [
      ["doctor", doctor, "432156789012"],
      ["reception", reception, "432156789013"],
      ["clinic admin", clinicAdmin, "432156789014"],
    ] as const;
    for (const [label, token, aadhaar] of staff) {
      const otp = await jsonRequest(
        port,
        "POST",
        "/api/abdm/v3/registration/aadhaar/generateOtp",
        { aadhaar },
        auth(token)
      );
      assert.equal(otp.status, 200, `${label} generateOtp: ${String(otp.json.error || "")}`);
      const txnId = String(otp.json.txnId || "");
      assert.ok(txnId, label);

      const verify = await jsonRequest(
        port,
        "POST",
        "/api/abdm/aadhaar/verify-otp",
        { txnId, otp: "123456" },
        auth(token)
      );
      assert.equal(verify.status, 200, `${label} verifyOTP: ${String(verify.json.error || "")}`);
      assert.equal(verify.json.success, true);
      assert.equal(verify.json.kycStatus, "LINKED_SANDBOX");
    }
  });

  it("identity stubs stay on the session clinic", async () => {
    resetSendOtpRateLimits();
    const clinicA = seedClinic("admA", "CLINIC_ADMIN");
    const clinicB = seedClinic("admB", "CLINIC_ADMIN");
    const tokenA = await login(clinicA.email);
    const tokenB = await login(clinicB.email);

    const foreignBody = await jsonRequest(
      port,
      "POST",
      "/api/abdm/bridgesession",
      { tenantId: clinicB.tenantId },
      auth(tokenA)
    );
    assert.equal(foreignBody.status, 403);
    assert.equal(foreignBody.json.error, "Forbidden");

    const foreignHeader = await jsonRequest(port, "POST", "/api/v3/sessions", {}, {
      ...auth(tokenA),
      "x-tenant-id": clinicB.tenantId,
    });
    assert.equal(foreignHeader.status, 403);
    assert.equal(foreignHeader.json.error, "Forbidden");

    const own = await jsonRequest(
      port,
      "POST",
      "/v3/bridgesession",
      { tenantId: clinicA.tenantId },
      auth(tokenA)
    );
    assert.equal(own.status, 200, String(own.json.error || ""));
    const audited = getDb()
      .prepare(
        `SELECT details FROM audit_logs WHERE action = ? AND details LIKE ? ORDER BY timestamp DESC LIMIT 1`
      )
      .get("ABDM_OAUTH_TOKEN_EXCHANGED", `%tenant: ${clinicA.tenantId}%`) as { details: string } | undefined;
    assert.ok(audited?.details);
    assert.equal(audited.details.includes(clinicB.tenantId), false);

    const generated = await jsonRequest(
      port,
      "POST",
      "/api/abdm/registration/aadhaar/generateOtp",
      { aadhaar: AADHAAR },
      auth(tokenA)
    );
    assert.equal(generated.status, 200, String(generated.json.error || ""));
    const txnId = String(generated.json.txnId || "");
    assert.ok(txnId);

    const stolen = await jsonRequest(
      port,
      "POST",
      "/api/abdm/registration/aadhaar/verifyOTP",
      { txnId, otp: "123456" },
      auth(tokenB)
    );
    assert.equal(stolen.status, 400);
    assert.match(String(stolen.json.error || ""), /invalid/i);

    const owner = await jsonRequest(
      port,
      "POST",
      "/api/v3/aadhaar/verify-otp",
      { txnId, otp: "123456" },
      auth(tokenA)
    );
    assert.equal(owner.status, 200, String(owner.json.error || ""));
    assert.equal(owner.json.success, true);
  });

  it("audit rows store a masked Aadhaar, never the full number", async () => {
    resetSendOtpRateLimits();
    const clinic = seedClinic("audA", "doctor");
    const token = await login(clinic.email);
    const aadhaar = "908172635451";
    const generated = await jsonRequest(
      port,
      "POST",
      "/api/abdm/registration/aadhaar/generateOtp",
      { aadhaar },
      auth(token)
    );
    assert.equal(generated.status, 200, String(generated.json.error || ""));
    const txnId = String(generated.json.txnId || "");
    const verified = await jsonRequest(
      port,
      "POST",
      "/api/abdm/registration/aadhaar/verifyOTP",
      { txnId, otp: "123456" },
      auth(token)
    );
    assert.equal(verified.status, 200, String(verified.json.error || ""));

    const rows = getDb()
      .prepare(
        `SELECT action, details, user_name FROM audit_logs
         WHERE user_id = ? AND action IN ('ABDM_AADHAAR_OTP_GENERATED', 'ABHA OTP matched (NHA sandbox)')
         ORDER BY timestamp DESC LIMIT 2`
      )
      .all(clinic.userId) as Array<{ action: string; details: string; user_name: string }>;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      const blob = `${row.action}\n${row.user_name}\n${row.details}`;
      assert.equal(blob.includes(aadhaar), false, blob);
      assert.equal(blob.includes(aadhaar.slice(0, 8)), false, blob);
      assert.match(row.details, /XXXX-XXXX-5451/);
    }
  });

  it("Aadhaar OTP rate limit returns 429 per hash, user, and IP", async () => {
    resetSendOtpRateLimits();
    const userA = seedClinic("limA", "doctor");
    const userB = seedClinic("limB", "receptionist");
    const userC = seedClinic("limC", "CLINIC_ADMIN");
    const userD = seedClinic("limD", "doctor");
    const userE = seedClinic("limE", "receptionist");
    const userF = seedClinic("limF", "doctor");
    const tokenA = await login(userA.email);
    const tokenB = await login(userB.email);
    const tokenC = await login(userC.email);
    const tokenD = await login(userD.email);
    const tokenE = await login(userE.email);
    const tokenF = await login(userF.email);
    const sharedAadhaar = "667788990011";

    const first = await jsonRequest(
      port,
      "POST",
      "/api/abdm/aadhaar/generate-otp",
      { aadhaar: sharedAadhaar },
      { ...auth(tokenA), "x-forwarded-for": "203.0.113.10" }
    );
    assert.equal(first.status, 200, String(first.json.error || ""));

    const sameAadhaar = await jsonRequest(
      port,
      "POST",
      "/api/abdm/registration/aadhaar/generateOtp",
      { aadhaar: sharedAadhaar },
      { ...auth(tokenB), "x-forwarded-for": "203.0.113.11" }
    );
    assert.equal(sameAadhaar.status, 429, String(sameAadhaar.json.error || ""));

    const sameUser = await jsonRequest(
      port,
      "POST",
      "/api/abdm/v3/registration/aadhaar/generateOtp",
      { aadhaar: "667788990022" },
      { ...auth(tokenA), "x-forwarded-for": "203.0.113.12" }
    );
    assert.equal(sameUser.status, 429, String(sameUser.json.error || ""));

    const sharedIp = "198.51.100.20";
    const ipCalls = [
      [tokenC, "667788990033"],
      [tokenD, "667788990044"],
      [tokenE, "667788990055"],
      [tokenF, "667788990066"],
    ] as const;
    for (let i = 0; i < ipCalls.length; i += 1) {
      const [token, aadhaar] = ipCalls[i];
      const res = await jsonRequest(
        port,
        "POST",
        "/api/abdm/aadhaar/generate-otp",
        { aadhaar },
        { ...auth(token), "x-forwarded-for": sharedIp }
      );
      assert.equal(res.status, i < 3 ? 200 : 429, `${i}: ${String(res.json.error || "")}`);
    }
  });

  function assertNoAadhaarDigitRun(aadhaar: string, value: string) {
    const digits = value.replace(/\D/g, "");
    for (let i = 0; i <= aadhaar.length - 6; i += 1) {
      const window = aadhaar.slice(i, i + 6);
      assert.equal(value.includes(window), false, window);
      assert.equal(digits.includes(window), false, `${window} in ${digits}`);
    }
  }

  it("verify ABHA and the saved patient contain no Aadhaar digit run", async () => {
    resetSendOtpRateLimits();
    const clinic = seedClinic("dpdp", "doctor");
    const token = await login(clinic.email);
    const headers = auth(token);
    const aadhaar = "102938475610";
    const generated = await jsonRequest(
      port,
      "POST",
      "/api/abdm/registration/aadhaar/generateOtp",
      { aadhaar },
      headers
    );
    assert.equal(generated.status, 200, String(generated.json.error || ""));
    const verified = await jsonRequest(
      port,
      "POST",
      "/api/abdm/registration/aadhaar/verifyOTP",
      { txnId: generated.json.txnId, otp: "123456" },
      headers
    );
    assert.equal(verified.status, 200, String(verified.json.error || ""));
    const profile = verified.json.profile as { name: string; mobile: string };
    const abhaNumber = String(verified.json.abhaNumber || "");
    assertNoAadhaarDigitRun(aadhaar, abhaNumber);
    assertNoAadhaarDigitRun(aadhaar, profile.mobile);

    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: profile.name, phone: profile.mobile, age: 34, gender: "Male" },
      headers
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);
    const linked = await jsonRequest(
      port,
      "POST",
      "/api/patients/link-abha",
      {
        patientId,
        abhaNumber,
        abhaAddress: verified.json.abhaAddress,
        kycStatus: "LINKED_SANDBOX",
        source: "aadhaar_otp",
        abdmMode: "stub",
      },
      headers
    );
    assert.equal(linked.status, 200, String(linked.json.error || ""));
    const row = getDb()
      .prepare("SELECT abha_number, phone FROM patients WHERE id = ? AND tenant_id = ?")
      .get(patientId, clinic.tenantId) as { abha_number: string; phone: string };
    assertNoAadhaarDigitRun(aadhaar, String(row.abha_number || ""));
    assertNoAadhaarDigitRun(aadhaar, String(row.phone || ""));
  });

  it("otp session stores only the HMAC and last 4 of the Aadhaar", async () => {
    resetSendOtpRateLimits();
    const clinic = seedClinic("sess", "doctor");
    const token = await login(clinic.email);
    const aadhaar = "808080808080";
    const generated = await jsonRequest(
      port,
      "POST",
      "/api/abdm/registration/aadhaar/generateOtp",
      { aadhaar },
      auth(token)
    );
    assert.equal(generated.status, 200, String(generated.json.error || ""));
    const txnId = String(generated.json.txnId || "");
    const session = readAadhaarOtpSessionForTests(txnId);
    assert.ok(session);
    assert.equal(session.last4, aadhaar.slice(-4));
    assert.equal(session.last4.length, 4);
    const expectedHmac = crypto.createHmac("sha256", "test-aadhaar-hash-key").update(aadhaar).digest("hex");
    assert.equal(session.aadhaarHmac, expectedHmac);
    assert.equal(Object.hasOwn(session, "aadhaar"), false);
    assert.equal(Object.hasOwn(session, "aadhaarNumber"), false);
    const stored = JSON.stringify(session);
    assert.equal(stored.includes(aadhaar), false);
    const { aadhaarHmac: _hmac, ...withoutHmac } = session;
    assertNoAadhaarDigitRun(aadhaar, JSON.stringify(withoutHmac));
  });

  it("generate and verify hide upstream errors that contain an Aadhaar", async () => {
    resetSendOtpRateLimits();
    const clinic = seedClinic("fault", "doctor");
    const token = await login(clinic.email);
    const headers = auth(token);
    const sentinel = "102938475610";
    try {
      setAadhaarOtpTestFault({ phase: "generate", message: `upstream generate failed for ${sentinel}` });
      const generated = await jsonRequest(
        port,
        "POST",
        "/api/abdm/aadhaar/generate-otp",
        { aadhaar: "667788990077" },
        headers
      );
      assert.equal(generated.status, 500);
      assert.equal(generated.json.error, "Failed to generate Aadhaar OTP");
      assert.equal(JSON.stringify(generated.json).includes(sentinel), false);

      setAadhaarOtpTestFault({ phase: "verify", message: `upstream verify failed for ${sentinel}` });
      const verified = await jsonRequest(
        port,
        "POST",
        "/api/abdm/aadhaar/verify-otp",
        { txnId: "txn-fault", otp: "123456" },
        headers
      );
      assert.equal(verified.status, 500);
      assert.equal(verified.json.error, "Failed to verify Aadhaar OTP");
      assert.equal(JSON.stringify(verified.json).includes(sentinel), false);
    } finally {
      setAadhaarOtpTestFault(null);
    }
  });

  it("super_admin cannot run Aadhaar OTP", async () => {
    const token = await login("admin@lumera.me");
    const headers = auth(token);
    const generated = await jsonRequest(
      port,
      "POST",
      "/api/abdm/aadhaar/generate-otp",
      { aadhaar: "102938475610" },
      headers
    );
    assert.equal(generated.status, 403);
    assert.equal(generated.json.error, "Insufficient permissions");
    const verified = await jsonRequest(
      port,
      "POST",
      "/api/abdm/aadhaar/verify-otp",
      { txnId: "txn-super-admin", otp: "123456" },
      headers
    );
    assert.equal(verified.status, 403);
    assert.equal(verified.json.error, "Insufficient permissions");
  });

  it("AADHAAR_HASH_KEY fails closed outside stub and in production", async () => {
    const previousNode = process.env.NODE_ENV;
    const previousMode = process.env.ABDM_MODE;
    const previousKey = process.env.AADHAAR_HASH_KEY;
    const clinic = seedClinic("hmac", "doctor");
    const token = await login(clinic.email);
    try {
      delete process.env.AADHAAR_HASH_KEY;
      process.env.NODE_ENV = "production";
      process.env.ABDM_MODE = "stub";
      const production = await jsonRequest(
        port,
        "POST",
        "/api/abdm/aadhaar/generate-otp",
        { aadhaar: "102938475611" },
        auth(token)
      );
      assert.equal(production.status, 503);
      assert.equal(production.json.error, "Aadhaar OTP is unavailable");

      process.env.NODE_ENV = "test";
      process.env.ABDM_MODE = "sandbox";
      const sandbox = await jsonRequest(
        port,
        "POST",
        "/api/abdm/registration/aadhaar/verifyOTP",
        { txnId: "txn-no-key", otp: "123456" },
        auth(token)
      );
      assert.equal(sandbox.status, 503);
      assert.equal(sandbox.json.error, "Aadhaar OTP is unavailable");
    } finally {
      if (previousNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNode;
      if (previousMode === undefined) delete process.env.ABDM_MODE;
      else process.env.ABDM_MODE = previousMode;
      if (previousKey === undefined) delete process.env.AADHAAR_HASH_KEY;
      else process.env.AADHAAR_HASH_KEY = previousKey;
    }
  });

  it("unknown txn rate limits do not share a bucket", async () => {
    resetSendOtpRateLimits();
    const callerA = seedClinic("unkA", "doctor");
    const callerB = seedClinic("unkB", "receptionist");
    const tokenA = await login(callerA.email);
    const tokenB = await login(callerB.email);
    for (let i = 0; i < 4; i += 1) {
      const res = await jsonRequest(
        port,
        "POST",
        "/api/abdm/aadhaar/verify-otp",
        { txnId: "txn-unknown-a", otp: "123456" },
        { ...auth(tokenA), "x-forwarded-for": "203.0.113.40" }
      );
      assert.equal(res.status, i < 3 ? 400 : 429, `${i}: ${String(res.json.error || "")}`);
    }
    const other = await jsonRequest(
      port,
      "POST",
      "/api/abdm/aadhaar/verify-otp",
      { txnId: "txn-unknown-b", otp: "123456" },
      { ...auth(tokenB), "x-forwarded-for": "203.0.113.41" }
    );
    assert.equal(other.status, 400, String(other.json.error || ""));
  });

  it("clinic admin bridgesession uses the session populated before the guard", async () => {
    const token = await login("clinic.admin@lumera.me");
    const res = await jsonRequest(port, "POST", "/api/abdm/bridgesession", {}, auth(token));
    assert.notEqual(res.status, 401);
    assert.equal(res.status, 200, String(res.json.error || ""));
    assert.equal(typeof res.json.accessToken, "string");
    assert.ok(String(res.json.accessToken).length > 0);
  });

  it("a matched ABDM HMAC can open bridgesession without a staff session", async () => {
    const previous = process.env.ABDM_CALLBACK_SECRET;
    const secret = "callback-secret-for-identity-tests";
    process.env.ABDM_CALLBACK_SECRET = secret;
    try {
      const body = {};
      const signature = signAbdmCallback(secret, JSON.stringify(body));
      const res = await jsonRequest(port, "POST", "/api/abdm/bridgesession", body, {
        "x-abdm-signature": signature,
      });
      assert.equal(res.status, 200, String(res.json.error || ""));
      assert.equal(typeof res.json.accessToken, "string");
    } finally {
      if (previous === undefined) delete process.env.ABDM_CALLBACK_SECRET;
      else process.env.ABDM_CALLBACK_SECRET = previous;
    }
  });
});

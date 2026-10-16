import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { createAbdmRouter } from "./abdm.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";

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
  });

  it("patients are 403 on every identity alias and mount", async () => {
    const token = await login("patient@lumera.me");
    for (const [method, path, body] of gatedCalls()) {
      const res = await jsonRequest(port, method, path, body, auth(token));
      assert.equal(res.status, 403, `${method} ${path}`);
      assert.equal(res.json.error, "Insufficient permissions");
    }
  });

  it("doctor, reception, and clinic admin pass the local identity stubs", async () => {
    const doctor = await login("doctor@lumera.me");
    const reception = await login("reception@lumera.me");
    const clinicAdmin = await login("clinic.admin@lumera.me");

    for (const [label, token] of [
      ["doctor", doctor],
      ["reception", reception],
      ["clinic admin", clinicAdmin],
    ] as const) {
      const bridge = await jsonRequest(port, "POST", "/api/abdm/bridgesession", {}, auth(token));
      assert.equal(bridge.status, 200, `${label} bridgesession: ${String(bridge.json.error || "")}`);
      assert.equal(typeof bridge.json.accessToken, "string");
      assert.ok(String(bridge.json.accessToken).length > 0);
      assert.equal(bridge.json.tokenType, "Bearer");

      const otp = await jsonRequest(
        port,
        "POST",
        "/api/abdm/v3/registration/aadhaar/generateOtp",
        { aadhaar: AADHAAR },
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
    const clinicA = seedClinic("docA", "doctor");
    const clinicB = seedClinic("recB", "receptionist");
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
});

import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { attachUser, signJwtToken } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { createAbdmRouter } from "./abdm.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";

/**
 * Production mounts the same ABDM router at /api/abdm, /api/v3, and /v3.
 * DHIS guards live on the handlers, so every mount must reject anonymous callers.
 */
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

const anonCalls: Array<[string, string, Record<string, unknown> | undefined]> = [
  ["GET", "/api/abdm/dhis/overview", undefined],
  ["POST", "/api/abdm/dhis/simulate-transaction", { type: "OP_CONSULT" }],
  ["GET", "/api/v3/dhis/overview", undefined],
  ["POST", "/api/v3/dhis/simulate-transaction", { type: "OP_CONSULT" }],
  ["GET", "/v3/dhis/overview", undefined],
  ["POST", "/v3/dhis/simulate-transaction", { type: "OP_CONSULT" }],
];

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
  run("DELETE FROM dhis_transactions WHERE tenant_id = ?", tenantId);
  run("DELETE FROM patients WHERE tenant_id = ?", tenantId);
  run("DELETE FROM users WHERE tenant_id = ?", tenantId);
  run("DELETE FROM tenants WHERE id = ?", tenantId);
}

function purgeDhisFixtures() {
  const rows = getDb()
    .prepare("SELECT id FROM tenants WHERE id LIKE 'tdhs%'")
    .all() as Array<{ id: string }>;
  for (const row of rows) purgeTenant(row.id);
}

function seedClinic(label: string, role: "CLINIC_ADMIN" | "doctor" | "patient") {
  const suffix = Math.random().toString(36).slice(2, 10);
  const tenantId = `tdhs${label.slice(0, 3)}${suffix}`;
  const userId = `udhs${label.slice(0, 3)}${suffix}`;
  const email = `${label.slice(0, 8)}.${suffix}@dhis-authz-test.example`.toLowerCase();
  createdTenantIds.push(tenantId);
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at, waba_id, phone_number_id, meta_onboarding_status)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?, '', '', 'disconnected')`
  ).run(tenantId, `DHIS AuthZ Clinic ${label}`, now, now, now);
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
    `DHIS AuthZ Clinic ${label}`,
    now,
    now
  );
  return { tenantId, userId, email, role, name: `${role} ${label}` };
}

function currentMonth() {
  return `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
}

function qualifiedCount(tenantId: string) {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as count FROM dhis_transactions WHERE tenant_id = ? AND month_year = ? AND status = 'QUALIFIED'`
    )
    .get(tenantId, currentMonth()) as { count: number };
  return Number(row?.count || 0);
}

function insertQualified(tenantId: string, abhaAddress: string) {
  const now = new Date().toISOString();
  const id = `dhis-fix-${Math.random().toString(36).slice(2, 10)}`;
  getDb()
    .prepare(
      `INSERT INTO dhis_transactions (
         id, tenant_id, transaction_type, patient_id, abha_address, abha_number,
         kyc_status, record_id, fhir_bundle_id, incentive_amount, clinic_share, lumera_share,
         status, month_year, created_at, updated_at
       ) VALUES (?, ?, 'OP_CONSULT', '', ?, '91-0000-0000-0002', 'LINKED_SANDBOX', '', '', 20, 14, 6, 'QUALIFIED', ?, ?, ?)`
    )
    .run(id, tenantId, abhaAddress, currentMonth(), now, now);
  return id;
}

describe("ABDM DHIS AuthZ", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-dhis-authz";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    purgeDhisFixtures();
    const server = await startAbdmServer();
    port = server.port;
    close = server.close;
  });

  after(async () => {
    try {
      for (const tenantId of createdTenantIds) purgeTenant(tenantId);
      purgeDhisFixtures();
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

  it("anonymous callers are 401 on every DHIS mount", async () => {
    for (const [method, path, body] of anonCalls) {
      const res = await jsonRequest(port, method, path, body);
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.equal(res.json.error, "Authentication required");
    }
  });

  it("patients are 403 on overview and simulate", async () => {
    const token = await login("patient@lumera.me");
    const overview = await jsonRequest(port, "GET", "/api/abdm/dhis/overview", undefined, auth(token));
    assert.equal(overview.status, 403);
    assert.equal(overview.json.error, "Insufficient permissions");

    const simulate = await jsonRequest(
      port,
      "POST",
      "/api/abdm/dhis/simulate-transaction",
      { type: "PRESCRIPTION" },
      auth(token)
    );
    assert.equal(simulate.status, 403);
    assert.equal(simulate.json.error, "Insufficient permissions");
  });

  it("clinic staff can read their clinic meter and cannot simulate", async () => {
    const token = await login("doctor@lumera.me");
    const overview = await jsonRequest(port, "GET", "/api/abdm/dhis/overview", undefined, auth(token));
    assert.equal(overview.status, 200);
    assert.equal(typeof overview.json.transactionsCount, "number");

    const simulate = await jsonRequest(
      port,
      "POST",
      "/api/abdm/dhis/simulate-transaction",
      { type: "OP_CONSULT" },
      auth(token)
    );
    assert.equal(simulate.status, 403);
    assert.equal(simulate.json.error, "Insufficient permissions");
  });

  it("overview and simulate stay on the session clinic", async () => {
    const clinicA = seedClinic("adminA", "CLINIC_ADMIN");
    const clinicB = seedClinic("adminB", "CLINIC_ADMIN");
    const marker = `b-only-${clinicB.tenantId}@dhis-authz.test`;
    insertQualified(clinicB.tenantId, marker);
    const patientId = `pat-${clinicB.tenantId}`;
    getDb()
      .prepare(
        `INSERT INTO patients (id, tenant_id, uhid, name, phone, kyc_status, created_at)
         VALUES (?, ?, ?, 'DHIS Other Clinic', ?, 'LINKED_SANDBOX', ?)`
      )
      .run(
        patientId,
        clinicB.tenantId,
        `UH-${patientId}`,
        `+91${Math.floor(6000000000 + Math.random() * 99999999)}`,
        new Date().toISOString()
      );

    const token = await login(clinicA.email);
    const overview = await jsonRequest(port, "GET", "/api/abdm/dhis/overview", undefined, auth(token));
    assert.equal(overview.status, 200);
    assert.equal(overview.json.transactionsCount, 0);
    assert.equal(overview.json.kycVerifiedPatients, 0);
    assert.equal(JSON.stringify(overview.json).includes(marker), false);

    const foreign = await jsonRequest(
      port,
      "POST",
      "/api/abdm/dhis/simulate-transaction",
      { type: "OP_CONSULT", tenantId: clinicB.tenantId, abhaAddress: "should-not-write@dhis-authz.test" },
      auth(token)
    );
    assert.equal(foreign.status, 403);
    assert.equal(foreign.json.error, "Forbidden");
    assert.equal(qualifiedCount(clinicB.tenantId), 1);
    assert.equal(qualifiedCount(clinicA.tenantId), 0);

    const foreignQuery = await jsonRequest(
      port,
      "GET",
      `/api/abdm/dhis/overview?tenantId=${encodeURIComponent(clinicB.tenantId)}`,
      undefined,
      auth(token)
    );
    assert.equal(foreignQuery.status, 403);

    const own = await jsonRequest(
      port,
      "POST",
      "/api/abdm/dhis/simulate-transaction",
      { type: "PRESCRIPTION", abhaAddress: "session-clinic@dhis-authz.test" },
      auth(token)
    );
    assert.equal(own.status, 200);
    assert.equal(own.json.success, true);
    assert.equal(qualifiedCount(clinicA.tenantId), 1);
    const written = getDb()
      .prepare("SELECT tenant_id, abha_address FROM dhis_transactions WHERE abha_address = ?")
      .get("session-clinic@dhis-authz.test") as { tenant_id: string; abha_address: string };
    assert.equal(written.tenant_id, clinicA.tenantId);
    assert.equal(qualifiedCount(clinicB.tenantId), 1);
  });

  it("super_admin cannot name another clinic on the simulator", async () => {
    const clinicB = seedClinic("admB2", "CLINIC_ADMIN");
    const before = qualifiedCount(clinicB.tenantId);
    const token = await login("admin@lumera.me");
    const res = await jsonRequest(
      port,
      "POST",
      "/api/abdm/dhis/simulate-transaction",
      { type: "OP_CONSULT", tenantId: clinicB.tenantId },
      auth(token)
    );
    assert.equal(res.status, 403);
    assert.equal(res.json.error, "Forbidden");
    assert.equal(qualifiedCount(clinicB.tenantId), before);
  });

  it("simulate is 401 anonymous and 403 for a clinic admin when production simulators are off", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const anon = await jsonRequest(port, "POST", "/api/abdm/dhis/simulate-transaction", { type: "OP_CONSULT" });
      assert.equal(anon.status, 401);
      assert.equal(anon.json.error, "Authentication required");

      const clinic = getDb()
        .prepare("SELECT id, tenant_id, email, role, name FROM users WHERE email = ?")
        .get("clinic.admin@lumera.me") as
        | { id: string; tenant_id: string; email: string; role: string; name: string }
        | undefined;
      assert.ok(clinic?.id);
      const before = qualifiedCount(String(clinic.tenant_id));
      const token = signJwtToken({
        userId: clinic.id,
        tenantId: String(clinic.tenant_id || ""),
        email: clinic.email,
        role: clinic.role,
        name: clinic.name,
      });
      const authed = await jsonRequest(
        port,
        "POST",
        "/api/abdm/dhis/simulate-transaction",
        { type: "DISCHARGE_SUMMARY" },
        auth(token)
      );
      assert.equal(authed.status, 403);
      assert.match(String(authed.json.error || ""), /disabled in production/i);
      assert.equal(qualifiedCount(String(clinic.tenant_id)), before);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

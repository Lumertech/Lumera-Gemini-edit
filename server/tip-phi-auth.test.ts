import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

const PHI_MARKERS = ["Rajiv Saxena", "Sunita Roy", "Clinical Prescription", "+91 98234 55667"];

function assertNoPhi(body: string) {
  for (const marker of PHI_MARKERS) {
    assert.equal(body.includes(marker), false, `response leaked ${marker}`);
  }
}

describe("LUM-TIP-001 / LUM-TIP-003 prescription and meta catalog authz", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-tip-phi";
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

  async function textGet(path: string, headers: Record<string, string> = {}) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers, redirect: "manual" });
    const body = await res.text();
    return { status: res.status, body, headers: res.headers };
  }

  it("anonymous prescription HTML ids are 401 and contain no PHI", async () => {
    for (const id of ["rx-101", "rx-102", "RX-2026-0106"]) {
      const res = await textGet(`/api/whatsapp/prescription/${id}/pdf`);
      assert.equal(res.status, 401, id);
      assertNoPhi(res.body);
      assert.match(res.body, /Authentication required/);
      const alias = await textGet(`/api/emr/prescription/${id}/pdf`);
      assert.equal(alias.status, 401, `emr ${id}`);
      assertNoPhi(alias.body);
    }
  });

  it("demo clinician can read own-tenant Rx HTML; other tenant and patient cannot", async () => {
    const doctor = await login("doctor@lumera.me");
    const doctorAuth = { Authorization: `Bearer ${doctor}` };
    const own = await textGet("/api/whatsapp/prescription/rx-101/pdf", doctorAuth);
    assert.equal(own.status, 200);
    assert.match(own.body, /Clinical Prescription - RX-2026-0106/);
    assert.match(own.body, /Rajiv Saxena/);
    const byNumber = await textGet("/api/whatsapp/prescription/RX-2026-0106/pdf", doctorAuth);
    assert.equal(byNumber.status, 200);
    assert.match(byNumber.body, /Rajiv Saxena/);

    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const tenantId = `tenant-tipb-${suffix}`;
    const email = `tipb.${suffix}@sec-test.example`.toLowerCase();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
         VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
      )
      .run(tenantId, "Other Clinic", now, now, now);
    getDb()
      .prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
         VALUES (?, ?, ?, ?, 'Dr Other', 'doctor', 'active', '+91 90000 00000', 'Other Clinic', 1, 'individual', 'General Medicine', ?, ?)`
      )
      .run(`user-tipb-${suffix}`, tenantId, email, hashPassword("Lumera@2026"), now, now);
    const other = await login(email);
    const stolen = await textGet("/api/whatsapp/prescription/rx-101/pdf", { Authorization: `Bearer ${other}` });
    assert.equal(stolen.status, 403);
    assertNoPhi(stolen.body);
    assert.match(stolen.body, /Insufficient permissions/);

    const patient = await login("patient@lumera.me");
    const denied = await textGet("/api/whatsapp/prescription/RX-2026-0106/pdf", {
      Authorization: `Bearer ${patient}`,
    });
    assert.equal(denied.status, 403);
    assertNoPhi(denied.body);
  });

  it("anonymous meta catalog is 401; admin and clinic-admin can read it; doctor cannot", async () => {
    for (const path of ["/api/meta/wabas", "/api/meta/overview"]) {
      const anon = await jsonRequest(port, "GET", path);
      assert.equal(anon.status, 401, path);
      assert.equal(anon.json.error, "Authentication required");
      const raw = JSON.stringify(anon.json);
      assert.equal(raw.includes("wabaId"), false);
      assert.equal(raw.includes("clinicPhone"), false);
      assert.equal(raw.includes("phoneNumberId"), false);
      assert.equal(raw.includes("NOT_SUBMITTED"), false);
    }

    const doctor = await login("doctor@lumera.me");
    const doctorWabas = await jsonRequest(port, "GET", "/api/meta/wabas", undefined, {
      Authorization: `Bearer ${doctor}`,
    });
    assert.equal(doctorWabas.status, 403);
    const doctorOverview = await jsonRequest(port, "GET", "/api/meta/overview", undefined, {
      Authorization: `Bearer ${doctor}`,
    });
    assert.equal(doctorOverview.status, 403);

    const admin = await login("admin@lumera.me");
    const wabas = await jsonRequest(port, "GET", "/api/meta/wabas", undefined, {
      Authorization: `Bearer ${admin}`,
    });
    assert.equal(wabas.status, 200);
    assert.ok(Array.isArray(wabas.json.wabas));
    const overview = await jsonRequest(port, "GET", "/api/meta/overview", undefined, {
      Authorization: `Bearer ${admin}`,
    });
    assert.equal(overview.status, 200);
    assert.ok(overview.json.appReviewStatus);

    const clinic = await login("clinic.admin@lumera.me");
    const clinicWabas = await jsonRequest(port, "GET", "/api/meta/wabas", undefined, {
      Authorization: `Bearer ${clinic}`,
    });
    assert.equal(clinicWabas.status, 200);
    const clinicOverview = await jsonRequest(port, "GET", "/api/meta/overview", undefined, {
      Authorization: `Bearer ${clinic}`,
    });
    assert.equal(clinicOverview.status, 200);
  });

  it("appointment_reminder_24h stays on the clinician bearer path", async () => {
    const anon = await jsonRequest(port, "POST", "/api/whatsapp/outbound/trigger", {
      eventType: "appointment_reminder_24h",
      patientPhone: "+910000111222",
    });
    assert.equal(anon.status, 401);

    const doctor = await login("doctor@lumera.me");
    const authed = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/outbound/trigger",
      { eventType: "appointment_reminder_24h", patientPhone: "+910000111222" },
      { Authorization: `Bearer ${doctor}` }
    );
    assert.notEqual(authed.status, 401);
    assert.notEqual(authed.status, 403);
  });
});

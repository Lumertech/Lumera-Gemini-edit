import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { attachUser, isPlatformAdminRole } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { DEFAULT_PRACTICE_TYPE } from "../src/lib/practiceOnboarding.ts";
import {
  PLAN_CATALOG,
  SUSPENDED_DEMO_EMAIL,
  SUSPENDED_DEMO_TENANT_ID,
  resolvePlanCode,
} from "./plan-catalog.ts";
import { DEMO_PASSWORD } from "../src/lib/demoAccounts.ts";

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

function seedRoleUser(role: string, label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-sa-${label}-${suffix}`;
  const userId = `user-sa-${label}-${suffix}`;
  const email = `${label}.${suffix}@sa-test.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `SA Clinic ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, 'individual', 'gp', ?, ?)`
  ).run(userId, tenantId, email, hashPassword(DEMO_PASSWORD), `User ${label}`, role, `+91 96000 ${label.slice(0, 5).padEnd(5, "0")}`, `SA Clinic ${label}`, now, now);
  return { tenantId, userId, email };
}

describe("Platform admin tenants + tenant-scoped subscriptions (#54)", () => {
  let port = 0;
  let server: Server | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-admin-tenants-54";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const app = express();
    app.use(express.json());
    app.use(attachUser);
    app.use("/api", createApiRouter());
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    port = addr.port;
  });

  after(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
  });

  async function login(email: string) {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: DEMO_PASSWORD,
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || `login ${email}`));
    const token = String(res.json.token || "");
    return { token, user: res.json.user as Record<string, unknown>, auth: { Authorization: `Bearer ${token}` } };
  }

  it("auth helpers treat super_admin and legacy admin as platform admin", () => {
    assert.equal(isPlatformAdminRole("super_admin"), true);
    assert.equal(isPlatformAdminRole("admin"), true);
    assert.equal(isPlatformAdminRole("CLINIC_ADMIN"), false);
    assert.equal(isPlatformAdminRole("polyclinic_admin"), false);
    assert.equal(isPlatformAdminRole("doctor"), false);
  });

  it("public register default remains Individual (#52)", () => {
    assert.equal(DEFAULT_PRACTICE_TYPE, "individual");
  });

  it("SA-1: clinic_admin / polyclinic_admin / doctor / receptionist get 403 on list-all-tenants", async () => {
    const clinic = seedRoleUser("CLINIC_ADMIN", "clinic");
    const poly = seedRoleUser("polyclinic_admin", "poly");
    const logins = [
      { email: clinic.email, role: "CLINIC_ADMIN" },
      { email: poly.email, role: "polyclinic_admin" },
      { email: "doctor@lumera.me", role: "doctor" },
      { email: "receptionist@lumera.me", role: "receptionist" },
      { email: "clinic.admin@lumera.me", role: "CLINIC_ADMIN" },
    ];
    for (const row of logins) {
      const session = await login(row.email);
      const listed = await jsonRequest(port, "GET", "/api/admin/tenants", undefined, session.auth);
      assert.equal(listed.status, 403, `${row.role} must not list all tenants`);
      const created = await jsonRequest(port, "POST", "/api/admin/tenants", { name: "Nope" }, session.auth);
      assert.equal(created.status, 403, `${row.role} must not create tenants`);
      const plans = await jsonRequest(port, "GET", "/api/admin/plans", undefined, session.auth);
      assert.equal(plans.status, 403, `${row.role} must not read plan catalog`);
    }
  });

  it("SA-2/SA-6: super_admin lists tenants with plan badge + catalog", async () => {
    const { auth } = await login("admin@lumera.me");
    const plans = await jsonRequest(port, "GET", "/api/admin/plans", undefined, auth);
    assert.equal(plans.status, 200);
    const catalog = plans.json.plans as Array<{ code: string; displayName: string; priceCopy: string }>;
    assert.ok(catalog.length >= 4);
    for (const code of ["trial", "starter", "professional", "clinic"]) {
      assert.ok(catalog.some((p) => p.code === code), `missing plan ${code}`);
    }
    const listed = await jsonRequest(port, "GET", "/api/admin/tenants", undefined, auth);
    assert.equal(listed.status, 200, String(listed.json.error || "list"));
    const tenants = listed.json.tenants as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(tenants) && tenants.length >= 1);
    const demo = tenants.find((t) => t.id === "tenant-lumera-main");
    assert.ok(demo, "demo tenant missing");
    assert.ok(demo?.name);
    assert.ok(demo?.type === "individual" || demo?.type === "polyclinic");
    assert.ok(["active", "trial", "suspended", "deleted"].includes(String(demo?.status)));
    const plan = demo?.plan as { badge?: string; code?: string };
    assert.ok(plan?.badge && plan?.code);
    assert.ok(demo?.createdAt);
    const owner = demo?.owner as { email?: string };
    assert.ok(owner);

    const suspended = tenants.find((t) => t.id === SUSPENDED_DEMO_TENANT_ID);
    assert.ok(suspended, "suspended demo fixture must be seeded");
    assert.equal(suspended?.status, "suspended");

    const searched = await jsonRequest(port, "GET", `/api/admin/tenants?q=${encodeURIComponent("suspended.clinic")}`, undefined, auth);
    const hits = searched.json.tenants as Array<Record<string, unknown>>;
    assert.ok(hits.some((t) => t.id === SUSPENDED_DEMO_TENANT_ID));
  });

  it("SA-3: create + suspend + reinstate round-trip; clinic user blocked then restored", async () => {
    const { auth } = await login("admin@lumera.me");
    const stamp = `${Date.now().toString(36)}`;
    const created = await jsonRequest(
      port,
      "POST",
      "/api/admin/tenants",
      {
        name: `Roundtrip Clinic ${stamp}`,
        type: "individual",
        owner: { name: "Rina Shah", email: `rina.${stamp}@roundtrip.example`, phone: "+91 98111 00054" },
        planCode: "trial",
      },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || "create tenant"));
    const tenant = created.json.tenant as Record<string, unknown>;
    assert.equal(tenant.name, `Roundtrip Clinic ${stamp}`);
    assert.equal(tenant.type, "individual");
    assert.equal(tenant.status, "trial");
    const tenantId = String(tenant.id);

    const listed = await jsonRequest(port, "GET", `/api/admin/tenants?q=${encodeURIComponent(`rina.${stamp}`)}`, undefined, auth);
    const found = (listed.json.tenants as Array<Record<string, unknown>>).find((t) => t.id === tenantId);
    assert.ok(found, "created tenant missing after list/search (hard-reload equivalent)");

    const userEmail = `doc.${stamp}@roundtrip.example`;
    const user = await jsonRequest(
      port,
      "POST",
      "/api/users",
      { name: "Roundtrip Doctor", email: userEmail, role: "doctor", specialty: "gp", password: DEMO_PASSWORD, tenantId },
      auth
    );
    assert.equal(user.status, 201, String(user.json.error || "create user"));

    const clinicLogin = await jsonRequest(port, "POST", "/api/auth/login", {
      email: userEmail,
      password: DEMO_PASSWORD,
      skipOtp: true,
    });
    assert.equal(clinicLogin.status, 200, "clinic user should sign in before suspend");
    const clinicAuth = { Authorization: `Bearer ${String(clinicLogin.json.token || "")}` };

    const suspended = await jsonRequest(port, "PATCH", `/api/admin/tenants/${tenantId}`, { status: "suspended" }, auth);
    assert.equal(suspended.status, 200, String(suspended.json.error || "suspend"));
    assert.equal((suspended.json.tenant as { status?: string }).status, "suspended");

    const reloaded = await jsonRequest(port, "GET", `/api/admin/tenants/${tenantId}`, undefined, auth);
    assert.equal((reloaded.json.tenant as { status?: string }).status, "suspended");

    const blockedLogin = await jsonRequest(port, "POST", "/api/auth/login", {
      email: userEmail,
      password: DEMO_PASSWORD,
      skipOtp: true,
    });
    assert.equal(blockedLogin.status, 403);
    assert.match(String(blockedLogin.json.error || ""), /suspended/i);

    const blockedApi = await jsonRequest(port, "GET", "/api/tenant/letterhead", undefined, clinicAuth);
    assert.equal(blockedApi.status, 403);

    const audits = getDb()
      .prepare("SELECT action FROM audit_logs WHERE details LIKE ? ORDER BY timestamp DESC LIMIT 8")
      .all(`%${tenantId}%`) as { action: string }[];
    assert.ok(audits.some((a) => /tenant created/i.test(a.action)));
    assert.ok(audits.some((a) => /tenant suspended/i.test(a.action)));

    const reinstated = await jsonRequest(port, "PATCH", `/api/admin/tenants/${tenantId}`, { status: "active" }, auth);
    assert.equal(reinstated.status, 200);
    assert.equal((reinstated.json.tenant as { status?: string }).status, "active");

    const after = await jsonRequest(port, "POST", "/api/auth/login", {
      email: userEmail,
      password: DEMO_PASSWORD,
      skipOtp: true,
    });
    assert.equal(after.status, 200, String(after.json.error || "reinstate login"));

    const soft = await jsonRequest(port, "PATCH", `/api/admin/tenants/${tenantId}`, { status: "deleted" }, auth);
    assert.equal((soft.json.tenant as { status?: string }).status, "deleted");
    const stillListed = await jsonRequest(port, "GET", `/api/admin/tenants/${tenantId}`, undefined, auth);
    assert.equal((stillListed.json.tenant as { status?: string }).status, "deleted");
  });

  it("SA-4/SA-5/SA-6: plan assign updates badge; unknown plan 400; billingSource is manual", async () => {
    const { auth } = await login("admin@lumera.me");
    const stamp = `${Date.now().toString(36)}`;
    const created = await jsonRequest(
      port,
      "POST",
      "/api/admin/tenants",
      { name: `Plan Clinic ${stamp}`, type: "polyclinic", ownerEmail: `owner.${stamp}@plan.example` },
      auth
    );
    const tenantId = String((created.json.tenant as { id: string }).id);

    const assigned = await jsonRequest(
      port,
      "PATCH",
      `/api/admin/tenants/${tenantId}/subscription`,
      { planCode: "professional", status: "active" },
      auth
    );
    assert.equal(assigned.status, 200, String(assigned.json.error || "assign"));
    const sub = assigned.json.subscription as Record<string, unknown>;
    assert.equal(sub.planCode, "professional");
    assert.equal(sub.status, "active");
    assert.equal(sub.billingSource, "manual");
    assert.equal(sub.honestyLabel, "manual");
    assert.equal(sub.paymentCollected, false);
    assert.ok(sub.priceCopy);
    assert.ok(sub.planBadge || sub.planDisplayName);

    const detail = await jsonRequest(port, "GET", `/api/admin/tenants/${tenantId}`, undefined, auth);
    const tenant = detail.json.tenant as {
      plan?: { badge?: string; code?: string };
      subscription?: { billingSource?: string };
    };
    assert.equal(tenant.plan?.code, "professional");
    assert.equal(tenant.plan?.badge, "Professional");
    assert.equal(tenant.subscription?.billingSource, "manual");

    const listed = await jsonRequest(port, "GET", `/api/admin/tenants?q=${encodeURIComponent(`Plan Clinic ${stamp}`)}`, undefined, auth);
    const row = (listed.json.tenants as Array<{ id: string; plan?: { badge?: string } }>).find((t) => t.id === tenantId);
    assert.equal(row?.plan?.badge, "Professional");

    const unknown = await jsonRequest(
      port,
      "PATCH",
      `/api/admin/tenants/${tenantId}/subscription`,
      { planCode: "quantum-healing" },
      auth
    );
    assert.equal(unknown.status, 400);
    assert.match(String(unknown.json.error || ""), /unknown plan/i);

    const razorpay = await jsonRequest(
      port,
      "PATCH",
      `/api/admin/tenants/${tenantId}/subscription`,
      { planCode: "clinic", status: "active", billingSource: "razorpay" },
      auth
    );
    assert.equal(razorpay.status, 400);
    assert.match(String(razorpay.json.error || ""), /PSP|Razorpay|manual/i);

    assert.equal(resolvePlanCode("Enterprise Trial"), "trial");
    assert.equal(PLAN_CATALOG.some((p) => p.code === "professional"), true);
  });

  it("seeded suspended fixture cannot sign in", async () => {
    const blocked = await jsonRequest(port, "POST", "/api/auth/login", {
      email: SUSPENDED_DEMO_EMAIL,
      password: DEMO_PASSWORD,
      skipOtp: true,
    });
    assert.equal(blocked.status, 403);
    assert.match(String(blocked.json.error || ""), /suspended|no longer active/i);
  });
});

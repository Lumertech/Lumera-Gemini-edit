import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { DEMO_PASSWORD } from "../src/lib/demoAccounts.ts";

describe("tenant-scoped clinic branches", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-clinic-branches";
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

  async function login(email: string, password = DEMO_PASSWORD) {
    const res = await jsonRequest(port, "POST", "/api/auth/login", { email, password, skipOtp: true });
    assert.equal(res.status, 200, String(res.json.error || `login ${email}`));
    return { token: String(res.json.token || ""), auth: { Authorization: `Bearer ${res.json.token}` } };
  }

  function seedClinicAdmin(label: string) {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const tenantId = `tenant-br-${label}-${suffix}`;
    const userId = `user-br-${label}-${suffix}`;
    const email = `${label}.${suffix}@branches-test.example`.toLowerCase();
    const now = new Date().toISOString();
    const db = getDb();
    db.prepare(
      `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
       VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+91 98000 00000', ?, 500, 0, 1, '', ?, ?)`
    ).run(tenantId, `Branch Clinic ${label}`, now, now, now);
    db.prepare(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
       VALUES (?, ?, ?, ?, ?, 'CLINIC_ADMIN', 'active', '+91 98000 00001', ?, 1, 'polyclinic', 'gp', ?, ?)`
    ).run(userId, tenantId, email, hashPassword(DEMO_PASSWORD), `Admin ${label}`, `Branch Clinic ${label}`, now, now);
    return { tenantId, email };
  }

  it("lets polyclinic CLINIC_ADMIN create, edit, and archive a branch that survives reload", async () => {
    const { email, tenantId } = seedClinicAdmin("owner");
    const { auth } = await login(email);

    const created = await jsonRequest(
      port,
      "POST",
      "/api/branches",
      { name: "Indiranagar OPD", address: "100ft Road", phone: "+91 80 4000 0001", opdHours: "09:00-13:00", status: "Operating" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || "create"));
    const branch = created.json.branch as { id: string; tenant_id: string; name: string; status: string };
    assert.equal(branch.tenant_id, tenantId);
    assert.equal(branch.name, "Indiranagar OPD");

    const listed = await jsonRequest(port, "GET", "/api/branches", undefined, auth);
    assert.equal(listed.status, 200);
    const names = (listed.json.branches as Array<{ name: string }>).map((row) => row.name);
    assert.ok(names.includes("Indiranagar OPD"));

    const renamed = await jsonRequest(
      port,
      "PATCH",
      `/api/branches/${branch.id}`,
      { name: "Indiranagar Day Clinic", status: "Paused" },
      auth
    );
    assert.equal(renamed.status, 200, String(renamed.json.error || "patch"));
    assert.equal((renamed.json.branch as { name: string; status: string }).name, "Indiranagar Day Clinic");
    assert.equal((renamed.json.branch as { status: string }).status, "Paused");

    const archived = await jsonRequest(port, "POST", `/api/branches/${branch.id}/archive`, { status: "Archived" }, auth);
    assert.equal(archived.status, 200, String(archived.json.error || "archive"));
    assert.equal((archived.json.branch as { status: string }).status, "Archived");

    const reloaded = await jsonRequest(port, "GET", "/api/branches", undefined, auth);
    const row = (reloaded.json.branches as Array<{ id: string; name: string; status: string }>).find((item) => item.id === branch.id);
    assert.ok(row, "archived branch must still be listed");
    assert.equal(row?.name, "Indiranagar Day Clinic");
    assert.equal(row?.status, "Archived");

    const stored = getDb().prepare("SELECT name, status, tenant_id FROM branches WHERE id = ?").get(branch.id) as {
      name: string;
      status: string;
      tenant_id: string;
    };
    assert.equal(stored.name, "Indiranagar Day Clinic");
    assert.equal(stored.status, "Archived");
    assert.equal(stored.tenant_id, tenantId);
  });

  it("rejects super admin writes, individual practice writes, and cross-tenant updates", async () => {
    const owner = seedClinicAdmin("alpha");
    const other = seedClinicAdmin("beta");
    const ownerAuth = (await login(owner.email)).auth;
    const otherAuth = (await login(other.email)).auth;
    const created = await jsonRequest(port, "POST", "/api/branches", { name: "Alpha Wing" }, ownerAuth);
    assert.equal(created.status, 201, String(created.json.error || "alpha create"));
    const id = String((created.json.branch as { id: string }).id);

    const superAdmin = await login("admin@lumera.me");
    const superWrite = await jsonRequest(port, "POST", "/api/branches", { name: "Should fail" }, superAdmin.auth);
    assert.equal(superWrite.status, 403);
    const superPatch = await jsonRequest(port, "PATCH", `/api/branches/${id}`, { name: "Stolen", status: "Operating" }, superAdmin.auth);
    assert.equal(superPatch.status, 403);
    const superList = await jsonRequest(port, "GET", "/api/branches", undefined, superAdmin.auth);
    assert.equal(superList.status, 200);
    assert.deepEqual(superList.json.branches, []);

    const doctor = await login("doctor@lumera.me");
    const doctorWrite = await jsonRequest(port, "POST", "/api/branches", { name: "Doctor branch" }, doctor.auth);
    assert.equal(doctorWrite.status, 403);
    const doctorList = await jsonRequest(port, "GET", "/api/branches", undefined, doctor.auth);
    assert.equal(doctorList.status, 403);

    const reception = await login("reception@lumera.me");
    assert.equal((await jsonRequest(port, "GET", "/api/branches", undefined, reception.auth)).status, 403);

    const cross = await jsonRequest(port, "PATCH", `/api/branches/${id}`, { name: "Beta rename", status: "Disabled" }, otherAuth);
    assert.equal(cross.status, 403);
    const crossArchive = await jsonRequest(port, "POST", `/api/branches/${id}/archive`, {}, otherAuth);
    assert.equal(crossArchive.status, 403);

    const still = getDb().prepare("SELECT name, status, tenant_id FROM branches WHERE id = ?").get(id) as {
      name: string;
      status: string;
      tenant_id: string;
    };
    assert.equal(still.name, "Alpha Wing");
    assert.equal(still.status, "Operating");
    assert.equal(still.tenant_id, owner.tenantId);

    const otherList = await jsonRequest(port, "GET", "/api/branches", undefined, otherAuth);
    assert.equal(
      (otherList.json.branches as Array<{ id: string }>).some((row) => row.id === id),
      false
    );

    const anon = await jsonRequest(port, "GET", "/api/branches");
    assert.equal(anon.status, 401);
  });
});

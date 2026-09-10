import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { DEMO_TENANT_ID, getDb, initDatabase, seedDemoSpecialtyPackUsers } from "./db.ts";
import { hashPassword } from "./password.ts";
import { DEMO_SPECIALTY_MATRIX, SIBLING_PR55_DEMO_EMAILS, roleHomeForAccount } from "./specialty-packs.ts";

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

function seedClinicAdmin(label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-um-${label}-${suffix}`;
  const userId = `user-um-${label}-${suffix}`;
  const email = `${label}.${suffix}@um-test.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `UM Clinic ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'CLINIC_ADMIN', 'active', ?, ?, 1, 'polyclinic', 'General Medicine', ?, ?)`
  ).run(
    userId,
    tenantId,
    email,
    hashPassword("Lumera@2026"),
    `Admin ${label}`,
    `+91 97000 ${label.slice(0, 5).padEnd(5, "0")}`,
    `UM Clinic ${label}`,
    now,
    now
  );
  return { tenantId, userId, email };
}

describe("Admin UM users API (UM-1…6)", () => {
  let port = 0;
  let server: Server | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-admin-um-users";
    }
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
    if (!addr || typeof addr === "string") throw new Error("server did not bind a port");
    port = addr.port;
  });

  after(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("live smoke: admin@lumera.me / Lumera@2026 completes login without WhatsApp OTP", async () => {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email: "admin@lumera.me",
      password: "Lumera@2026",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.requiresOtp, false);
    assert.ok(res.json.token);
    assert.equal((res.json.user as Record<string, unknown>).email, "admin@lumera.me");
    assert.equal((res.json.user as Record<string, unknown>).role, "super_admin");
    assert.equal(res.json.verificationId, undefined);
  });

  async function login(email: string, password = "Lumera@2026"): Promise<{ token: string; user: Record<string, unknown> }> {
    const loginRes = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password,
      skipOtp: true,
    });
    assert.equal(loginRes.status, 200, String(loginRes.json.error || `login failed for ${email}`));
    return {
      token: String(loginRes.json.token || ""),
      user: (loginRes.json.user || {}) as Record<string, unknown>,
    };
  }

  it("UM-2/UM-3: POST persists specialty+tenant and returns temporaryPassword when omitted", async () => {
    const admin = await login("admin@lumera.me");
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const email = `created.${stamp}@um-test.example`;
    const created = await jsonRequest(
      port,
      "POST",
      "/api/users",
      {
        name: "Created Physio",
        displayName: "Created Physio",
        email,
        role: "doctor",
        tenant_id: DEMO_TENANT_ID,
        specialty: "physio",
      },
      { Authorization: `Bearer ${admin.token}` }
    );
    assert.equal(created.status, 201, String(created.json.error || "create failed"));
    const temp = String(created.json.temporaryPassword || "");
    assert.ok(temp.length >= 8, "temporaryPassword must be returned and usable");
    const user = (created.json.user || {}) as Record<string, unknown>;
    assert.equal(user.email, email);
    assert.equal(user.specialty, "physio");
    assert.equal(user.tenantId, DEMO_TENANT_ID);
    assert.equal(user.practiceType, "individual");

    const row = getDb()
      .prepare("SELECT tenant_id, specialty, practice_type FROM users WHERE email = ?")
      .get(email) as { tenant_id: string; specialty: string; practice_type: string };
    assert.equal(row.tenant_id, DEMO_TENANT_ID);
    assert.equal(row.specialty, "physio");
    assert.equal(row.practice_type, "individual");

    const doc = getDb().prepare("SELECT specialty FROM doctors WHERE user_id = ?").get(user.id) as {
      specialty: string;
    };
    assert.equal(doc.specialty, "physio");

    const tempLogin = await login(email, temp);
    assert.equal(tempLogin.user.specialty, "physio");

    const audits = getDb()
      .prepare("SELECT details FROM audit_logs WHERE action = 'User created' AND details LIKE ? ORDER BY timestamp DESC LIMIT 3")
      .all(`%${email}%`) as { details: string }[];
    assert.ok(audits.length >= 1);
    for (const a of audits) {
      assert.equal(a.details.includes(temp), false, "temporary password must never be audited");
    }

    const withPassword = await jsonRequest(
      port,
      "POST",
      "/api/users",
      {
        name: "Explicit Pwd",
        email: `explicit.${stamp}@um-test.example`,
        role: "doctor",
        specialty: "gp",
        tenantId: DEMO_TENANT_ID,
        password: "Lumera@2026",
      },
      { Authorization: `Bearer ${admin.token}` }
    );
    assert.equal(withPassword.status, 201);
    assert.equal(withPassword.json.temporaryPassword, undefined);
    assert.equal((withPassword.json.user as Record<string, unknown>).specialty, "gp");

    const dup = await jsonRequest(
      port,
      "POST",
      "/api/users",
      { name: "Dup", email, role: "doctor", password: "Lumera@2026" },
      { Authorization: `Bearer ${admin.token}` }
    );
    assert.equal(dup.status, 409);

    const short = await jsonRequest(
      port,
      "POST",
      "/api/users",
      { name: "Short", email: `short.${stamp}@um-test.example`, role: "doctor", password: "abc" },
      { Authorization: `Bearer ${admin.token}` }
    );
    assert.equal(short.status, 400);
  });

  it("UM-1: PATCH specialty/name/status persists and GET list reflects it", async () => {
    const admin = await login("admin@lumera.me");
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const email = `patch.${stamp}@um-test.example`;
    const created = await jsonRequest(
      port,
      "POST",
      "/api/users",
      {
        name: "Patch Me",
        email,
        role: "doctor",
        tenantId: DEMO_TENANT_ID,
        packId: "gp",
        password: "Lumera@2026",
      },
      { Authorization: `Bearer ${admin.token}` }
    );
    assert.equal(created.status, 201, String(created.json.error || "create failed"));
    assert.equal((created.json.user as Record<string, unknown>).specialty, "gp");
    const id = String((created.json.user as Record<string, unknown>).id);

    const patched = await jsonRequest(
      port,
      "PATCH",
      `/api/users/${id}`,
      {
        displayName: "Patched Dentist",
        phone: "+91 90000 11111",
        role: "doctor",
        specialty: "dentist",
        enabled: true,
      },
      { Authorization: `Bearer ${admin.token}` }
    );
    assert.equal(patched.status, 200, String(patched.json.error || "patch failed"));
    const patchedUser = (patched.json.user || {}) as Record<string, unknown>;
    assert.equal(patchedUser.name, "Patched Dentist");
    assert.equal(patchedUser.specialty, "dentist");
    assert.equal(patchedUser.phone, "+91 90000 11111");
    assert.equal(patchedUser.status, "active");

    const listed = await jsonRequest(port, "GET", `/api/users?q=${encodeURIComponent(email)}`, undefined, {
      Authorization: `Bearer ${admin.token}`,
    });
    assert.equal(listed.status, 200);
    const users = (listed.json.users || []) as Array<Record<string, unknown>>;
    const found = users.find((u) => u.email === email);
    assert.ok(found);
    assert.equal(found?.name, "Patched Dentist");
    assert.equal(found?.specialty, "dentist");

    const patchLabel = await jsonRequest(
      port,
      "PATCH",
      `/api/users/${id}`,
      { specialty: "Dental Surgery" },
      { Authorization: `Bearer ${admin.token}` }
    );
    assert.equal(patchLabel.status, 200);
    assert.equal((patchLabel.json.user as Record<string, unknown>).specialty, "dentist");

    const patchBad = await jsonRequest(
      port,
      "PATCH",
      `/api/users/${id}`,
      { specialty: "veterinary" },
      { Authorization: `Bearer ${admin.token}` }
    );
    assert.equal(patchBad.status, 400);

    const labeled = await jsonRequest(
      port,
      "POST",
      "/api/users",
      {
        name: "Label Physio",
        email: `label.${stamp}@um-test.example`,
        role: "doctor",
        tenantId: DEMO_TENANT_ID,
        specialty: "Physiotherapy & Rehabilitation",
        password: "Lumera@2026",
      },
      { Authorization: `Bearer ${admin.token}` }
    );
    assert.equal(labeled.status, 201, String(labeled.json.error || "label create failed"));
    assert.equal((labeled.json.user as Record<string, unknown>).specialty, "physio");

    const wellnessLabel = await jsonRequest(
      port,
      "POST",
      "/api/users",
      {
        name: "Label Spa",
        email: `spa-label.${stamp}@um-test.example`,
        role: "doctor",
        tenantId: DEMO_TENANT_ID,
        specialty: "Wellness & Spas",
        password: "Lumera@2026",
      },
      { Authorization: `Bearer ${admin.token}` }
    );
    assert.equal(wellnessLabel.status, 201, String(wellnessLabel.json.error || "wellness label create failed"));
    assert.equal((wellnessLabel.json.user as Record<string, unknown>).specialty, "spa_salon");

    const unmapped = await jsonRequest(
      port,
      "POST",
      "/api/users",
      {
        name: "Unknown Spec",
        email: `unknown.${stamp}@um-test.example`,
        role: "doctor",
        specialty: "veterinary",
        password: "Lumera@2026",
      },
      { Authorization: `Bearer ${admin.token}` }
    );
    assert.equal(unmapped.status, 400);
  });

  it("UM-1/tenant: non-super_admin cannot reassign tenant; wrong-tenant is 403/404", async () => {
    const clinic = seedClinicAdmin("iso");
    const admin = await login("admin@lumera.me");
    const clinicAuth = await login(clinic.email);
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const email = `stay.${stamp}@um-test.example`;

    const created = await jsonRequest(
      port,
      "POST",
      "/api/users",
      {
        name: "Clinic Doc",
        email,
        role: "doctor",
        tenantId: clinic.tenantId,
        packId: "gp",
        password: "Lumera@2026",
      },
      { Authorization: `Bearer ${admin.token}` }
    );
    assert.equal(created.status, 201, String(created.json.error || "create failed"));
    const id = String((created.json.user as Record<string, unknown>).id);

    const steal = await jsonRequest(
      port,
      "PATCH",
      `/api/users/${id}`,
      { tenantId: DEMO_TENANT_ID, specialty: "physio" },
      { Authorization: `Bearer ${clinicAuth.token}` }
    );
    assert.equal(steal.status, 403);
    const row = getDb().prepare("SELECT tenant_id, pack_id FROM users WHERE id = ?").get(id) as {
      tenant_id: string;
      pack_id: string;
    };
    assert.equal(row.tenant_id, clinic.tenantId);

    const demoGp = getDb().prepare("SELECT id FROM users WHERE email = ?").get("gp.doctor@lumera.me") as { id: string };
    const cross = await jsonRequest(
      port,
      "PATCH",
      `/api/users/${demoGp.id}`,
      { displayName: "Hijack" },
      { Authorization: `Bearer ${clinicAuth.token}` }
    );
    assert.ok([403, 404].includes(cross.status));

    const listed = await jsonRequest(port, "GET", "/api/users", undefined, {
      Authorization: `Bearer ${clinicAuth.token}`,
    });
    const emails = ((listed.json.users || []) as Array<Record<string, unknown>>).map((u) => u.email);
    assert.equal(emails.includes("gp.doctor@lumera.me"), false);
    assert.ok(emails.includes(email));

    const moved = await jsonRequest(
      port,
      "PATCH",
      `/api/users/${id}`,
      { tenantId: DEMO_TENANT_ID },
      { Authorization: `Bearer ${admin.token}` }
    );
    assert.equal(moved.status, 200, String(moved.json.error || "super_admin tenant move failed"));
    assert.equal((moved.json.user as Record<string, unknown>).tenantId, DEMO_TENANT_ID);
    const afterMove = getDb().prepare("SELECT tenant_id FROM users WHERE id = ?").get(id) as { tenant_id: string };
    assert.equal(afterMove.tenant_id, DEMO_TENANT_ID);
  });

  it("UM-4: disabled status rejects login; reset issues a usable credential and writes audit", async () => {
    const admin = await login("admin@lumera.me");
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const email = `disabled.${stamp}@um-test.example`;
    const created = await jsonRequest(
      port,
      "POST",
      "/api/users",
      {
        name: "Disable Me",
        email,
        role: "doctor",
        tenantId: DEMO_TENANT_ID,
        packId: "consultant",
        password: "Lumera@2026",
      },
      { Authorization: `Bearer ${admin.token}` }
    );
    const id = String((created.json.user as Record<string, unknown>).id);

    const disabled = await jsonRequest(
      port,
      "PATCH",
      `/api/users/${id}`,
      { status: "disabled" },
      { Authorization: `Bearer ${admin.token}` }
    );
    assert.equal(disabled.status, 200);
    assert.equal((disabled.json.user as Record<string, unknown>).status, "disabled");

    const blocked = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(blocked.status, 403);
    assert.match(String(blocked.json.error || ""), /disabled/i);

    const reset = await jsonRequest(
      port,
      "POST",
      `/api/users/${id}/password`,
      {},
      { Authorization: `Bearer ${admin.token}` }
    );
    assert.equal(reset.status, 200);
    const nextPwd = String(reset.json.temporaryPassword || "");
    assert.ok(nextPwd.length >= 8);

    await jsonRequest(
      port,
      "PATCH",
      `/api/users/${id}`,
      { enabled: true },
      { Authorization: `Bearer ${admin.token}` }
    );
    const after = await login(email, nextPwd);
    assert.equal(after.user.email, email);

    const audits = getDb()
      .prepare("SELECT action FROM audit_logs WHERE details LIKE ? ORDER BY timestamp DESC LIMIT 8")
      .all(`%${email}%`) as { action: string }[];
    assert.ok(audits.some((a) => /password reset/i.test(a.action)));
    assert.ok(audits.some((a) => /user updated/i.test(a.action)));
  });

  it("UM-5: demo specialty matrix logs in on demo tenant only with pack-correct role-home", async () => {
    const expected = [
      { email: "admin@lumera.me", role: "super_admin", roleHome: "admin" },
      { email: "reception@lumera.me", role: "receptionist", roleHome: "app", homeView: "reception" },
      ...DEMO_SPECIALTY_MATRIX.map((row) => ({
        email: row.email,
        role: "doctor",
        specialty: row.specialty,
        roleHome: roleHomeForAccount("doctor", row.specialty).roleHome,
        homeView: roleHomeForAccount("doctor", row.specialty).homeView,
      })),
    ];

    for (const row of expected) {
      const session = await login(row.email);
      assert.equal(session.user.tenantId, DEMO_TENANT_ID, row.email);
      assert.equal(session.user.role, row.role, row.email);
      assert.equal(session.user.roleHome, row.roleHome, row.email);
      if ("specialty" in row && row.specialty) {
        assert.equal(session.user.specialty, row.specialty, row.email);
        assert.equal(session.user.homeView, row.homeView, row.email);
      }
      if (row.email === "reception@lumera.me") {
        assert.equal(session.user.homeView, "reception");
      }
    }

    const other = seedClinicAdmin("noshare");
    const stolen = getDb()
      .prepare("SELECT COUNT(*) AS c FROM users WHERE tenant_id = ? AND email IN ('gp.doctor@lumera.me', 'physio.doctor@lumera.me')")
      .get(other.tenantId) as { c: number };
    assert.equal(stolen.c, 0);

    const siblingSeeds = getDb()
      .prepare(`SELECT email FROM users WHERE email IN (${SIBLING_PR55_DEMO_EMAILS.map(() => "?").join(", ")})`)
      .all(...SIBLING_PR55_DEMO_EMAILS) as { email: string }[];
    assert.equal(siblingSeeds.length, 0, "must not insert #55 UI demo emails");
  });

  it("adopts #55 overlapping emails as pack ids without rewriting persona fields", () => {
    getDb()
      .prepare("UPDATE users SET name = ?, phone = ?, specialty = ?, pack_id = '' WHERE email = ?")
      .run(
        "Anika Bose, MPhil (Clinical Psychology)",
        "+91 98177 22001",
        "Psychiatry & Mental Health",
        "therapist@lumera.me"
      );
    getDb()
      .prepare("UPDATE users SET name = ?, specialty = ?, pack_id = '' WHERE email = ?")
      .run("Aarav Mehta", "Consulting", "consultant@lumera.me");

    seedDemoSpecialtyPackUsers(getDb());

    const therapist = getDb()
      .prepare("SELECT name, phone, specialty, pack_id FROM users WHERE email = ?")
      .get("therapist@lumera.me") as { name: string; phone: string; specialty: string; pack_id: string };
    assert.equal(therapist.specialty, "therapist");
    assert.equal(therapist.pack_id, "therapist");
    assert.equal(therapist.name, "Anika Bose, MPhil (Clinical Psychology)");
    assert.equal(therapist.phone, "+91 98177 22001");

    const consultant = getDb()
      .prepare("SELECT name, specialty, pack_id FROM users WHERE email = ?")
      .get("consultant@lumera.me") as { name: string; specialty: string; pack_id: string };
    assert.equal(consultant.specialty, "consultant");
    assert.equal(consultant.pack_id, "consultant");
    assert.equal(consultant.name, "Aarav Mehta");

    const extras = getDb()
      .prepare(`SELECT email FROM users WHERE email IN (${SIBLING_PR55_DEMO_EMAILS.map(() => "?").join(", ")})`)
      .all(...SIBLING_PR55_DEMO_EMAILS) as { email: string }[];
    assert.equal(extras.length, 0);
  });

  it("does not change public register Individual default (UM-2 / #52)", async () => {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const email = `reg.${stamp}@um-test.example`;
    const res = await jsonRequest(port, "POST", "/api/auth/register-practice", {
      clinicName: "Solo UM Clinic",
      specialty: "Cardiology",
      country: "India",
      timezone: "IST (UTC+5:30)",
      phone: `+91 98011 ${stamp.slice(0, 5)}`,
      name: "Solo UM",
      email,
      password: "Lumera@2026",
    });
    assert.equal(res.status, 200, String(res.json.error || "register failed"));
    const row = getDb().prepare("SELECT role, practice_type FROM users WHERE email = ?").get(email) as {
      role: string;
      practice_type: string;
    };
    assert.equal(row.practice_type === "individual" || row.practice_type === "", true);
    assert.equal(row.role, "doctor");
  });

  it("AdminPeople/Branches/Settings remount SoT endpoints stay intact", async () => {
    const admin = await login("admin@lumera.me");
    const headers = { Authorization: `Bearer ${admin.token}` };
    const doctors = await jsonRequest(port, "GET", "/api/doctors", undefined, headers);
    assert.equal(doctors.status, 200);
    assert.ok(Array.isArray(doctors.json.doctors));

    const staff = await jsonRequest(port, "GET", "/api/staff", undefined, headers);
    assert.equal(staff.status, 200);
    assert.ok(Array.isArray(staff.json.staff));

    const branches = await jsonRequest(port, "GET", "/api/branches", undefined, headers);
    assert.equal(branches.status, 200);
    assert.ok(Array.isArray(branches.json.branches));

    const settings = await jsonRequest(port, "GET", "/api/cms/settings", undefined, headers);
    assert.equal(settings.status, 200);
    assert.equal(typeof settings.json.settings, "object");
  });
});

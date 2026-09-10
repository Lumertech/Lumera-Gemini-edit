import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { DEMO_TENANT_ID, getDb, initDatabase } from "./db.ts";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../src/lib/demoAccounts.ts";

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

describe("Admin console persist (founder audit 1–9)", () => {
  let port = 0;
  let server: Server | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-admin-console";
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
    const user = res.json.user as Record<string, unknown>;
    return { token, user, auth: { Authorization: `Bearer ${token}` } };
  }

  it("seeds specialty demo matrix with shared password", async () => {
    const required = [
      "admin@lumera.me",
      "doctor@lumera.me",
      "dentist@lumera.me",
      "physio@lumera.me",
      "therapist@lumera.me",
      "wellness@lumera.me",
      "consultant@lumera.me",
      "receptionist@lumera.me",
      "clinic.admin@lumera.me",
      "patient@lumera.me",
    ];
    for (const email of required) {
      const { user } = await login(email);
      assert.equal(String(user.email), email);
      const row = DEMO_ACCOUNTS.find((a) => a.email === email);
      if (row?.specialty) assert.equal(String(user.specialty || ""), row.specialty);
      if (row?.practiceType) assert.equal(String(user.practiceType || ""), row.practiceType);
    }
    const clinicAdmin = DEMO_ACCOUNTS.filter((a) => a.role === "CLINIC_ADMIN" && a.practiceType === "polyclinic");
    assert.equal(clinicAdmin.length, 1);
    assert.equal(clinicAdmin[0].email, "clinic.admin@lumera.me");
  });

  it("POST /api/users sets tenant_id + specialty and returns temp password when omitted", async () => {
    const { auth } = await login("admin@lumera.me");
    const email = `audit.create.${Date.now()}@lumera.me`;
    const created = await jsonRequest(
      port,
      "POST",
      "/api/users",
      { name: "Audit Create", email, role: "doctor", specialty: "Dental Surgery", phone: "+91 90000 00001", practiceType: "individual" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || "create"));
    const user = created.json.user as Record<string, unknown>;
    assert.equal(user.specialty, "dentist");
    assert.equal(user.practiceType, "individual");
    assert.equal(user.tenantId, DEMO_TENANT_ID);
    assert.ok(created.json.temporaryPassword);
    const dbRow = getDb().prepare("SELECT tenant_id, specialty, practice_type FROM users WHERE email = ?").get(email) as {
      tenant_id: string;
      specialty: string;
      practice_type: string;
    };
    assert.equal(dbRow.tenant_id, DEMO_TENANT_ID);
    assert.equal(dbRow.specialty, "dentist");
    assert.equal(dbRow.practice_type, "individual");
  });

  it("PATCH /api/users/:id persists name/email/role/status/specialty and reload matches", async () => {
    const { auth } = await login("admin@lumera.me");
    const email = `audit.edit.${Date.now()}@lumera.me`;
    const created = await jsonRequest(
      port,
      "POST",
      "/api/users",
      { name: "Before Edit", email, role: "doctor", specialty: "General Medicine", password: DEMO_PASSWORD },
      auth
    );
    const id = String((created.json.user as { id: string }).id);
    const patched = await jsonRequest(
      port,
      "PATCH",
      `/api/users/${id}`,
      {
        name: "After Edit",
        email,
        role: "doctor",
        status: "active",
        specialty: "Wellness & Spas",
        phone: "+91 91111 22222",
        practiceType: "polyclinic",
      },
      auth
    );
    assert.equal(patched.status, 200, String(patched.json.error || "patch"));
    const user = patched.json.user as Record<string, unknown>;
    assert.equal(user.name, "After Edit");
    assert.equal(user.specialty, "spa_salon");
    assert.equal(user.practiceType, "polyclinic");
    const listed = await jsonRequest(port, "GET", `/api/users?q=${encodeURIComponent(email)}`, undefined, auth);
    const rows = listed.json.users as Array<Record<string, unknown>>;
    const found = rows.find((r) => r.id === id);
    assert.ok(found);
    assert.equal(found?.name, "After Edit");
    assert.equal(found?.specialty, "spa_salon");
    assert.equal(found?.practiceType, "polyclinic");
  });

  it("PATCH /api/auth/me persists admin profile name/phone/avatar", async () => {
    const { auth, user } = await login("admin@lumera.me");
    const originalName = String(user.name);
    const patched = await jsonRequest(
      port,
      "PATCH",
      "/api/auth/me",
      { name: "Priya Iyer Audit", phone: "+91 98000 19999", avatarUrl: "https://example.com/admin.png" },
      auth
    );
    assert.equal(patched.status, 200, String(patched.json.error || "me patch"));
    const next = patched.json.user as Record<string, unknown>;
    assert.equal(next.name, "Priya Iyer Audit");
    assert.equal(next.phone, "+91 98000 19999");
    assert.equal(next.avatarUrl, "https://example.com/admin.png");
    await jsonRequest(port, "PATCH", "/api/auth/me", { name: originalName }, auth);
  });

  it("POST /api/users rejects unknown specialty (fail closed)", async () => {
    const { auth } = await login("admin@lumera.me");
    const email = `audit.badspec.${Date.now()}@lumera.me`;
    const created = await jsonRequest(
      port,
      "POST",
      "/api/users",
      { name: "Bad Spec", email, role: "doctor", specialty: "Quantum Healing" },
      auth
    );
    assert.equal(created.status, 400);
    assert.match(String(created.json.error || ""), /specialty/i);
  });

  it("PATCH tenantId is super_admin-only (403 otherwise)", async () => {
    const { auth } = await login("admin@lumera.me");
    const email = `audit.tenant.${Date.now()}@lumera.me`;
    const created = await jsonRequest(
      port,
      "POST",
      "/api/users",
      { name: "Tenant Target", email, role: "doctor", specialty: "gp", password: DEMO_PASSWORD },
      auth
    );
    const id = String((created.json.user as { id: string }).id);
    const asAdmin = await jsonRequest(
      port,
      "PATCH",
      `/api/users/${id}`,
      { tenantId: "tenant-reassign-audit" },
      auth
    );
    assert.equal(asAdmin.status, 200, String(asAdmin.json.error || "admin tenant patch"));
    assert.equal((asAdmin.json.user as { tenantId?: string }).tenantId, "tenant-reassign-audit");

    const doctor = await login("doctor@lumera.me");
    const asDoctor = await jsonRequest(
      port,
      "PATCH",
      `/api/users/${id}`,
      { tenantId: "tenant-stolen" },
      doctor.auth
    );
    assert.equal(asDoctor.status, 403);
    const clinic = await login("clinic.admin@lumera.me");
    const asClinic = await jsonRequest(
      port,
      "PATCH",
      `/api/users/${id}`,
      { tenant_id: "tenant-stolen" },
      clinic.auth
    );
    assert.equal(asClinic.status, 403);
    const still = getDb().prepare("SELECT tenant_id FROM users WHERE id = ?").get(id) as { tenant_id: string };
    assert.equal(still.tenant_id, "tenant-reassign-audit");
  });
});

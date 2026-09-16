import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { bootWhatsAppOwnershipSchema, createWhatsAppNumbersRouter, practitionerLinkMiddleware } from "./whatsapp-numbers-routes.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { getTenantWabaNumber, upsertWhatsAppNumber, platformAdminActor } from "./whatsapp-numbers.ts";

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

let phoneSeq = 0;
function uniquePhone(): string {
  phoneSeq += 1;
  const n = `${Date.now()}${phoneSeq}${Math.floor(Math.random() * 900 + 100)}`.replace(/\D/g, "").slice(-10);
  return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
}

function seedClinic(label: string, role: "CLINIC_ADMIN" | "doctor" = "CLINIC_ADMIN") {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-waba-${label}-${suffix}`;
  const userId = `user-waba-${label}-${suffix}`;
  const doctorId = `doc-waba-${label}-${suffix}`;
  const email = `${label}.${suffix}@waba-test.example`.toLowerCase();
  const phone = uniquePhone();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', ?, ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `WABA Clinic ${label}`, phone, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, 'polyclinic', 'General Medicine', ?, ?)`
  ).run(userId, tenantId, email, hashPassword("Lumera@2026"), `User ${label}`, role, phone, `WABA Clinic ${label}`, now, now);
  if (role === "doctor") {
    db.prepare(
      `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
       VALUES (?, ?, ?, 'MBBS', ?, 'General Medicine', 8, 500, 'OPD-1', '["Mon"]', '09:00 AM - 01:00 PM', ?, ?, '', '', '', 1)`
    ).run(doctorId, userId, `Dr ${label}`, `REG-${suffix}`, phone, email);
  }
  return { tenantId, userId, doctorId, email, phone };
}

describe("WABA two-tier ownership", () => {
  let port = 0;
  let server: Server | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-waba-two-tier";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    bootWhatsAppOwnershipSchema();

    const app = express();
    app.use(express.json());
    app.use(attachUser);
    app.use("/api", practitionerLinkMiddleware);
    app.use("/api", createWhatsAppNumbersRouter());
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

  async function login(email: string): Promise<string> {
    const loginRes = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(loginRes.status, 200, String(loginRes.json.error || `login failed for ${email}`));
    return String(loginRes.json.token || "");
  }

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  it("migrates tenant WABA columns into whatsapp_numbers and keeps getTenantWabaNumber in sync", () => {
    const clinic = seedClinic("migrate");
    upsertWhatsAppNumber(platformAdminActor(), {
      ownerType: "tenant",
      ownerId: clinic.tenantId,
      wabaId: `waba_mig_${clinic.tenantId.slice(-6)}`,
      phoneNumberId: `phone_mig_${clinic.tenantId.slice(-6)}`,
      metaWabaName: "Migrated clinic",
      metaAccessToken: "EAAJ...sandbox",
      status: "connected",
      connectedVia: "master_admin",
    });
    const derived = getTenantWabaNumber(clinic.tenantId);
    assert.ok(derived);
    const tenant = getDb()
      .prepare("SELECT waba_id, phone_number_id, meta_waba_name FROM tenants WHERE id = ?")
      .get(clinic.tenantId) as { waba_id: string; phone_number_id: string; meta_waba_name: string };
    assert.equal(tenant.waba_id, derived!.waba_id);
    assert.equal(tenant.phone_number_id, derived!.phone_number_id);
    const secret = getDb()
      .prepare("SELECT meta_access_token FROM whatsapp_number_secrets WHERE id = ?")
      .get(derived!.meta_token_ref) as { meta_access_token: string };
    assert.ok(secret.meta_access_token);
    const columns = getDb()
      .prepare("PRAGMA table_info(whatsapp_numbers)")
      .all() as Array<{ name: string }>;
    assert.equal(columns.some((col) => col.name === "meta_access_token"), false);
    assert.equal(columns.some((col) => col.name === "meta_token_ref"), true);
  });

  it("Master Admin can add a WABA for any tenant or practitioner", async () => {
    const clinic = seedClinic("admin-any");
    const doctorClinic = seedClinic("admin-doc", "doctor");
    const adminToken = await login("admin@lumera.me");

    const invite = await jsonRequest(
      port,
      "POST",
      "/api/users",
      {
        name: "Dr Cross Town",
        email: `cross.${Date.now()}@waba-test.example`,
        role: "doctor",
        phone: doctorClinic.phone,
        tenantId: doctorClinic.tenantId,
        password: "Lumera@2026",
      },
      auth(adminToken)
    );
    assert.equal(invite.status, 201, String(invite.json.error || "invite failed"));

    const tenantWaba = await jsonRequest(
      port,
      "POST",
      "/api/admin/whatsapp-numbers",
      {
        ownerType: "tenant",
        ownerId: clinic.tenantId,
        wabaId: `waba_admin_${clinic.tenantId.slice(-8)}`,
        phoneNumberId: `phone_admin_${clinic.tenantId.slice(-8)}`,
        metaWabaName: "Admin-entered clinic WABA",
        metaAccessToken: "EAAJ...admin",
      },
      auth(adminToken)
    );
    assert.equal(tenantWaba.status, 201, String(tenantWaba.json.error || "admin tenant waba failed"));

    const practitionerId = getDb()
      .prepare("SELECT practitioner_id FROM doctors WHERE user_id = ?")
      .get(doctorClinic.userId) as { practitioner_id?: string };
    const linked = getDb()
      .prepare("SELECT practitioner_id FROM doctors WHERE user_id = ?")
      .get((invite.json.user as { id?: string })?.id || doctorClinic.userId) as { practitioner_id?: string };
    const pracId = String(linked?.practitioner_id || practitionerId?.practitioner_id || "");
    assert.ok(pracId, "practitioner id should exist after doctor invite");

    const doctorWaba = await jsonRequest(
      port,
      "POST",
      "/api/admin/whatsapp-numbers",
      {
        ownerType: "doctor",
        ownerId: pracId,
        wabaId: `waba_prac_${pracId.slice(-8)}`,
        phoneNumberId: `phone_prac_${pracId.slice(-8)}`,
        metaWabaName: "Admin-entered doctor WABA",
        metaAccessToken: "EAAJ...admin",
      },
      auth(adminToken)
    );
    assert.equal(doctorWaba.status, 201, String(doctorWaba.json.error || "admin doctor waba failed"));

    const listed = await jsonRequest(port, "GET", "/api/admin/whatsapp-numbers", undefined, auth(adminToken));
    assert.equal(listed.status, 200);
    const practitioners = listed.json.practitionerNumbers as Array<{ practitionerId: string }>;
    assert.ok(practitioners.some((row) => row.practitionerId === pracId));
  });

  it("clinic admin cannot create a second tenant-owned number or touch another tenant", async () => {
    const a = seedClinic("clinic-a");
    const b = seedClinic("clinic-b");
    const tokenA = await login(a.email);
    const tokenB = await login(b.email);

    const first = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp-numbers/connect-clinic",
      {
        ownerType: "tenant",
        ownerId: a.tenantId,
        wabaId: `waba_a_${a.tenantId.slice(-8)}`,
        phoneNumberId: `phone_a_${a.tenantId.slice(-8)}`,
        metaWabaName: "Clinic A",
      },
      auth(tokenA)
    );
    assert.equal(first.status, 200, String(first.json.error || "clinic connect failed"));

    const count = getDb()
      .prepare("SELECT COUNT(*) AS c FROM whatsapp_numbers WHERE owner_type = 'tenant' AND owner_id = ?")
      .get(a.tenantId) as { c: number };
    assert.equal(count.c, 1);

    const other = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp-numbers/connect-clinic",
      {
        ownerType: "tenant",
        ownerId: b.tenantId,
        wabaId: `waba_steal_${b.tenantId.slice(-8)}`,
        phoneNumberId: `phone_steal_${b.tenantId.slice(-8)}`,
      },
      auth(tokenA)
    );
    assert.equal(other.status, 403);

    const adminCreate = await jsonRequest(
      port,
      "POST",
      "/api/admin/whatsapp-numbers",
      {
        ownerType: "tenant",
        ownerId: a.tenantId,
        wabaId: `waba_second_${a.tenantId.slice(-8)}`,
        phoneNumberId: `phone_second_${a.tenantId.slice(-8)}`,
      },
      auth(tokenA)
    );
    assert.equal(adminCreate.status, 403);

    const peekB = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp-numbers/connect-clinic",
      { ownerType: "tenant", ownerId: a.tenantId, wabaId: "waba_nope", phoneNumberId: "phone_nope" },
      auth(tokenB)
    );
    assert.equal(peekB.status, 403);

    const stillOne = getDb()
      .prepare("SELECT COUNT(*) AS c FROM whatsapp_numbers WHERE owner_type = 'tenant' AND owner_id = ?")
      .get(a.tenantId) as { c: number };
    assert.equal(stillOne.c, 1);
  });

  it("doctor can connect or skip a personal number and cannot touch another practitioner", async () => {
    const adminToken = await login("admin@lumera.me");
    const clinic = seedClinic("doc-home");
    const phone = uniquePhone();
    const invited = await jsonRequest(
      port,
      "POST",
      "/api/users",
      {
        name: "Dr Personal Waba",
        email: `personal.${Date.now()}@waba-test.example`,
        role: "doctor",
        phone,
        tenantId: clinic.tenantId,
        password: "Lumera@2026",
      },
      auth(adminToken)
    );
    assert.equal(invited.status, 201, String(invited.json.error || "doctor invite failed"));
    const invitedUser = invited.json.user as { id: string; email: string };
    const practitionerId = String(invited.json.practitionerId || "");
    assert.ok(practitionerId);

    const other = await jsonRequest(
      port,
      "POST",
      "/api/users",
      {
        name: "Dr Other Prac",
        email: `otherprac.${Date.now()}@waba-test.example`,
        role: "doctor",
        phone: uniquePhone(),
        tenantId: clinic.tenantId,
        password: "Lumera@2026",
      },
      auth(adminToken)
    );
    const otherPrac = String(other.json.practitionerId || "");
    assert.ok(otherPrac);
    assert.notEqual(otherPrac, practitionerId);

    const doctorToken = await login(invitedUser.email);
    const mineBefore = await jsonRequest(port, "GET", "/api/whatsapp-numbers/mine", undefined, auth(doctorToken));
    assert.equal(mineBefore.status, 200);
    assert.equal(mineBefore.json.doctorNumber, null);

    const skipLeavesNone = getDb()
      .prepare("SELECT COUNT(*) AS c FROM whatsapp_numbers WHERE owner_type = 'doctor' AND owner_id = ?")
      .get(practitionerId) as { c: number };
    assert.equal(skipLeavesNone.c, 0);

    const connect = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp-numbers/connect-doctor",
      {
        ownerType: "doctor",
        ownerId: practitionerId,
        wabaId: `waba_doc_${practitionerId.slice(-8)}`,
        phoneNumberId: `phone_doc_${practitionerId.slice(-8)}`,
        metaWabaName: "Personal SANDBOX WABA",
      },
      auth(doctorToken)
    );
    assert.equal(connect.status, 200, String(connect.json.error || "doctor connect failed"));

    const steal = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp-numbers/connect-doctor",
      {
        ownerType: "doctor",
        ownerId: otherPrac,
        wabaId: `waba_steal_${otherPrac.slice(-8)}`,
        phoneNumberId: `phone_steal_${otherPrac.slice(-8)}`,
      },
      auth(doctorToken)
    );
    assert.equal(steal.status, 403);

    const samePhoneSecondClinic = seedClinic("doc-second");
    const secondInvite = await jsonRequest(
      port,
      "POST",
      "/api/users",
      {
        name: "Dr Personal Waba",
        email: `personal.second.${Date.now()}@waba-test.example`,
        role: "doctor",
        phone,
        tenantId: samePhoneSecondClinic.tenantId,
        password: "Lumera@2026",
      },
      auth(adminToken)
    );
    assert.equal(secondInvite.status, 201, String(secondInvite.json.error || "second clinic invite failed"));
    assert.equal(String(secondInvite.json.practitionerId || ""), practitionerId);
  });
});

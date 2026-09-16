import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { bootWhatsAppOwnershipSchema, createWhatsAppNumbersRouter, practitionerLinkMiddleware } from "./whatsapp-numbers-routes.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";

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
  const tenantId = `tenant-http-${label}-${suffix}`;
  const userId = `user-http-${label}-${suffix}`;
  const doctorId = `doc-http-${label}-${suffix}`;
  const email = `${label}.${suffix}@waba-http-test.example`.toLowerCase();
  const phone = uniquePhone();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', ?, ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `HTTP WABA Clinic ${label}`, phone, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, 'polyclinic', 'General Medicine', ?, ?)`
  ).run(userId, tenantId, email, hashPassword("Lumera@2026"), `User ${label}`, role, phone, `HTTP WABA Clinic ${label}`, now, now);
  if (role === "doctor") {
    db.prepare(
      `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
       VALUES (?, ?, ?, 'MBBS', ?, 'General Medicine', 8, 500, 'OPD-1', '["Mon"]', '09:00 AM - 01:00 PM', ?, ?, '', '', '', 1)`
    ).run(doctorId, userId, `Dr ${label}`, `REG-${suffix}`, phone, email);
  }
  return { tenantId, userId, doctorId, email, phone };
}

function tenantRowCount(tenantId: string): number {
  return (
    getDb()
      .prepare("SELECT COUNT(*) AS c FROM whatsapp_numbers WHERE owner_type = 'tenant' AND owner_id = ?")
      .get(tenantId) as { c: number }
  ).c;
}

describe("WhatsApp numbers HTTP permission boundaries", () => {
  let port = 0;
  let server: Server | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-waba-http";
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

  it("rejects unauthenticated POST/PATCH admin and clinic/doctor connect over HTTP", async () => {
    const payload = {
      ownerType: "tenant",
      ownerId: "tenant-nobody",
      wabaId: "waba_unauth",
      phoneNumberId: "phone_unauth",
    };
    for (const [method, path] of [
      ["POST", "/api/admin/whatsapp-numbers"],
      ["PATCH", "/api/admin/whatsapp-numbers"],
      ["PATCH", "/api/admin/whatsapp-numbers/wan-missing"],
      ["POST", "/api/whatsapp-numbers/connect-clinic"],
      ["POST", "/api/whatsapp-numbers/connect-doctor"],
      ["POST", "/api/meta/waba-connect"],
    ] as const) {
      const res = await jsonRequest(port, method, path, payload);
      assert.equal(res.status, 401, `${method} ${path} should be 401, got ${res.status}`);
    }
  });

  it("platform admin can POST and PATCH any tenant or practitioner owner over HTTP", async () => {
    const clinic = seedClinic("admin-any");
    const adminToken = await login("admin@lumera.me");

    const created = await jsonRequest(
      port,
      "POST",
      "/api/admin/whatsapp-numbers",
      {
        ownerType: "tenant",
        ownerId: clinic.tenantId,
        wabaId: `waba_http_${clinic.tenantId.slice(-8)}`,
        phoneNumberId: `phone_http_${clinic.tenantId.slice(-8)}`,
        metaWabaName: "Admin HTTP clinic WABA",
        metaAccessToken: "EAAJ...admin-http",
      },
      auth(adminToken)
    );
    assert.equal(created.status, 201, String(created.json.error || "admin POST tenant failed"));
    const number = created.json.whatsappNumber as { id: string; ownerId: string; wabaId: string };
    assert.ok(number?.id);
    assert.equal(number.ownerId, clinic.tenantId);

    const patchedByPath = await jsonRequest(
      port,
      "PATCH",
      `/api/admin/whatsapp-numbers/${number.id}`,
      { metaWabaName: "Admin HTTP clinic WABA patched" },
      auth(adminToken)
    );
    assert.equal(patchedByPath.status, 200, String(patchedByPath.json.error || "admin PATCH :id failed"));
    assert.equal((patchedByPath.json.whatsappNumber as { metaWabaName?: string }).metaWabaName, "Admin HTTP clinic WABA patched");

    const patchedByBody = await jsonRequest(
      port,
      "PATCH",
      "/api/admin/whatsapp-numbers",
      { id: number.id, wabaId: `waba_http_patched_${clinic.tenantId.slice(-8)}` },
      auth(adminToken)
    );
    assert.equal(patchedByBody.status, 200, String(patchedByBody.json.error || "admin PATCH collection failed"));
    assert.match(String((patchedByBody.json.whatsappNumber as { wabaId?: string }).wabaId), /waba_http_patched_/);

    const invited = await jsonRequest(
      port,
      "POST",
      "/api/users",
      {
        name: "Dr HTTP Personal",
        email: `http.doc.${Date.now()}@waba-http-test.example`,
        role: "doctor",
        phone: uniquePhone(),
        tenantId: clinic.tenantId,
        password: "Lumera@2026",
      },
      auth(adminToken)
    );
    assert.equal(invited.status, 201, String(invited.json.error || "doctor invite failed"));
    const practitionerId = String(invited.json.practitionerId || "");
    assert.ok(practitionerId);

    const doctorWaba = await jsonRequest(
      port,
      "POST",
      "/api/admin/whatsapp-numbers",
      {
        ownerType: "doctor",
        ownerId: practitionerId,
        wabaId: `waba_http_doc_${practitionerId.slice(-8)}`,
        phoneNumberId: `phone_http_doc_${practitionerId.slice(-8)}`,
        metaWabaName: "Admin HTTP doctor WABA",
        metaAccessToken: "EAAJ...admin-http-doc",
      },
      auth(adminToken)
    );
    assert.equal(doctorWaba.status, 201, String(doctorWaba.json.error || "admin POST doctor failed"));

    const doctorNumber = doctorWaba.json.whatsappNumber as { id: string };
    const doctorPatch = await jsonRequest(
      port,
      "PATCH",
      "/api/admin/whatsapp-numbers",
      {
        ownerType: "doctor",
        ownerId: practitionerId,
        metaWabaName: "Admin HTTP doctor WABA patched",
      },
      auth(adminToken)
    );
    assert.equal(doctorPatch.status, 200, String(doctorPatch.json.error || "admin PATCH doctor owner failed"));
    assert.equal((doctorPatch.json.whatsappNumber as { id?: string }).id, doctorNumber.id);
  });

  it("clinic admin 403/409 on cross-owner writes and a second tenant-owned row over HTTP", async () => {
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
        metaWabaName: "Clinic A HTTP",
      },
      auth(tokenA)
    );
    assert.equal(first.status, 200, String(first.json.error || "clinic connect failed"));
    assert.equal(tenantRowCount(a.tenantId), 1);
    const firstId = String((first.json.whatsappNumber as { id?: string })?.id || "");
    assert.ok(firstId);

    const secondRow = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp-numbers/connect-clinic",
      {
        id: `wan-second-${a.tenantId}`,
        ownerType: "tenant",
        ownerId: a.tenantId,
        wabaId: `waba_a2_${a.tenantId.slice(-8)}`,
        phoneNumberId: `phone_a2_${a.tenantId.slice(-8)}`,
      },
      auth(tokenA)
    );
    assert.ok([400, 403, 409].includes(secondRow.status), `second tenant row should be rejected, got ${secondRow.status}`);
    assert.equal(tenantRowCount(a.tenantId), 1);

    const otherOwner = await jsonRequest(
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
    assert.equal(otherOwner.status, 403);

    const adminAsClinic = await jsonRequest(
      port,
      "POST",
      "/api/admin/whatsapp-numbers",
      {
        ownerType: "tenant",
        ownerId: a.tenantId,
        wabaId: `waba_adminish_${a.tenantId.slice(-8)}`,
        phoneNumberId: `phone_adminish_${a.tenantId.slice(-8)}`,
      },
      auth(tokenA)
    );
    assert.equal(adminAsClinic.status, 403);

    const patchOther = await jsonRequest(
      port,
      "PATCH",
      `/api/admin/whatsapp-numbers/${firstId}`,
      { metaWabaName: "stolen" },
      auth(tokenB)
    );
    assert.equal(patchOther.status, 403);

    const clinicBWritesA = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp-numbers/connect-clinic",
      {
        ownerType: "tenant",
        ownerId: a.tenantId,
        wabaId: "waba_nope",
        phoneNumberId: "phone_nope",
      },
      auth(tokenB)
    );
    assert.equal(clinicBWritesA.status, 403);
    assert.equal(tenantRowCount(a.tenantId), 1);
    assert.equal(tenantRowCount(b.tenantId), 0);
  });

  it("doctor can connect own practitioner_id and is 403 for another practitioner over HTTP", async () => {
    const adminToken = await login("admin@lumera.me");
    const clinic = seedClinic("doc-home");

    const invited = await jsonRequest(
      port,
      "POST",
      "/api/users",
      {
        name: "Dr HTTP Connect",
        email: `http.connect.${Date.now()}@waba-http-test.example`,
        role: "doctor",
        phone: uniquePhone(),
        tenantId: clinic.tenantId,
        password: "Lumera@2026",
      },
      auth(adminToken)
    );
    assert.equal(invited.status, 201, String(invited.json.error || "doctor invite failed"));
    const invitedUser = invited.json.user as { email: string };
    const practitionerId = String(invited.json.practitionerId || "");
    assert.ok(practitionerId);

    const other = await jsonRequest(
      port,
      "POST",
      "/api/users",
      {
        name: "Dr HTTP Other",
        email: `http.other.${Date.now()}@waba-http-test.example`,
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

    const clinicToken = await login(clinic.email);
    const clinicAsDoctor = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp-numbers/connect-doctor",
      {
        ownerType: "doctor",
        ownerId: practitionerId,
        wabaId: "waba_clinic_nope",
        phoneNumberId: "phone_clinic_nope",
      },
      auth(clinicToken)
    );
    assert.equal(clinicAsDoctor.status, 403);
  });
});

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { setEmbeddedSignupFetchImpl } from "./embedded-signup.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { bootWhatsAppOwnershipSchema, createWhatsAppNumbersRouter } from "./whatsapp-numbers-routes.ts";

const APP_ID = "111111111111111";
const APP_SECRET = "embedded-signup-http-test-secret";
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const WABA_ID = `waba-claimed-${RUN}`;
const PHONE_ID = `phone-claimed-${RUN}`;
const OTHER_PHONE = `phone-other-${RUN}`;

function mockGraph(opts: { grantPhone: boolean }): typeof fetch {
  const impl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "EAA-test-business-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("debug_token")) {
      return new Response(
        JSON.stringify({
          data: {
            app_id: APP_ID,
            is_valid: true,
            granular_scopes: [{ scope: "whatsapp_business_management", target_ids: [WABA_ID] }],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes(`/${WABA_ID}/phone_numbers`)) {
      return new Response(
        JSON.stringify({
          data: [{ id: opts.grantPhone ? PHONE_ID : OTHER_PHONE, display_phone_number: "+91 90000 00000" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes(`/${WABA_ID}?`) || url.endsWith(`/${WABA_ID}`)) {
      return new Response(JSON.stringify({ id: WABA_ID, name: "HTTP Test WABA" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/subscribed_apps")) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: { message: `unexpected ${url}` } }), { status: 500 });
  };
  return impl;
}

function seedDoctor() {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-es-${suffix}`;
  const userId = `user-es-${suffix}`;
  const email = `es.${suffix}@waba-http.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `ES Clinic ${suffix}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(userId, tenantId, email, hashPassword("Lumera@2026"), `Dr ES ${suffix}`, `+91 90000 ${suffix.slice(0, 5)}`, `ES Clinic`, now, now);
  return { tenantId, userId, email };
}

describe("HTTP Embedded Signup complete", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  let clinic: { tenantId: string; email: string };

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret";
    process.env.FACEBOOK_APP_ID = APP_ID;
    process.env.FACEBOOK_APP_SECRET = APP_SECRET;
    process.env.NODE_ENV = "test";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    bootWhatsAppOwnershipSchema();
    clinic = seedDoctor();
    const server = await startTestServer((app) => {
      app.use("/api", createWhatsAppNumbersRouter());
      app.use("/api", createApiRouter());
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    setEmbeddedSignupFetchImpl(undefined);
    await close?.();
  });

  async function login() {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email: clinic.email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || "login failed"));
    return String(res.json.token || "");
  }

  it("valid code/waba/phone returns 200 and a connected whatsapp_numbers row", async () => {
    setEmbeddedSignupFetchImpl(mockGraph({ grantPhone: true }));
    const token = await login();
    const res = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp-numbers/embedded-signup/complete",
      { code: "ES-CODE-OK", wabaId: WABA_ID, phoneNumberId: PHONE_ID },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(res.status, 200, String(res.json.error || JSON.stringify(res.json)));
    const row = getDb()
      .prepare("SELECT owner_type, owner_id, waba_id, phone_number_id, status FROM whatsapp_numbers WHERE owner_id = ?")
      .get(clinic.tenantId) as { owner_type: string; waba_id: string; phone_number_id: string; status: string };
    assert.equal(row.owner_type, "tenant");
    assert.equal(row.waba_id, WABA_ID);
    assert.equal(row.phone_number_id, PHONE_ID);
    assert.equal(row.status, "connected");
  });

  it("token that does not grant the claimed phone is rejected", async () => {
    setEmbeddedSignupFetchImpl(mockGraph({ grantPhone: false }));
    const token = await login();
    const before = getDb().prepare("SELECT COUNT(*) AS c FROM whatsapp_numbers WHERE phone_number_id = ?").get(OTHER_PHONE) as {
      c: number;
    };
    const res = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp-numbers/embedded-signup/complete",
      { code: "ES-CODE-BAD", wabaId: WABA_ID, phoneNumberId: PHONE_ID },
      { Authorization: `Bearer ${token}` }
    );
    assert.notEqual(res.status, 200);
    assert.ok(res.status >= 400);
    const after = getDb().prepare("SELECT COUNT(*) AS c FROM whatsapp_numbers WHERE phone_number_id = ?").get(OTHER_PHONE) as {
      c: number;
    };
    assert.equal(after.c, before.c);
  });

  it("unauthenticated complete is rejected", async () => {
    setEmbeddedSignupFetchImpl(mockGraph({ grantPhone: true }));
    const res = await jsonRequest(port, "POST", "/api/whatsapp-numbers/embedded-signup/complete", {
      code: "ES-CODE-ANON",
      wabaId: WABA_ID,
      phoneNumberId: PHONE_ID,
    });
    assert.equal(res.status, 401);
  });
});

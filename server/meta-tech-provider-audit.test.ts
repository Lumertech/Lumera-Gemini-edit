import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { getDb, initDatabase } from "./db.ts";
import {
  CLINIC_WHATSAPP_NOT_CONNECTED,
  dispatchWhatsAppCloudMessage,
  sendAppointmentReminder,
} from "./graph-whatsapp.ts";
import {
  ensureWhatsAppOwnershipSchema,
  getWhatsAppNumberSecret,
  getWhatsAppRegistrationPin,
  migrateWhatsAppSecretEncryption,
  platformAdminActor,
  upsertWhatsAppNumber,
} from "./whatsapp-numbers.ts";
import { decryptWaSecret, WA_SECRET_PREFIX } from "./wa-token-crypto.ts";

const ENV_TOKEN = "EAAPlatformEnvTokenWithoutEllipsis0123456789abcdef";
const ENV_PHONE = "1111222233334444";
const TENANT_TOKEN = "EAAClinicTenantTokenWithoutEllipsis0123456789abcd";
const TENANT_PHONE = "5555666677778888";

function insertTenant(id: string, name: string) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
       VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
    )
    .run(id, name, now, now, now);
}

function connectTenantNumber(tenantId: string, phoneNumberId = TENANT_PHONE, token = TENANT_TOKEN) {
  upsertWhatsAppNumber(platformAdminActor(), {
    ownerType: "tenant",
    ownerId: tenantId,
    wabaId: `2048${phoneNumberId.slice(0, 10)}`,
    phoneNumberId,
    metaAccessToken: token,
    metaWabaName: tenantId,
    status: "connected",
  });
}

describe("Meta Tech Provider audit", () => {
  const prev = {
    NODE_ENV: process.env.NODE_ENV,
    META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
    META_PHONE_NUMBER_ID: process.env.META_PHONE_NUMBER_ID,
    WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
    META_OTP_TEMPLATE_NAME: process.env.META_OTP_TEMPLATE_NAME,
    META_REMINDER_TEMPLATE_NAME: process.env.META_REMINDER_TEMPLATE_NAME,
    WA_TOKEN_KEY: process.env.WA_TOKEN_KEY,
  };

  before(() => {
    process.env.NODE_ENV = "test";
    try {
      getDb();
    } catch {
      initDatabase();
    }
  });

  after(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("uses the tenant WhatsApp number even when platform env credentials are set", async () => {
    process.env.META_ACCESS_TOKEN = ENV_TOKEN;
    process.env.META_PHONE_NUMBER_ID = ENV_PHONE;
    const tenantId = `tenant-audit-creds-${crypto.randomUUID().slice(0, 8)}`;
    insertTenant(tenantId, "Sunrise Ortho");
    connectTenantNumber(tenantId);
    const seen: Array<{ url: string; auth: string }> = [];
    const sent = await dispatchWhatsAppCloudMessage({
      to: "+919812340001",
      kind: "text",
      textBody: "Hello from Sunrise Ortho",
      db: getDb(),
      tenantId,
      fetchImpl: async (input, init) => {
        seen.push({
          url: String(input),
          auth: String((init?.headers as Record<string, string> | undefined)?.Authorization || ""),
        });
        return new Response(JSON.stringify({ messages: [{ id: "wamid.TENANT_CREDS" }] }), { status: 200 });
      },
    });
    assert.equal(sent.ok, true);
    if (sent.ok) assert.equal(sent.channel, "graph");
    assert.match(seen[0].url, new RegExp(`/${TENANT_PHONE}/messages`));
    assert.equal(seen[0].url.includes(ENV_PHONE), false);
    assert.match(seen[0].auth, new RegExp(`Bearer ${TENANT_TOKEN}`));
    assert.equal(seen[0].auth.includes(ENV_TOKEN), false);
  });

  it("returns 503 Clinic WhatsApp not connected in production when the clinic has no number row", async () => {
    process.env.NODE_ENV = "production";
    process.env.META_ACCESS_TOKEN = ENV_TOKEN;
    process.env.META_PHONE_NUMBER_ID = ENV_PHONE;
    const tenantId = `tenant-audit-none-${crypto.randomUUID().slice(0, 8)}`;
    insertTenant(tenantId, "Unconnected Clinic");
    try {
      const sent = await dispatchWhatsAppCloudMessage({
        to: "+919812340002",
        kind: "text",
        textBody: "should not send",
        db: getDb(),
        tenantId,
        fetchImpl: async () => {
          throw new Error("Graph must not be called");
        },
      });
      assert.equal(sent.ok, false);
      if (!sent.ok) {
        assert.equal(sent.channel, "none");
        assert.equal(sent.error, CLINIC_WHATSAPP_NOT_CONNECTED);
        assert.equal(sent.status, 503);
      }
    } finally {
      process.env.NODE_ENV = "test";
    }
  });

  it("platform login OTP still uses env credentials", async () => {
    process.env.META_ACCESS_TOKEN = ENV_TOKEN;
    process.env.META_PHONE_NUMBER_ID = ENV_PHONE;
    delete process.env.META_OTP_TEMPLATE_NAME;
    const seen: string[] = [];
    const sent = await dispatchWhatsAppCloudMessage({
      to: "+919812340003",
      kind: "otp",
      otp: "192837",
      purpose: "login",
      textBody: "unused",
      db: getDb(),
      fetchImpl: async (input, init) => {
        seen.push(String(input));
        const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization || "");
        assert.match(auth, new RegExp(`Bearer ${ENV_TOKEN}`));
        const body = JSON.parse(String(init?.body || "{}")) as { text?: { body?: string } };
        assert.equal(String(body.text?.body || "").includes("Lumera"), false);
        return new Response(JSON.stringify({ messages: [{ id: "wamid.PLATFORM_OTP" }] }), { status: 200 });
      },
    });
    assert.equal(sent.ok, true);
    if (sent.ok) assert.equal(sent.channel, "graph");
    assert.match(seen[0], new RegExp(`/${ENV_PHONE}/messages`));
  });

  it("lapsed clinic templates are 403 and manual text is allowed only inside the 24h window", async () => {
    const tenantId = `tenant-audit-lapse-${crypto.randomUUID().slice(0, 8)}`;
    insertTenant(tenantId, "Lapsed Clinic");
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, billing_source, started_at, ends_at, monthly_price, notes, created_at, updated_at)
         VALUES (?, ?, 'clinic', 'past_due', 'manual', ?, NULL, 0, '', ?, ?)`
      )
      .run(`sub-${tenantId}`, tenantId, now, now, now);

    const template = await dispatchWhatsAppCloudMessage({
      to: "+919812340004",
      kind: "appointment_reminder",
      textBody: "automated reminder",
      db: getDb(),
      tenantId,
    });
    assert.equal(template.ok, false);
    if (!template.ok) assert.equal(template.status, 403);

    const outside = await dispatchWhatsAppCloudMessage({
      to: "+919812340005",
      kind: "text",
      textBody: "manual outside window",
      db: getDb(),
      tenantId,
      isManual: true,
    });
    assert.equal(outside.ok, false);
    if (!outside.ok) assert.equal(outside.status, 403);

    const inboundAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    getDb()
      .prepare(
        `INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, content, time_display, status, created_at)
         VALUES (?, 'conv-audit', '+91 98123 40006', 'patient', 'hello', '1:00 PM', 'delivered', ?)`
      )
      .run(`msg-${tenantId}`, inboundAt);
    const inside = await dispatchWhatsAppCloudMessage({
      to: "+919812340006",
      kind: "text",
      textBody: "manual inside window",
      db: getDb(),
      tenantId,
      isManual: true,
    });
    assert.equal(inside.ok, true);

    const staleAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    getDb()
      .prepare(
        `INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, content, time_display, status, created_at)
         VALUES (?, 'conv-audit-stale', '+91 98123 40007', 'patient', 'old', '1:00 PM', 'delivered', ?)`
      )
      .run(`msg-stale-${tenantId}`, staleAt);
    const stale = await dispatchWhatsAppCloudMessage({
      to: "+919812340007",
      kind: "text",
      textBody: "manual after 24h",
      db: getDb(),
      tenantId,
      isManual: true,
    });
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.status, 403);
  });

  it("tenant reminder payloads use clinic and doctor names and do not include Lumera", async () => {
    process.env.META_ACCESS_TOKEN = ENV_TOKEN;
    process.env.META_PHONE_NUMBER_ID = ENV_PHONE;
    process.env.META_REMINDER_TEMPLATE_NAME = "lumera_appointment_reminder";
    const tenantId = `tenant-audit-copy-${crypto.randomUUID().slice(0, 8)}`;
    const phoneNumberId = `9${String(Date.now()).slice(-14)}`;
    insertTenant(tenantId, "Sunrise Ortho");
    connectTenantNumber(tenantId, phoneNumberId, TENANT_TOKEN);
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO meta_templates (id, tenant_id, waba_id, name, category, language, status, components, created_at, updated_at)
         VALUES (?, ?, '204800000000000', 'sunrise_visit_reminder', 'UTILITY', 'en', 'APPROVED', '[]', ?, ?)`
      )
      .run(`tpl-${tenantId}`, tenantId, now, now);

    let payload = "";
    const sent = await sendAppointmentReminder({
      to: "+919812340008",
      patientName: "Asha",
      doctorName: "Dr Mehta",
      clinicName: "Sunrise Ortho",
      date: "2026-10-20",
      timeSlot: "09:30 AM",
      templateParameters: ["Asha", "Sunrise Ortho", "Dr Mehta", "2026-10-20", "09:30 AM"],
      db: getDb(),
      tenantId,
      fetchImpl: async (_input, init) => {
        payload = String(init?.body || "");
        return new Response(JSON.stringify({ messages: [{ id: "wamid.NO_LUMERA" }] }), { status: 200 });
      },
    });
    assert.equal(sent.ok, true);
    assert.equal(/lumera/i.test(payload), false);
    assert.match(payload, /sunrise_visit_reminder/);
    assert.match(payload, /Sunrise Ortho/);
    assert.match(payload, /Dr Mehta/);
    assert.equal(payload.includes("lumera_appointment_reminder"), false);
  });

  it("round-trips WhatsApp tokens with AES-256-GCM and nulls tenants.meta_access_token", () => {
    const key = crypto.randomBytes(32).toString("base64");
    process.env.WA_TOKEN_KEY = key;
    process.env.NODE_ENV = "test";
    const file = path.join(os.tmpdir(), `wa-token-${crypto.randomUUID()}.sqlite`);
    const db = new DatabaseSync(file);
    const plain = "EAARoundTripTokenWithoutEllipsis0123456789abcdef";
    try {
      db.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, meta_access_token TEXT)`);
      db.prepare("INSERT INTO tenants (id, meta_access_token) VALUES ('t1', ?)").run(plain);
      ensureWhatsAppOwnershipSchema(db);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO whatsapp_numbers
          (id, owner_type, owner_id, waba_id, phone_number_id, meta_waba_name, status, connected_via, meta_token_ref, meta_token_expires_at, created_at, updated_at)
         VALUES ('wan-1', 'tenant', 't1', '204800000000001', '9999888877776666', 'Clinic', 'connected', 'embedded_signup', 'wsec-1', '', ?, ?)`
      ).run(now, now);
      db.prepare(
        `INSERT INTO whatsapp_number_secrets (id, whatsapp_number_id, meta_access_token, registration_pin, created_at, updated_at)
         VALUES ('wsec-1', 'wan-1', ?, '123456', ?, ?)`
      ).run(plain, now, now);

      migrateWhatsAppSecretEncryption(db);
      const stored = db.prepare("SELECT meta_access_token, registration_pin FROM whatsapp_number_secrets WHERE id = 'wsec-1'").get() as {
        meta_access_token: string;
        registration_pin: string;
      };
      assert.ok(stored.meta_access_token.startsWith(WA_SECRET_PREFIX));
      assert.ok(stored.registration_pin.startsWith(WA_SECRET_PREFIX));
      assert.notEqual(stored.meta_access_token, plain);
      assert.equal(decryptWaSecret(stored.meta_access_token), plain);
      assert.equal(getWhatsAppNumberSecret("wsec-1", db), plain);
      assert.equal(getWhatsAppRegistrationPin("wsec-1", db), "123456");
      const tenant = db.prepare("SELECT meta_access_token FROM tenants WHERE id = 't1'").get() as {
        meta_access_token: string | null;
      };
      assert.equal(tenant.meta_access_token, null);

      delete process.env.WA_TOKEN_KEY;
      process.env.NODE_ENV = "production";
      assert.throws(() => migrateWhatsAppSecretEncryption(db), /WA_TOKEN_KEY is required in production/);

      const empty = new DatabaseSync(":memory:");
      empty.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, meta_access_token TEXT)`);
      ensureWhatsAppOwnershipSchema(empty);
      assert.doesNotThrow(() => migrateWhatsAppSecretEncryption(empty));
      empty.close();
    } finally {
      db.close();
      fs.rmSync(file, { force: true });
      process.env.NODE_ENV = "test";
      if (prev.WA_TOKEN_KEY === undefined) delete process.env.WA_TOKEN_KEY;
      else process.env.WA_TOKEN_KEY = prev.WA_TOKEN_KEY;
    }
  });
});

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
  READ_ONLY_WHATSAPP_SEND_ERROR,
  WA_TOKEN_KEY_UNSET_ERROR,
  WHATSAPP_WINDOW_CLOSED_ERROR,
  dispatchWhatsAppCloudMessage,
  sendAppointmentReminder,
} from "./graph-whatsapp.ts";
import { clinicOutboundCopy, resolveClinicFacingNames } from "./whatsapp.ts";
import { WHATSAPP_QUARANTINE_TENANT_ID } from "./whatsapp-tenant-backfill.ts";
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

function uniquePhoneNumberId(): string {
  return `7${Date.now()}${Math.floor(Math.random() * 1000)}`.replace(/\D/g, "").slice(0, 15);
}

function insertTenant(id: string, name: string) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
       VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
    )
    .run(id, name, now, now, now);
}

function stampLastInbound(tenantId: string | null, phone: string, ageMs: number) {
  const at = new Date(Date.now() - ageMs).toISOString();
  // tenant_id is NOT NULL. Unresolved rows live on the quarantine clinic and must not open another clinic's window.
  const storedTenant = String(tenantId || "").trim() || WHATSAPP_QUARANTINE_TENANT_ID;
  getDb()
    .prepare(
      `INSERT INTO whatsapp_conversations (
         id, patient_phone, patient_name, handover_mode, assigned_staff, tags, preferred_language,
         unread_count, last_message, last_message_time, updated_at, tenant_id, last_inbound_at
       ) VALUES (?, ?, 'Patient', 'human', 'Staff', '[]', 'en', 0, 'hello', '1:00 PM', ?, ?, ?)`
    )
    .run(`conv-${crypto.randomUUID()}`, phone, at, storedTenant, at);
}

function connectTenantNumber(tenantId: string, phoneNumberId = uniquePhoneNumberId(), token = TENANT_TOKEN) {
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
    if (!process.env.WA_TOKEN_KEY) process.env.WA_TOKEN_KEY = crypto.randomBytes(32).toString("base64");
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
    const phoneNumberId = uniquePhoneNumberId();
    insertTenant(tenantId, "Sunrise Ortho");
    connectTenantNumber(tenantId, phoneNumberId);
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
    assert.match(seen[0].url, new RegExp(`/${phoneNumberId}/messages`));
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

    const hour = 60 * 60 * 1000;
    const phoneTail = String(Date.now()).slice(-7);
    const phoneFor = (digit: string) => `+91 981${digit}${phoneTail}`;
    const toFor = (digit: string) => phoneFor(digit).replace(/\D/g, "");
    stampLastInbound(tenantId, phoneFor("1"), hour);
    const inside = await dispatchWhatsAppCloudMessage({
      to: toFor("1"),
      kind: "text",
      textBody: "manual inside window",
      db: getDb(),
      tenantId,
      isManual: true,
    });
    assert.equal(inside.ok, true);

    stampLastInbound(tenantId, phoneFor("2"), 23 * hour);
    const at23h = await dispatchWhatsAppCloudMessage({
      to: toFor("2"),
      kind: "text",
      textBody: "manual reply at 23h",
      db: getDb(),
      tenantId,
      isManual: true,
    });
    assert.equal(at23h.ok, true);

    stampLastInbound(tenantId, phoneFor("3"), 25 * hour);
    const at25h = await dispatchWhatsAppCloudMessage({
      to: toFor("3"),
      kind: "text",
      textBody: "manual reply at 25h",
      db: getDb(),
      tenantId,
      isManual: true,
    });
    assert.equal(at25h.ok, false);
    if (!at25h.ok) {
      assert.equal(at25h.status, 403);
      assert.equal(at25h.error, WHATSAPP_WINDOW_CLOSED_ERROR);
    }

    const automated = await dispatchWhatsAppCloudMessage({
      to: toFor("2"),
      kind: "text",
      textBody: "bot reply inside the window",
      db: getDb(),
      tenantId,
    });
    assert.equal(automated.ok, false);
    if (!automated.ok) {
      assert.equal(automated.status, 403);
      assert.equal(automated.error, READ_ONLY_WHATSAPP_SEND_ERROR);
    }

    const templateInside = await dispatchWhatsAppCloudMessage({
      to: toFor("2"),
      kind: "appointment_reminder",
      textBody: "template inside the window",
      db: getDb(),
      tenantId,
      isManual: true,
    });
    assert.equal(templateInside.ok, false);
    if (!templateInside.ok) {
      assert.equal(templateInside.status, 403);
      assert.equal(templateInside.error, READ_ONLY_WHATSAPP_SEND_ERROR);
    }

    stampLastInbound(null, phoneFor("4"), hour);
    const nullTenant = await dispatchWhatsAppCloudMessage({
      to: toFor("4"),
      kind: "text",
      textBody: "must not match a null-tenant inbound",
      db: getDb(),
      tenantId,
      isManual: true,
    });
    assert.equal(nullTenant.ok, false);
    if (!nullTenant.ok) assert.equal(nullTenant.status, 403);

    const otherTenant = `tenant-audit-other-${crypto.randomUUID().slice(0, 8)}`;
    insertTenant(otherTenant, "Other Clinic");
    stampLastInbound(otherTenant, phoneFor("5"), hour);
    const other = await dispatchWhatsAppCloudMessage({
      to: toFor("5"),
      kind: "text",
      textBody: "must not match another tenant inbound",
      db: getDb(),
      tenantId,
      isManual: true,
    });
    assert.equal(other.ok, false);
    if (!other.ok) assert.equal(other.status, 403);

    const sendRoute = fs
      .readFileSync(new URL("./whatsapp.ts", import.meta.url), "utf8")
      .split('router.post("/emr-action"')[0]
      .split('router.post("/send"')
      .pop();
    assert.match(String(sendRoute), /sender === ["']agent["']/);
    assert.match(String(sendRoute), /dispatchPatientCloudText\([\s\S]*isManual:\s*true/);
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
         VALUES (?, ?, '204800000000000', 'clinic_appointment_reminder', 'UTILITY', 'en', 'APPROVED', '[]', ?, ?)`
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
    assert.match(payload, /clinic_appointment_reminder/);
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
      const errors: string[] = [];
      const origError = console.error;
      console.error = (...args: unknown[]) => {
        errors.push(args.map((part) => String(part)).join(" "));
      };
      try {
        assert.doesNotThrow(() => migrateWhatsAppSecretEncryption(db));
      } finally {
        console.error = origError;
      }
      assert.match(errors.join("\n"), /WA_TOKEN_KEY is unset/);
      const stillSealed = db
        .prepare("SELECT meta_access_token FROM whatsapp_number_secrets WHERE id = 'wsec-1'")
        .get() as { meta_access_token: string };
      assert.ok(stillSealed.meta_access_token.startsWith(WA_SECRET_PREFIX));

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

  it("clinic outbound text uses the tenant display name and doctor name and does not include Lumera", () => {
    const src = fs.readFileSync(new URL("./whatsapp.ts", import.meta.url), "utf8");
    assert.equal(/lumera/i.test(src), false);
    const tenantId = `tenant-audit-facing-${crypto.randomUUID().slice(0, 8)}`;
    const userId = `user-${tenantId}`;
    const now = new Date().toISOString();
    insertTenant(tenantId, "Cedar Spine Clinic");
    getDb()
      .prepare(
        `INSERT INTO users (id, email, password_hash, name, role, status, phone, created_at, tenant_id)
         VALUES (?, ?, 'x', 'Dr Mehta', 'DOCTOR', 'active', '', ?, ?)`
      )
      .run(userId, `${userId}@cedar.test`, now, tenantId);
    getDb()
      .prepare(
        `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
         VALUES (?, ?, 'Dr Mehta', 'MBBS', 'REG-CEDAR', 'General Medicine', 8, 500, 'OPD-1', '[]', '09:00-13:00', '', ?, '', '', '', 1)`
      )
      .run(`doc-${tenantId}`, userId, `${userId}@cedar.test`);
    const names = resolveClinicFacingNames(getDb(), tenantId);
    assert.equal(names.clinicName, "Cedar Spine Clinic");
    assert.equal(names.doctorName, "Dr Mehta");
    const copy = clinicOutboundCopy({
      ...names,
      patientName: "Asha",
      patientText: "hello",
      docOptions: "• Dr Mehta (General Medicine)",
      roster: "Dr Mehta",
    });
    const blob = Object.values(copy).join("\n");
    assert.equal(/lumera/i.test(blob), false);
    assert.match(blob, /Cedar Spine Clinic/);
    assert.match(blob, /Dr Mehta/);
  });

  it("skips token encryption on boot when WA_TOKEN_KEY is unset and clinic sends return 503", async () => {
    const savedEnv = process.env.NODE_ENV;
    const savedKey = process.env.WA_TOKEN_KEY;
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map((part) => String(part)).join(" "));
    };
    const file = path.join(os.tmpdir(), `wa-token-skip-${crypto.randomUUID()}.sqlite`);
    const isolated = new DatabaseSync(file);
    try {
      delete process.env.WA_TOKEN_KEY;
      process.env.NODE_ENV = "production";
      isolated.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, meta_access_token TEXT)`);
      isolated.prepare("INSERT INTO tenants (id, meta_access_token) VALUES ('t1', 'plain-tenant-token')").run();
      ensureWhatsAppOwnershipSchema(isolated);
      const now = new Date().toISOString();
      isolated
        .prepare(
          `INSERT INTO whatsapp_numbers
            (id, owner_type, owner_id, waba_id, phone_number_id, meta_waba_name, status, connected_via, meta_token_ref, meta_token_expires_at, created_at, updated_at)
           VALUES ('wan-skip', 'tenant', 't1', '204800000000009', '5555444433332222', 'Clinic', 'connected', 'embedded_signup', 'wsec-skip', '', ?, ?)`
        )
        .run(now, now);
      isolated
        .prepare(
          `INSERT INTO whatsapp_number_secrets (id, whatsapp_number_id, meta_access_token, registration_pin, created_at, updated_at)
           VALUES ('wsec-skip', 'wan-skip', 'plain-secret-token', '654321', ?, ?)`
        )
        .run(now, now);
      assert.doesNotThrow(() => migrateWhatsAppSecretEncryption(isolated));
      const stored = isolated
        .prepare("SELECT meta_access_token, registration_pin FROM whatsapp_number_secrets WHERE id = 'wsec-skip'")
        .get() as { meta_access_token: string; registration_pin: string };
      assert.equal(stored.meta_access_token, "plain-secret-token");
      assert.equal(stored.registration_pin, "654321");
      assert.match(errors.join("\n"), /WA_TOKEN_KEY is unset/);

      process.env.NODE_ENV = "test";
      const tenantId = `tenant-audit-nokey-${crypto.randomUUID().slice(0, 8)}`;
      insertTenant(tenantId, "No Key Clinic");
      connectTenantNumber(tenantId);
      process.env.NODE_ENV = "production";
      process.env.META_ACCESS_TOKEN = ENV_TOKEN;
      process.env.META_PHONE_NUMBER_ID = ENV_PHONE;
      assert.doesNotThrow(() => migrateWhatsAppSecretEncryption(getDb()));
      let graphCalled = false;
      const sent = await dispatchWhatsAppCloudMessage({
        to: "+919812340077",
        kind: "text",
        textBody: "must not send",
        db: getDb(),
        tenantId,
        fetchImpl: async () => {
          graphCalled = true;
          return new Response(JSON.stringify({ messages: [{ id: "wamid.SHOULD_NOT" }] }), { status: 200 });
        },
      });
      assert.equal(graphCalled, false);
      assert.equal(sent.ok, false);
      if (!sent.ok) {
        assert.equal(sent.status, 503);
        assert.equal(sent.error, WA_TOKEN_KEY_UNSET_ERROR);
      }

      const otp = await dispatchWhatsAppCloudMessage({
        to: "+919812340078",
        kind: "otp",
        otp: "445566",
        purpose: "login",
        textBody: "unused",
        db: getDb(),
        fetchImpl: async (_input, init) => {
          const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization || "");
          assert.match(auth, new RegExp(`Bearer ${ENV_TOKEN}`));
          return new Response(JSON.stringify({ messages: [{ id: "wamid.OTP_STILL" }] }), { status: 200 });
        },
      });
      assert.equal(otp.ok, true);
    } finally {
      console.error = origError;
      isolated.close();
      fs.rmSync(file, { force: true });
      process.env.NODE_ENV = savedEnv;
      if (savedKey === undefined) delete process.env.WA_TOKEN_KEY;
      else process.env.WA_TOKEN_KEY = savedKey;
    }
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createApiRouter } from "./api.ts";
import { signJwtToken } from "./auth.ts";
import { saveClinicScheduleSettings, listSlotOccupancy, scheduleSlotFreeStatusSql } from "./clinic-schedule.ts";
import { getDb, initDatabase } from "./db.ts";
import { INDIC_LANGUAGES, mountGeminiVoiceRoutes, runGeminiVoiceReceptionist } from "./gemini-voice.ts";
import { findNextBookableSlot } from "./whatsapp-calendar-booking.ts";
import { saveWhatsAppTenantVoiceSettings } from "./whatsapp-numbers-store.ts";
import { ensureTenantSlugColumn } from "./tenant-slug.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { resetVoiceGatewaySecretWarningForTests, voiceGatewayAuthorized } from "./voice-gateway-auth.ts";
import { vertexGeminiModel } from "./vertex-gemini.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function seedTenant(id: string, opts?: { slug?: string; phoneNumberId?: string; name?: string }) {
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, phone_number_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+919800000000', ?, 500, 0, 1, '', ?, ?, ?)`
  ).run(id, opts?.name || `Clinic ${id}`, now, opts?.phoneNumberId || "", now, now);
  if (opts?.slug) {
    ensureTenantSlugColumn(db);
    db.prepare("UPDATE tenants SET slug = ? WHERE id = ?").run(opts.slug, id);
  }
}

function seedUser(opts: { id: string; tenantId: string; role: string; email: string }) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
       VALUES (?, ?, ?, 'x', ?, ?, 'active', '+919811100000', 'Clinic', 1, 'polyclinic', 'General Medicine', ?, ?)`
    )
    .run(opts.id, opts.tenantId, opts.email, opts.role, opts.role, now, now);
  return signJwtToken({
    userId: opts.id,
    tenantId: opts.tenantId,
    email: opts.email,
    role: opts.role,
    name: opts.role,
  });
}

function insertSlot(opts: { id: string; tenantId: string; date: string; time: string; status: string; doctorName?: string }) {
  getDb()
    .prepare(
      `INSERT INTO appointments (id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name, specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at)
       VALUES (?, ?, 1, 'pat-x', 'Patient', '+919800000001', 'UH', '', ?, 'General', ?, ?, 'New Consultation', ?, 'WhatsApp Bot', 0, 0, ?)`
    )
    .run(
      opts.id,
      opts.tenantId,
      opts.doctorName || "Dr. Rao",
      opts.date,
      opts.time,
      opts.status,
      new Date().toISOString()
    );
}

describe("forward security and voice fixes", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  const envSnapshot = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
    VOICE_GATEWAY_SECRET: process.env.VOICE_GATEWAY_SECRET,
    META_APP_SECRET: process.env.META_APP_SECRET,
    META_WEBHOOK_ALLOW_UNSIGNED: process.env.META_WEBHOOK_ALLOW_UNSIGNED,
    META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
  };

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "forward-fixes-jwt-secret-not-for-prod";
    initDatabase();
    const server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
      mountGeminiVoiceRoutes(app, () => null);
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    restoreEnv(envSnapshot);
    await close?.();
  });

  it("rejects a bad webhook signature in production even when META_WEBHOOK_ALLOW_UNSIGNED is set", async () => {
    process.env.NODE_ENV = "production";
    process.env.META_APP_SECRET = "forward-app-secret";
    process.env.META_WEBHOOK_ALLOW_UNSIGNED = "true";
    try {
      const res = await jsonRequest(port, "POST", "/api/meta/webhook", { object: "whatsapp_business_account", entry: [] }, {
        "X-Hub-Signature-256": "sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });
      assert.equal(res.status, 403);
      assert.notEqual(res.status, 200);
    } finally {
      restoreEnv({
        NODE_ENV: envSnapshot.NODE_ENV,
        META_APP_SECRET: envSnapshot.META_APP_SECRET,
        META_WEBHOOK_ALLOW_UNSIGNED: envSnapshot.META_WEBHOOK_ALLOW_UNSIGNED,
      });
    }
  });

  it("keeps the non-production unsigned flag and the production missing-secret 500", async () => {
    process.env.NODE_ENV = "test";
    process.env.META_APP_SECRET = "forward-app-secret";
    process.env.META_WEBHOOK_ALLOW_UNSIGNED = "true";
    try {
      const dev = await jsonRequest(port, "POST", "/api/meta/webhook", { object: "whatsapp_business_account", entry: [] });
      assert.equal(dev.status, 200);
    } finally {
      process.env.NODE_ENV = "production";
      delete process.env.META_APP_SECRET;
      delete process.env.META_WEBHOOK_ALLOW_UNSIGNED;
    }
    try {
      const missing = await jsonRequest(port, "POST", "/api/meta/webhook", { object: "whatsapp_business_account", entry: [] });
      assert.equal(missing.status, 500);
      assert.equal(missing.json.error, "Webhook signature verification is unavailable.");
    } finally {
      restoreEnv({
        NODE_ENV: envSnapshot.NODE_ENV,
        META_APP_SECRET: envSnapshot.META_APP_SECRET,
        META_WEBHOOK_ALLOW_UNSIGNED: envSnapshot.META_WEBHOOK_ALLOW_UNSIGNED,
      });
    }
  });

  it("requires a platform super-admin for the webhook debug log and returns no token material", async () => {
    process.env.META_ACCESS_TOKEN = "EAAFORWARDSECRETTOKEN0123456789";
    const suffix = `${Date.now().toString(36)}`;
    const tenantId = `tenant-dbg-${suffix}`;
    seedTenant(tenantId);
    const admin = seedUser({ id: `user-dbg-admin-${suffix}`, tenantId, role: "super_admin", email: `dbg.admin.${suffix}@example.com` });
    const doctor = seedUser({ id: `user-dbg-doc-${suffix}`, tenantId, role: "doctor", email: `dbg.doc.${suffix}@example.com` });
    try {
      const anon = await jsonRequest(port, "GET", "/api/meta/webhook-debug-log");
      assert.equal(anon.status, 401);
      const denied = await jsonRequest(port, "GET", "/api/meta/webhook-debug-log", undefined, { Authorization: `Bearer ${doctor}` });
      assert.equal(denied.status, 403);
      const ok = await jsonRequest(port, "GET", "/api/meta/webhook-debug-log", undefined, { Authorization: `Bearer ${admin}` });
      assert.equal(ok.status, 200);
      const raw = JSON.stringify(ok.json);
      assert.equal(Object.prototype.hasOwnProperty.call(ok.json.callingConfig, "tokenPrefix"), false);
      assert.equal(raw.includes("EAAFORWARDSECRETTOKEN0123456789"), false);
      assert.equal(raw.includes("tokenPrefix"), false);
      assert.equal((ok.json.callingConfig as { hasToken?: boolean }).hasToken, true);
    } finally {
      if (envSnapshot.META_ACCESS_TOKEN === undefined) delete process.env.META_ACCESS_TOKEN;
      else process.env.META_ACCESS_TOKEN = envSnapshot.META_ACCESS_TOKEN;
    }
  });

  it("fails closed on register-gateway in production and ignores the old verify token", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.VOICE_GATEWAY_SECRET;
    try {
      const open = await jsonRequest(port, "POST", "/api/meta/register-gateway", {
        gatewayIp: "203.0.113.10",
        secret: "lumera_webhook_verify_2026",
      });
      assert.equal(open.status, 200);
      process.env.VOICE_GATEWAY_SECRET = "gateway-secret-value";
      const wrong = await jsonRequest(port, "POST", "/api/meta/register-gateway", {
        gatewayIp: "203.0.113.10",
        secret: "lumera_webhook_verify_2026",
      });
      assert.equal(wrong.status, 403);
      const ok = await jsonRequest(port, "POST", "/api/meta/register-gateway", { gatewayIp: "203.0.113.10" }, {
        "X-Voice-Gateway-Secret": "gateway-secret-value",
      });
      assert.equal(ok.status, 200);
      assert.equal(ok.json.gatewayIp, "203.0.113.10");
      const status = await jsonRequest(port, "GET", "/api/meta/register-gateway");
      assert.equal(status.status, 403);
    } finally {
      restoreEnv({
        NODE_ENV: envSnapshot.NODE_ENV,
        VOICE_GATEWAY_SECRET: envSnapshot.VOICE_GATEWAY_SECRET,
      });
    }
  });

  it("compares the voice gateway secret in constant time and allows gateway calls when it is unset", () => {
    resetVoiceGatewaySecretWarningForTests();
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((part) => String(part)).join(" "));
    };
    try {
      assert.equal(voiceGatewayAuthorized("x", { NODE_ENV: "production" }), true);
      assert.equal(voiceGatewayAuthorized("", { NODE_ENV: "production" }), true);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /VOICE_GATEWAY_SECRET is unset/);
      assert.equal(voiceGatewayAuthorized("", { NODE_ENV: "production", VOICE_GATEWAY_SECRET: "abc" }), false);
      assert.equal(voiceGatewayAuthorized("abc", { NODE_ENV: "production", VOICE_GATEWAY_SECRET: "abc" }), true);
      assert.equal(voiceGatewayAuthorized("abd", { NODE_ENV: "production", VOICE_GATEWAY_SECRET: "abc" }), false);
      assert.equal(voiceGatewayAuthorized("", { NODE_ENV: "test" }), true);
      assert.equal(warnings.length, 1);
    } finally {
      console.warn = original;
      resetVoiceGatewaySecretWarningForTests();
    }
  });

  it("resolves inbound voice from the phone line, not a body tenant, and hides the desk number", async () => {
    const suffix = `${Date.now().toString(36)}a`;
    const tenantId = `tenant-voice-${suffix}`;
    const phoneNumberId = `1666${suffix.slice(-8)}`;
    seedTenant(tenantId, { phoneNumberId, name: "North Clinic" });
    saveWhatsAppTenantVoiceSettings(getDb(), tenantId, { escalationPhone: "+91 98000 22222", receptionistName: "Asha" });
    process.env.NODE_ENV = "production";
    process.env.VOICE_GATEWAY_SECRET = "voice-line-secret";
    try {
      const missing = await jsonRequest(port, "POST", "/api/voice/inbound", {
        from: "+919888877766",
        message: "",
        tenantId,
        conversationHistory: [
          { role: "maya", text: "I'm sorry, I couldn't hear that clearly. Could you please repeat?" },
          { role: "maya", text: "I'm sorry, I couldn't hear that clearly. Could you please repeat?" },
        ],
      });
      assert.equal(missing.status, 403);

      const spoofed = await jsonRequest(
        port,
        "POST",
        "/api/voice/inbound",
        {
          from: "+919888877766",
          message: "",
          tenantId: "tenant-lumera-main",
          phoneNumberId,
          conversationHistory: [
            { role: "maya", text: "I'm sorry, I couldn't hear that clearly. Could you please repeat?" },
            { role: "maya", text: "I'm sorry, I couldn't hear that clearly. Could you please repeat?" },
          ],
        },
        { "X-Voice-Gateway-Secret": "voice-line-secret" }
      );
      assert.equal(spoofed.status, 200);
      assert.equal(spoofed.json.intent, "TRANSFER");
      assert.match(String(spoofed.json.speechText), /98000 22222/);
      assert.doesNotMatch(String(spoofed.json.speechText), /98233\s*73271/);
      assert.equal(spoofed.json.escalationPhone, undefined);
      assert.match(String(spoofed.json.speechText), /can't transfer|cannot transfer|कॉल करें/i);
    } finally {
      restoreEnv({
        NODE_ENV: envSnapshot.NODE_ENV,
        VOICE_GATEWAY_SECRET: envSnapshot.VOICE_GATEWAY_SECRET,
      });
    }
  });

  it("accepts a gateway voice call in production when VOICE_GATEWAY_SECRET is unset", async () => {
    const suffix = `${Date.now().toString(36)}open`;
    const tenantId = `tenant-open-${suffix}`;
    const phoneNumberId = `1555${suffix.slice(-8)}`;
    seedTenant(tenantId, { phoneNumberId, name: "Open Clinic" });
    saveWhatsAppTenantVoiceSettings(getDb(), tenantId, { escalationPhone: "+91 98000 44444", receptionistName: "Asha" });
    const patient = seedUser({
      id: `user-open-pt-${suffix}`,
      tenantId,
      role: "patient",
      email: `open.pt.${suffix}@example.com`,
    });
    process.env.NODE_ENV = "production";
    delete process.env.VOICE_GATEWAY_SECRET;
    try {
      const gateway = await jsonRequest(port, "POST", "/api/voice/inbound", {
        from: "+919888800011",
        message: "",
        tenantId: "tenant-lumera-main",
        phoneNumberId,
        conversationHistory: [
          { role: "maya", text: "I'm sorry, I couldn't hear that clearly. Could you please repeat?" },
          { role: "maya", text: "I'm sorry, I couldn't hear that clearly. Could you please repeat?" },
        ],
      });
      assert.equal(gateway.status, 200);
      assert.equal(gateway.json.intent, "TRANSFER");
      assert.match(String(gateway.json.speechText), /98000 44444/);
      assert.equal(gateway.json.escalationPhone, undefined);
      const asPatient = await jsonRequest(
        port,
        "POST",
        "/api/voice/inbound",
        { from: "+919888800011", message: "Where is the clinic located?", phoneNumberId },
        { Authorization: `Bearer ${patient}` }
      );
      assert.equal(asPatient.status, 403);
    } finally {
      restoreEnv({
        NODE_ENV: envSnapshot.NODE_ENV,
        VOICE_GATEWAY_SECRET: envSnapshot.VOICE_GATEWAY_SECRET,
      });
    }
  });

  it("rejects a patient session on the voice route and keeps staff on their own clinic", async () => {
    const suffix = `${Date.now().toString(36)}staff`;
    const tenantA = `tenant-staff-a-${suffix}`;
    const tenantB = `tenant-staff-b-${suffix}`;
    seedTenant(tenantA, { name: "Staff Clinic", phoneNumberId: `1888${suffix.slice(-8)}` });
    seedTenant(tenantB, { name: "Other Clinic", phoneNumberId: `1999${suffix.slice(-8)}` });
    getDb().prepare("UPDATE tenants SET address = '1 Staff Road', city = 'Pune' WHERE id = ?").run(tenantA);
    getDb().prepare("UPDATE tenants SET address = '9 Other Road', city = 'Delhi' WHERE id = ?").run(tenantB);
    const doctor = seedUser({ id: `user-staff-doc-${suffix}`, tenantId: tenantA, role: "doctor", email: `staff.doc.${suffix}@example.com` });
    const patient = seedUser({ id: `user-staff-pt-${suffix}`, tenantId: tenantA, role: "patient", email: `staff.pt.${suffix}@example.com` });
    const phoneB = `1999${suffix.slice(-8)}`;
    process.env.NODE_ENV = "production";
    process.env.VOICE_GATEWAY_SECRET = "voice-line-secret";
    try {
      const asPatient = await jsonRequest(
        port,
        "POST",
        "/api/voice/inbound",
        { from: "+919111122233", message: "Where is the clinic located?", phoneNumberId: phoneB },
        { Authorization: `Bearer ${patient}` }
      );
      assert.equal(asPatient.status, 403);
      const asDoctor = await jsonRequest(
        port,
        "POST",
        "/api/voice/inbound",
        { from: "+919111122233", message: "Where is the clinic located?", phoneNumberId: phoneB },
        { Authorization: `Bearer ${doctor}` }
      );
      assert.equal(asDoctor.status, 200);
      assert.match(String(asDoctor.json.speechText), /Staff Clinic|1 Staff Road/);
      assert.doesNotMatch(String(asDoctor.json.speechText), /Other Clinic|9 Other Road/);
      const admin = seedUser({
        id: `user-staff-admin-${suffix}`,
        tenantId: tenantA,
        role: "admin",
        email: `staff.admin.${suffix}@example.com`,
      });
      const asAdmin = await jsonRequest(
        port,
        "POST",
        "/api/voice/inbound",
        { from: "+919111122244", message: "Where is the clinic located?" },
        { Authorization: `Bearer ${admin}` }
      );
      assert.equal(asAdmin.status, 200);
      assert.match(String(asAdmin.json.speechText), /Staff Clinic|1 Staff Road/);
    } finally {
      restoreEnv({
        NODE_ENV: envSnapshot.NODE_ENV,
        VOICE_GATEWAY_SECRET: envSnapshot.VOICE_GATEWAY_SECRET,
      });
    }
  });

  it("creates a callback task when the clinic has no phone and does not invent a Lumera number", async () => {
    const suffix = `${Date.now().toString(36)}b`;
    const tenantId = `tenant-cb-${suffix}`;
    const phoneNumberId = `1777${suffix.slice(-8)}`;
    seedTenant(tenantId, { phoneNumberId, name: "" });
    getDb().prepare("UPDATE tenants SET name = '', phone = '', whatsapp_number = '' WHERE id = ?").run(tenantId);
    process.env.VOICE_GATEWAY_SECRET = "voice-line-secret";
    process.env.NODE_ENV = "production";
    try {
      const res = await jsonRequest(
        port,
        "POST",
        "/meta/voice-call",
        {
          from: "+919777766655",
          message: "",
          tenantId: "tenant-lumera-main",
          phoneNumberId,
          conversationHistory: [
            { role: "maya", text: "I'm sorry, I couldn't hear that clearly. Could you please repeat?" },
            { role: "maya", text: "I'm sorry, I couldn't hear that clearly. Could you please repeat?" },
          ],
        },
        { "X-Voice-Gateway-Secret": "voice-line-secret" }
      );
      assert.equal(res.status, 200);
      assert.match(String(res.json.speechText), /call you back|वापस कॉल/i);
      assert.doesNotMatch(String(res.json.speechText), /98233\s*73271|Lumera/);
      assert.equal(res.json.escalationPhone, undefined);
      const task = getDb()
        .prepare("SELECT tenant_id, patient_phone, status FROM voice_callback_tasks WHERE tenant_id = ?")
        .get(tenantId) as { tenant_id?: string; patient_phone?: string; status?: string } | undefined;
      assert.equal(task?.tenant_id, tenantId);
      assert.equal(task?.status, "open");
      assert.match(String(task?.patient_phone), /9777766655/);
    } finally {
      restoreEnv({
        NODE_ENV: envSnapshot.NODE_ENV,
        VOICE_GATEWAY_SECRET: envSnapshot.VOICE_GATEWAY_SECRET,
      });
    }
  });

  it("takes voice settings from the session only", async () => {
    const suffix = `${Date.now().toString(36)}c`;
    const tenantA = `tenant-vs-a-${suffix}`;
    const tenantB = `tenant-vs-b-${suffix}`;
    seedTenant(tenantA, { name: "Clinic A" });
    seedTenant(tenantB, { name: "Clinic B" });
    saveWhatsAppTenantVoiceSettings(getDb(), tenantA, { escalationPhone: "+91 98000 11111", receptionistName: "Asha" });
    saveWhatsAppTenantVoiceSettings(getDb(), tenantB, { escalationPhone: "+91 98000 33333", receptionistName: "Meera" });
    const doctor = seedUser({ id: `user-vs-${suffix}`, tenantId: tenantA, role: "doctor", email: `vs.${suffix}@example.com` });
    const patient = seedUser({ id: `user-vs-pt-${suffix}`, tenantId: tenantA, role: "patient", email: `vs.pt.${suffix}@example.com` });
    const auth = { Authorization: `Bearer ${doctor}` };
    const got = await jsonRequest(port, "GET", "/api/whatsapp/voice-settings", undefined, auth);
    assert.equal(got.status, 200);
    assert.equal(got.json.tenantId, tenantA);
    assert.equal(got.json.escalationPhone, "+91 98000 11111");
    assert.doesNotMatch(JSON.stringify(got.json), /98233\s*73271|Lumera Health/);
    const foreign = await jsonRequest(port, "GET", `/api/whatsapp/voice-settings?tenantId=${tenantB}`, undefined, auth);
    assert.equal(foreign.status, 403);
    const blocked = await jsonRequest(port, "POST", "/api/whatsapp/voice-settings", { tenantId: tenantB, receptionistName: "Hijack" }, {
      Authorization: `Bearer ${patient}`,
    });
    assert.equal(blocked.status, 403);
    const saved = await jsonRequest(port, "POST", "/api/whatsapp/voice-settings", { receptionistName: "Nila" }, auth);
    assert.equal(saved.status, 200);
    const rowA = getDb()
      .prepare("SELECT receptionist_name FROM whatsapp_tenant_settings WHERE tenant_id = ?")
      .get(tenantA) as { receptionist_name?: string } | undefined;
    const rowB = getDb()
      .prepare("SELECT receptionist_name FROM whatsapp_tenant_settings WHERE tenant_id = ?")
      .get(tenantB) as { receptionist_name?: string } | undefined;
    assert.equal(rowA?.receptionist_name, "Nila");
    assert.equal(rowB?.receptionist_name, "Meera");
  });

  it("lets only clinic admin and manager roles change schedule settings", async () => {
    const suffix = `${Date.now().toString(36)}d`;
    const tenantId = `tenant-sch-${suffix}`;
    seedTenant(tenantId);
    const patient = seedUser({ id: `user-sch-pt-${suffix}`, tenantId, role: "patient", email: `sch.pt.${suffix}@example.com` });
    const doctor = seedUser({ id: `user-sch-doc-${suffix}`, tenantId, role: "doctor", email: `sch.doc.${suffix}@example.com` });
    const admin = seedUser({ id: `user-sch-admin-${suffix}`, tenantId, role: "CLINIC_ADMIN", email: `sch.admin.${suffix}@example.com` });
    const manager = seedUser({ id: `user-sch-mgr-${suffix}`, tenantId, role: "polyclinic_admin", email: `sch.mgr.${suffix}@example.com` });
    const body = { slotDurationMinutes: 20, slotOverlapMax: 2 };
    const asPatient = await jsonRequest(port, "POST", "/api/calendar/schedule-settings", body, { Authorization: `Bearer ${patient}` });
    assert.equal(asPatient.status, 403);
    const asDoctor = await jsonRequest(port, "POST", "/api/calendar/schedule-settings", body, { Authorization: `Bearer ${doctor}` });
    assert.equal(asDoctor.status, 403);
    const asAdmin = await jsonRequest(port, "POST", "/api/calendar/schedule-settings", body, { Authorization: `Bearer ${admin}` });
    assert.equal(asAdmin.status, 200);
    assert.equal((asAdmin.json.settings as { slotDurationMinutes?: number }).slotDurationMinutes, 20);
    const asManager = await jsonRequest(port, "POST", "/api/calendar/schedule-settings", { slotOverlapMax: 3 }, { Authorization: `Bearer ${manager}` });
    assert.equal(asManager.status, 200);
    assert.equal((asManager.json.settings as { slotOverlapMax?: number }).slotOverlapMax, 3);
  });

  it("resolves available slots from the session or a public slug and ignores tenantId", async () => {
    const suffix = `${Date.now().toString(36)}e`;
    const tenantA = `tenant-slot-a-${suffix}`;
    const tenantB = `tenant-slot-b-${suffix}`;
    seedTenant(tenantA, { slug: `slot-a-${suffix}` });
    seedTenant(tenantB, { slug: `slot-b-${suffix}` });
    saveClinicScheduleSettings(getDb(), tenantA, { opdStartTime: "11:00 AM", opdEndTime: "11:15 AM", slotDurationMinutes: 15 });
    saveClinicScheduleSettings(getDb(), tenantB, { opdStartTime: "02:00 PM", opdEndTime: "02:15 PM", slotDurationMinutes: 15 });
    const user = seedUser({ id: `user-slot-${suffix}`, tenantId: tenantA, role: "doctor", email: `slot.${suffix}@example.com` });
    const queryOnly = await jsonRequest(port, "GET", `/api/calendar/available-slots?tenantId=tenant-lumera-main&date=2027-04-06`);
    assert.equal(queryOnly.status, 404);
    const bySlug = await jsonRequest(port, "GET", `/api/calendar/available-slots?slug=slot-b-${suffix}&tenantId=${tenantA}&date=2027-04-06`);
    assert.equal(bySlug.status, 200);
    assert.deepEqual(bySlug.json.availableSlots, ["02:00 PM"]);
    const bySession = await jsonRequest(
      port,
      "GET",
      "/api/calendar/available-slots?date=2027-04-06",
      undefined,
      { Authorization: `Bearer ${user}` }
    );
    assert.equal(bySession.status, 200);
    assert.deepEqual(bySession.json.availableSlots, ["11:00 AM"]);
    const foreignTenant = await jsonRequest(
      port,
      "GET",
      `/api/calendar/available-slots?tenantId=${tenantB}&date=2027-04-06`,
      undefined,
      { Authorization: `Bearer ${user}` }
    );
    assert.equal(foreignTenant.status, 403);
    const clash = await jsonRequest(
      port,
      "GET",
      `/api/calendar/available-slots?slug=slot-b-${suffix}&date=2027-04-06`,
      undefined,
      { Authorization: `Bearer ${user}` }
    );
    assert.equal(clash.status, 403);
  });

  it("starts today's search at the current IST time, stops at opd end, and shares the Completed rule", () => {
    const tenantId = `tenant-ist-${Date.now().toString(36)}`;
    seedTenant(tenantId);
    saveClinicScheduleSettings(getDb(), tenantId, {
      opdStartTime: "09:00 AM",
      opdEndTime: "10:30 AM",
      slotDurationMinutes: 15,
      slotOverlapMax: 1,
    });
    const now = new Date("2026-11-11T04:37:00.000Z");
    const open = findNextBookableSlot({ tenantId, doctorName: "Dr. Rao", date: "2026-11-11", now });
    assert.deepEqual(open, { date: "2026-11-11", timeSlot: "10:15 AM" });
    insertSlot({ id: `apt-full-${tenantId}`, tenantId, date: "2026-11-11", time: "10:15 AM", status: "Waiting" });
    const rolled = findNextBookableSlot({ tenantId, doctorName: "Dr. Rao", date: "2026-11-11", now });
    assert.deepEqual(rolled, { date: "2026-11-12", timeSlot: "09:00 AM" });

    const future = "2027-05-04";
    insertSlot({ id: `apt-done-${tenantId}`, tenantId, date: future, time: "09:00 AM", status: "Completed" });
    const afterCompleted = findNextBookableSlot({ tenantId, doctorName: "Dr. Rao", date: future, now: new Date("2027-05-04T03:00:00.000Z") });
    assert.equal(afterCompleted?.timeSlot, "09:00 AM");
    const occupancy = listSlotOccupancy(getDb(), { tenantId, date: future, includePrivateDetails: true });
    const nine = occupancy.slots.find((slot) => slot.timeSlot === "09:00 AM");
    assert.equal(nine?.bookedCount, 0);
    assert.match(scheduleSlotFreeStatusSql("status"), /Completed/);
    assert.match(scheduleSlotFreeStatusSql("status"), /Cancelled/);
    assert.match(scheduleSlotFreeStatusSql("status"), /No-Show/);
  });

  it("keeps an evening doctor bookable when clinic close is 5pm", () => {
    const suffix = `${Date.now().toString(36)}eve`;
    const tenantId = `tenant-eve-${suffix}`;
    const userId = `user-eve-${suffix}`;
    seedTenant(tenantId);
    seedUser({ id: userId, tenantId, role: "doctor", email: `eve.${suffix}@example.com` });
    saveClinicScheduleSettings(getDb(), tenantId, {
      opdStartTime: "09:00 AM",
      opdEndTime: "05:00 PM",
      slotDurationMinutes: 30,
    });
    getDb()
      .prepare(
        `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
         VALUES (?, ?, 'Dr. Evening', 'MBBS', 'REG-EVE', 'General Medicine', 5, 500, 'OPD-2', '[]', '06:00 PM - 09:00 PM', '', '', '', '', '', 1)`
      )
      .run(`doc-eve-${suffix}`, userId);
    const evening = findNextBookableSlot({
      tenantId,
      doctorName: "Dr. Evening",
      date: "2027-06-02",
      now: new Date("2027-06-02T04:00:00.000Z"),
    });
    assert.deepEqual(evening, { date: "2027-06-02", timeSlot: "06:00 PM" });

    getDb().prepare("UPDATE doctors SET opd_timing = '06:00 PM' WHERE id = ?").run(`doc-eve-${suffix}`);
    const startOnly = findNextBookableSlot({
      tenantId,
      doctorName: "Dr. Evening",
      date: "2027-06-03",
      now: new Date("2027-06-03T04:00:00.000Z"),
    });
    assert.equal(startOnly?.timeSlot, "06:00 PM");
    assert.equal(startOnly?.date, "2027-06-03");
  });

  it("offers a Sunday slot and speaks the saved day, or says the desk must arrange a time", async () => {
    const suffix = `${Date.now().toString(36)}sun`;
    const tenantId = `tenant-sun-${suffix}`;
    seedTenant(tenantId, { name: "North Clinic" });
    saveClinicScheduleSettings(getDb(), tenantId, {
      opdStartTime: "09:00 AM",
      opdEndTime: "10:00 AM",
      slotDurationMinutes: 30,
      slotOverlapMax: 1,
    });
    const sunday = findNextBookableSlot({
      tenantId,
      doctorName: "Dr. Rao",
      date: "2026-11-15",
      now: new Date("2026-11-15T03:00:00.000Z"),
    });
    assert.deepEqual(sunday, { date: "2026-11-15", timeSlot: "09:00 AM" });

    const rolled = await runGeminiVoiceReceptionist({
      message: "Please book an appointment",
      language: "English",
      tenantId,
      callerPhone: `+9171${String(Date.now()).slice(-8)}`,
      now: new Date("2026-11-11T05:00:00.000Z"),
    });
    assert.equal(rolled.intent, "BOOKING");
    assert.equal(rolled.appointment?.date, "2026-11-12");
    assert.match(rolled.speechText, /12 Nov 2026/);
    assert.match(rolled.suggestedAction, /2026-11-12/);
    assert.doesNotMatch(rolled.speechText, /for today at/i);
    assert.doesNotMatch(rolled.suggestedAction, /for today at/i);

    const closedId = `tenant-closed-${suffix}`;
    seedTenant(closedId, { name: "Closed Clinic" });
    saveClinicScheduleSettings(getDb(), closedId, {
      opdStartTime: "09:00 AM",
      opdEndTime: "09:15 AM",
      slotDurationMinutes: 15,
      slotOverlapMax: 1,
    });
    for (let day = 0; day < 14; day++) {
      const date = new Date(Date.UTC(2026, 10, 11 + day)).toISOString().slice(0, 10);
      insertSlot({ id: `apt-full-${suffix}-${day}`, tenantId: closedId, date, time: "09:00 AM", status: "Waiting" });
    }
    const full = await runGeminiVoiceReceptionist({
      message: "Please book an appointment",
      language: "English",
      tenantId: closedId,
      callerPhone: `+9172${String(Date.now()).slice(-8)}`,
      now: new Date("2026-11-11T04:00:00.000Z"),
    });
    assert.equal(full.intent, "INQUIRY");
    assert.equal(full.appointment, undefined);
    assert.match(full.speechText, /no open slot/i);
    assert.doesNotMatch(full.speechText, /token/i);
    const saved = getDb().prepare("SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?").get(closedId) as { n: number };
    assert.equal(saved.n, 14);
  });

  it("answers Indic location and greeting in that language with the clinic and receptionist names", async () => {
    const suffix = `${Date.now().toString(36)}hi`;
    const tenantId = `tenant-hi-${suffix}`;
    seedTenant(tenantId, { name: "North Clinic" });
    getDb().prepare("UPDATE tenants SET address = '12 Lake Road', city = 'Pune' WHERE id = ?").run(tenantId);
    saveWhatsAppTenantVoiceSettings(getDb(), tenantId, { receptionistName: "Asha" });
    const location = await runGeminiVoiceReceptionist({
      message: "क्लिनिक का पता बताइए",
      language: "Hindi",
      tenantId,
    });
    assert.equal(location.intent, "LOCATION");
    assert.match(location.speechText, /North Clinic/);
    assert.match(location.speechText, /12 Lake Road/);
    assert.match(location.speechText, /पता/);
    assert.doesNotMatch(location.speechText, /is located at/);
    const greeting = INDIC_LANGUAGES.hi.greetingText("Ravi", "North Clinic", "Asha");
    assert.match(greeting, /Asha/);
    assert.doesNotMatch(greeting, /माया/);
    const bengali = INDIC_LANGUAGES.bn.locationText("North Clinic", "12 Lake Road");
    assert.match(bengali, /ঠিকানা/);
    assert.match(bengali, /North Clinic/);
    assert.doesNotMatch(bengali, /is located at/);
  });

  it("respects VERTEX_GEMINI_MODEL exactly, including gemini-3.5-flash-lite", () => {
    assert.equal(vertexGeminiModel({ VERTEX_GEMINI_MODEL: "gemini-3.5-flash-lite" }), "gemini-3.5-flash-lite");
    assert.equal(vertexGeminiModel({}), "gemini-3.5-flash-lite");
    assert.equal(vertexGeminiModel({ NODE_ENV: "production" }), "gemini-3.5-flash-lite");
  });

  it("keeps patient-facing voice copy free of hardcoded Lumera clinic branding", () => {
    const voice = fs.readFileSync(path.join(root, "server/gemini-voice.ts"), "utf8");
    const gateway = fs.readFileSync(path.join(root, "deploy/webrtc-voice-gateway/gateway.py"), "utf8");
    assert.doesNotMatch(voice, /98233\s*73271/);
    assert.doesNotMatch(voice, /9823373271/);
    assert.doesNotMatch(voice, /Lumera Health|Lumera Apex PolyClinic|Lumera Polyclinic|Lumera Clinic/);
    assert.match(gateway, /Namaste, one moment please/);
    assert.match(gateway, /Namaste! Thank you for calling \{cl_name\}\. How can I help you today\?/);
    assert.doesNotMatch(gateway, /health appointment/);
    const voiceBot = fs.readFileSync(path.join(root, "src/components/VoiceBotAssistant.tsx"), "utf8");
    const voiceDesk = fs.readFileSync(path.join(root, "src/lib/voiceDesk.ts"), "utf8");
    assert.match(voiceBot, /mayaOpeningGreeting/);
    assert.match(voiceDesk, /mayaDefaultGreeting/);
    assert.doesNotMatch(voiceBot, /health appointment/);
    assert.doesNotMatch(voiceDesk, /health appointment/);
    assert.doesNotMatch(voiceBot, /Thank you for calling Lumera/);
    assert.match(gateway, /VOICE_GATEWAY_SECRET/);
    assert.match(gateway, /phoneNumberId/);
    assert.doesNotMatch(gateway, /Lumera Apex|Lumera Health/);
    const payload = gateway.slice(gateway.indexOf("payload = {"), gateway.indexOf("logger.info", gateway.indexOf("payload = {")));
    assert.match(payload, /phoneNumberId/);
    assert.doesNotMatch(payload, /tenantId/);
    assert.match(gateway, /def offer_presented_secret/);
    assert.match(gateway, /privileged and secret_required/);
    assert.match(gateway, /VOICE_GATEWAY_SECRET and not privileged/);
    assert.match(gateway, /existing.get\("privileged"\) and not privileged/);
    assert.match(gateway, /privileged and not existing.get\("privileged"\)/);
    assert.match(gateway, /status=409/);
    assert.doesNotMatch(gateway, /existing\["privileged"\] = True/);
    assert.doesNotMatch(gateway, /if not offer_authorized/);
    const health = gateway.slice(gateway.indexOf("async def handle_health"), gateway.indexOf("def offer_presented_secret"));
    assert.doesNotMatch(health, /callId/);
    assert.doesNotMatch(health, /callerPhone/);
    assert.doesNotMatch(health, /sdpAnswer/);
    const meta = fs.readFileSync(path.join(root, "server/meta.ts"), "utf8");
    assert.match(meta, /X-Voice-Gateway-Secret/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, "deploy/webrtc-voice-gateway/provision-free-vm.sh"), "utf8"), /lumera_webhook_verify_2026/);
  });
});

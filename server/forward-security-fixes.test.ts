import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createApiRouter } from "./api.ts";
import { signJwtToken } from "./auth.ts";
import { saveClinicScheduleSettings, listSlotOccupancy, scheduleSlotFreeStatusSql } from "./clinic-schedule.ts";
import { getDb, initDatabase } from "./db.ts";
import { mountGeminiVoiceRoutes } from "./gemini-voice.ts";
import { findNextBookableSlot } from "./whatsapp-calendar-booking.ts";
import { saveWhatsAppTenantVoiceSettings } from "./whatsapp-numbers-store.ts";
import { ensureTenantSlugColumn } from "./tenant-slug.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { voiceGatewayAuthorized } from "./voice-gateway-auth.ts";
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
      const closed = await jsonRequest(port, "POST", "/api/meta/register-gateway", {
        gatewayIp: "203.0.113.10",
        secret: "lumera_webhook_verify_2026",
      });
      assert.equal(closed.status, 403);
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

  it("compares the voice gateway secret in constant time and fails closed when unset in production", () => {
    assert.equal(voiceGatewayAuthorized("x", { NODE_ENV: "production" }), false);
    assert.equal(voiceGatewayAuthorized("", { NODE_ENV: "production", VOICE_GATEWAY_SECRET: "abc" }), false);
    assert.equal(voiceGatewayAuthorized("abc", { NODE_ENV: "production", VOICE_GATEWAY_SECRET: "abc" }), true);
    assert.equal(voiceGatewayAuthorized("abd", { NODE_ENV: "production", VOICE_GATEWAY_SECRET: "abc" }), false);
    assert.equal(voiceGatewayAuthorized("", { NODE_ENV: "test" }), true);
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

  it("respects VERTEX_GEMINI_MODEL exactly, including gemini-3.5-flash-lite", () => {
    assert.equal(vertexGeminiModel({ VERTEX_GEMINI_MODEL: "gemini-3.5-flash-lite" }), "gemini-3.5-flash-lite");
    assert.equal(vertexGeminiModel({}), "gemini-2.5-flash");
  });

  it("keeps patient-facing voice copy free of hardcoded Lumera clinic branding", () => {
    const voice = fs.readFileSync(path.join(root, "server/gemini-voice.ts"), "utf8");
    const gateway = fs.readFileSync(path.join(root, "deploy/webrtc-voice-gateway/gateway.py"), "utf8");
    assert.doesNotMatch(voice, /98233\s*73271/);
    assert.doesNotMatch(voice, /9823373271/);
    assert.doesNotMatch(voice, /Lumera Health|Lumera Apex PolyClinic|Lumera Polyclinic|Lumera Clinic/);
    assert.match(gateway, /Namaste, one moment please/);
    assert.match(gateway, /VOICE_GATEWAY_SECRET/);
    assert.match(gateway, /phoneNumberId/);
    assert.doesNotMatch(gateway, /Lumera Apex|Lumera Health/);
    const payload = gateway.slice(gateway.indexOf("payload = {"), gateway.indexOf("logger.info", gateway.indexOf("payload = {")));
    assert.match(payload, /phoneNumberId/);
    assert.doesNotMatch(payload, /tenantId/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, "deploy/webrtc-voice-gateway/provision-free-vm.sh"), "utf8"), /lumera_webhook_verify_2026/);
  });
});

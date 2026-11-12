import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { getDb, initDatabase, DEMO_TENANT_ID } from "./db.ts";
import { mountGeminiVoiceRoutes } from "./gemini-voice.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { saveWhatsAppTenantVoiceSettings } from "./whatsapp-numbers-store.ts";
import { ensureVoiceCallbackTasks } from "./voice-callback.ts";
import {
  classifyBookingReply,
  formatIstDateSpeech,
  planVoiceBooking,
  speakablePhone,
} from "./voice-booking-confirm.ts";
import { mayaDemoMode } from "./voice-demo.ts";
import { cloudTtsVoice, mayaSpokenLanguage } from "./voice-tts.ts";
import { COMMON_INDIAN_MEDICINES, doctorNicknames, formatTenantVoiceFacts } from "./voice-vocabulary.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function seedTenant(id: string, phoneNumberId: string, name: string) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, phone_number_id, created_at, updated_at)
       VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+919811122233', ?, 500, 0, 1, '', ?, ?, ?)`
    )
    .run(id, name, now, phoneNumberId, now, now);
}

describe("Maya listen-as-is pilot", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  const envSnapshot = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
    VOICE_GATEWAY_SECRET: process.env.VOICE_GATEWAY_SECRET,
    MAYA_DEMO_MODE: process.env.MAYA_DEMO_MODE,
  };

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "maya-listen-jwt-secret-not-for-prod";
    initDatabase();
    ensureVoiceCallbackTasks();
    const server = await startTestServer((app) => {
      mountGeminiVoiceRoutes(app, () => null);
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    restoreEnv(envSnapshot);
    await close?.();
  });

  it("keeps a 500ms endpoint, barge-in audio, and the clinic greeting on the free gateway", () => {
    const gateway = fs.readFileSync(path.join(root, "deploy/webrtc-voice-gateway/gateway.py"), "utf8");
    assert.match(gateway, /MAYA_ENDPOINT_SILENCE_MS", "500"/);
    assert.match(gateway, /def endpoint_silence_ms/);
    assert.match(gateway, /overlap_buffer/);
    assert.match(gateway, /max_speech_frames = 450/);
    assert.match(gateway, /Namaste! Thank you for calling \{cl_name\}\. How can I help you today\?/);
    assert.match(gateway, /bookingDraft/);
    const health = gateway.slice(gateway.indexOf("async def handle_health"), gateway.indexOf("def offer_presented_secret"));
    assert.doesNotMatch(health, /callId/);
    assert.match(health, /endpointSilenceMs/);
  });

  it("uses free-tier WaveNet voices for Hindi and Marathi and en-IN otherwise", () => {
    assert.deepEqual(cloudTtsVoice("hi"), { languageCode: "hi-IN", name: "hi-IN-Wavenet-A" });
    assert.deepEqual(cloudTtsVoice("mr"), { languageCode: "mr-IN", name: "mr-IN-Wavenet-A" });
    assert.deepEqual(cloudTtsVoice("en"), { languageCode: "en-IN", name: "en-IN-Wavenet-A" });
    assert.equal(mayaSpokenLanguage("appointment chahiye", "", "hi"), "hi");
    assert.equal(mayaSpokenLanguage("doktor pahije", "mr"), "mr");
    assert.equal(mayaSpokenLanguage("I need a slot", "en"), "en");
    assert.equal(mayaSpokenLanguage("வணக்கம்", "ta", "ta"), "en");
    const voice = fs.readFileSync(path.join(root, "server/gemini-voice.ts"), "utf8");
    assert.match(voice, /cloudTtsVoice\(/);
    assert.match(voice, /vertexGeminiModel\(/);
    assert.doesNotMatch(voice, /Neural2/);
    assert.doesNotMatch(voice, /Lumera Health|Lumera Apex PolyClinic|Lumera Polyclinic|Lumera Clinic/);
  });

  it("puts the called clinic, doctor nicknames, services, and medicines in the audio facts", () => {
    const facts = formatTenantVoiceFacts({
      clinicName: "North Clinic",
      doctors: [{ name: "Dr. Meera Shah", specialty: "General Medicine", timing: "10:00 AM - 01:00 PM", days: "Mon-Fri" }],
      schedule: { opdStartTime: "10:00 AM", opdEndTime: "01:00 PM", slotDurationMinutes: 20 },
    });
    assert.match(facts, /North Clinic/);
    assert.match(facts, /Meera/);
    assert.match(facts, /Shah/);
    assert.match(facts, /General Medicine/);
    assert.match(facts, /10:00 AM to 01:00 PM/);
    assert.match(facts, /20 minutes/);
    assert.ok(COMMON_INDIAN_MEDICINES.includes("Dolo 650"));
    assert.match(facts, /Dolo 650/);
    assert.deepEqual(doctorNicknames("Dr. Meera Shah (PT)"), ["Meera", "Shah"]);
    assert.doesNotMatch(facts, /Lumera/);
  });

  it("reads booking details back and books only after yes", () => {
    const proposed = { date: "2026-11-12", timeSlot: "10:30 AM" };
    const first = planVoiceBooking({
      message: "Please book an appointment tomorrow at 10:30 am",
      draft: null,
      patientName: "Meera Shah",
      phone: "+919999973271",
      doctorName: "Meera Shah",
      clinicName: "North Clinic",
      clinicPhone: "+91 98000 33333",
      proposed,
      language: "en",
      now: new Date("2026-11-11T06:00:00.000Z"),
    });
    assert.equal(first.commit, false);
    assert.equal(first.callback, false);
    assert.match(first.speechText, /Meera Shah/);
    assert.match(first.speechText, /IST/);
    assert.match(first.speechText, /10:30 AM/);
    assert.match(first.speechText, /\+91 99999 73271/);
    assert.match(first.speechText, /Shall I book this/);
    assert.equal(first.draft?.status, "awaiting_confirmation");
    assert.equal(formatIstDateSpeech("2026-11-12"), "12 November 2026");
    assert.equal(speakablePhone("+919999973271"), "+91 99999 73271");

    const yes = planVoiceBooking({
      message: "yes",
      draft: first.draft,
      patientName: "Meera Shah",
      phone: "+919999973271",
      doctorName: "Meera Shah",
      clinicName: "North Clinic",
      clinicPhone: "+91 98000 33333",
      proposed,
      language: "en",
      now: new Date("2026-11-11T06:00:00.000Z"),
    });
    assert.equal(classifyBookingReply("yes"), "yes");
    assert.equal(yes.commit, true);
    assert.equal(yes.date, first.draft?.date);
    assert.equal(yes.timeSlot, "10:30 AM");
    assert.equal(yes.phone, "+919999973271");
  });

  it("offers the clinic number and a callback after two unclear confirmations", () => {
    const proposed = { date: "2026-11-12", timeSlot: "10:30 AM" };
    const base = {
      patientName: "Meera Shah",
      phone: "+919999973271",
      doctorName: "Meera Shah",
      clinicName: "North Clinic",
      clinicPhone: "+91 98000 33333",
      proposed,
      language: "en" as const,
      now: new Date("2026-11-11T06:00:00.000Z"),
    };
    const opened = planVoiceBooking({ ...base, message: "book tomorrow at 10:30 am", draft: null });
    const once = planVoiceBooking({ ...base, message: "hmm", draft: opened.draft });
    assert.equal(once.callback, false);
    assert.equal(once.draft?.failedConfirmations, 1);
    const twice = planVoiceBooking({ ...base, message: "banana", draft: once.draft });
    assert.equal(twice.callback, true);
    assert.equal(twice.commit, false);
    assert.equal(twice.draft, null);
    assert.match(twice.speechText, /98000 33333/);
    assert.match(twice.speechText, /cannot transfer/i);
    assert.doesNotMatch(twice.speechText, /transferring you|I'm transferring|connecting you now/i);

    const noPhone = planVoiceBooking({
      ...base,
      clinicPhone: "",
      message: "banana",
      draft: { ...opened.draft!, failedConfirmations: 1 },
    });
    assert.equal(noPhone.callback, true);
    assert.match(noPhone.speechText, /no phone number on file/i);
    assert.doesNotMatch(noPhone.speechText, /98233/);
  });

  it("uses the demo tenant only when demo mode is on and the line does not resolve", async () => {
    assert.equal(mayaDemoMode({}), false);
    assert.equal(mayaDemoMode({ MAYA_DEMO_MODE: "true" }), true);
    process.env.NODE_ENV = "production";
    process.env.VOICE_GATEWAY_SECRET = "maya-listen-secret";
    delete process.env.MAYA_DEMO_MODE;
    try {
      const closed = await jsonRequest(port, "POST", "/api/voice/inbound", {
        from: "+919999973271",
        message: "Where is the clinic located?",
      }, { "X-Voice-Gateway-Secret": "maya-listen-secret" });
      assert.equal(closed.status, 403);

      process.env.MAYA_DEMO_MODE = "true";
      const lockedDemo = await jsonRequest(port, "POST", "/api/voice/inbound", {
        from: "+919999900001",
        callerName: "Ravee",
        message: "Where is the clinic located?",
      }, { "X-Voice-Gateway-Secret": "maya-listen-secret" });
      assert.equal(lockedDemo.status, 403);

      delete process.env.VOICE_GATEWAY_SECRET;
      const opened = await jsonRequest(port, "POST", "/api/voice/inbound", {
        from: "+919999900001",
        callerName: "Ravee",
        message: "Where is the clinic located?",
      });
      assert.equal(opened.status, 200);
      const row = getDb()
        .prepare("SELECT tenant_id FROM whatsapp_messages WHERE patient_phone = ? ORDER BY created_at DESC LIMIT 1")
        .get("+919999900001") as { tenant_id?: string } | undefined;
      assert.equal(row?.tenant_id, DEMO_TENANT_ID);

      const legacyId = `tenant-legacy-demo-${Date.now().toString(36)}`;
      seedTenant(legacyId, `1777${legacyId.slice(-6)}`, "Legacy Wins Clinic");
      getDb().prepare("UPDATE tenants SET address = '4 Legacy Road', city = 'Pune', phone_number_id = '' WHERE id = ?").run(legacyId);
      const legacy = await jsonRequest(port, "POST", "/api/voice/inbound", {
        from: "+919999900003",
        callerName: "Ravi",
        message: "Where is the clinic located?",
        tenantId: legacyId,
      });
      assert.equal(legacy.status, 200);
      assert.match(String(legacy.json.speechText), /Legacy Wins Clinic|4 Legacy Road/);

      process.env.VOICE_GATEWAY_SECRET = "maya-listen-secret";
      const suffix = `${Date.now().toString(36)}line`;
      const tenantId = `tenant-line-${suffix}`;
      const phoneNumberId = `1444${suffix.slice(-8)}`;
      seedTenant(tenantId, phoneNumberId, "Line Clinic");
      getDb().prepare("UPDATE tenants SET address = '8 Line Road', city = 'Pune' WHERE id = ?").run(tenantId);
      const lined = await jsonRequest(port, "POST", "/api/voice/inbound", {
        from: "+919999900002",
        callerName: "Ravee",
        message: "Where is the clinic located?",
        phoneNumberId,
        tenantId: DEMO_TENANT_ID,
      }, { "X-Voice-Gateway-Secret": "maya-listen-secret" });
      assert.equal(lined.status, 200);
      assert.match(String(lined.json.speechText), /Line Clinic|8 Line Road/);
      assert.equal(lined.json.ttsVoice, "en-IN-Wavenet-A");
    } finally {
      restoreEnv(envSnapshot);
    }
  });

  it("does not write a booking until the caller confirms, then stores it", async () => {
    const suffix = `${Date.now().toString(36)}book`;
    const tenantId = `tenant-book-${suffix}`;
    const phoneNumberId = `1333${suffix.slice(-8)}`;
    seedTenant(tenantId, phoneNumberId, "Book Clinic");
    saveWhatsAppTenantVoiceSettings(getDb(), tenantId, { escalationPhone: "+91 98000 33333", receptionistName: "Asha" });
    process.env.NODE_ENV = "production";
    process.env.VOICE_GATEWAY_SECRET = "maya-listen-secret";
    delete process.env.MAYA_DEMO_MODE;
    const from = `+9198765${String(Date.now()).slice(-5)}`;
    try {
      const first = await jsonRequest(
        port,
        "POST",
        "/api/voice/inbound",
        {
          from,
          callerName: "Meera Shah",
          message: "Please book an appointment tomorrow at 10:30 am",
          phoneNumberId,
        },
        { "X-Voice-Gateway-Secret": "maya-listen-secret" }
      );
      assert.equal(first.status, 200);
      assert.notEqual(first.json.intent, "BOOKING");
      assert.equal(first.json.appointment, undefined);
      assert.match(String(first.json.speechText), /I have Meera /);
      assert.match(String(first.json.speechText), /IST/);
      assert.match(String(first.json.speechText), /10:30 AM/);
      assert.match(String(first.json.speechText), /Shall I book this/);
      const pending = getDb().prepare("SELECT COUNT(*) AS c FROM appointments WHERE tenant_id = ?").get(tenantId) as { c: number };
      assert.equal(pending.c, 0);

      const second = await jsonRequest(
        port,
        "POST",
        "/api/voice/inbound",
        {
          from,
          callerName: "Meera Shah",
          message: "yes",
          phoneNumberId,
          bookingDraft: first.json.bookingDraft,
        },
        { "X-Voice-Gateway-Secret": "maya-listen-secret" }
      );
      assert.equal(second.status, 200);
      assert.equal(second.json.intent, "BOOKING");
      assert.equal(second.json.bookingDraft, null);
      const booked = second.json.appointment as { timeSlot?: string } | undefined;
      assert.ok(booked);
      assert.equal(booked.timeSlot, "10:30 AM");
      const saved = getDb().prepare("SELECT COUNT(*) AS c FROM appointments WHERE tenant_id = ?").get(tenantId) as { c: number };
      assert.equal(saved.c, 1);

      const hindi = await jsonRequest(
        port,
        "POST",
        "/api/voice/inbound",
        {
          from: "+919888877701",
          callerName: "Ravee",
          message: "क्लिनिक का पता बताइए",
          phoneNumberId,
          language: "Hindi",
        },
        { "X-Voice-Gateway-Secret": "maya-listen-secret" }
      );
      assert.equal(hindi.status, 200);
      assert.equal(hindi.json.ttsLanguage, "hi-IN");
      assert.equal(hindi.json.ttsVoice, "hi-IN-Wavenet-A");
    } finally {
      restoreEnv(envSnapshot);
    }
  });
});

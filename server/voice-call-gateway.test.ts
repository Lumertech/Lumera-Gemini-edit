import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getDb, initDatabase } from "./db.ts";
import { mountGeminiVoiceRoutes } from "./gemini-voice.ts";
import {
  getVoiceGatewayIp,
  handleMetaInboundCallAction,
  resetMetaCallAnswerMemoryForTests,
  resetMetaCallAnswerStateForTests,
  setVoiceGatewayIp,
} from "./meta.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import {
  claimVoiceCallGateway,
  loadCallGatewaySdp,
  normalizeGatewayKey,
  noteVoiceGatewaySeen,
  recentVoiceGateways,
  resetVoiceCallGatewaysForTests,
  saveCallGatewaySdp,
  VOICE_CALL_GATEWAY_TTL_MS,
} from "./voice-call-gateway.ts";
import { saveWhatsAppTenantVoiceSettings } from "./whatsapp-numbers-store.ts";

const REAL_SDP = "v=0\r\no=- 1 2 IN IP4 203.0.113.10\r\nm=audio 49152 UDP/TLS/RTP/SAVPF 111\r\n";
const OFFER_SDP = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:audio\r\n";

describe("one gateway owns a call", () => {
  before(() => {
    initDatabase();
  });

  it("normalizes the source address and ignores a second gateway", () => {
    assert.equal(normalizeGatewayKey("::ffff:203.0.113.10"), "203.0.113.10");
    const callId = `call-own-${Date.now()}`;
    const first = claimVoiceCallGateway(callId, "::ffff:203.0.113.10");
    assert.equal(first.status, "owner");
    saveCallGatewaySdp(callId, "203.0.113.10", REAL_SDP);
    const again = claimVoiceCallGateway(callId, "203.0.113.10");
    assert.equal(again.status, "owner");
    if (again.status === "owner") assert.equal(again.sdpAnswer, REAL_SDP);
    const second = claimVoiceCallGateway(callId, "198.51.100.20");
    assert.equal(second.status, "foreign");
    if (second.status === "foreign") {
      assert.equal(second.gatewayKey, "203.0.113.10");
      assert.equal(second.sdpAnswer, REAL_SDP);
    }
    assert.equal(claimVoiceCallGateway("", "203.0.113.10").status, "unscoped");
    assert.equal(loadCallGatewaySdp(callId), REAL_SDP);
  });

  it("lets a new gateway take a call after the owner goes quiet", () => {
    const callId = `call-stale-${Date.now()}`;
    const old = Date.now() - VOICE_CALL_GATEWAY_TTL_MS - 1000;
    assert.equal(claimVoiceCallGateway(callId, "203.0.113.10", old).status, "owner");
    const taken = claimVoiceCallGateway(callId, "198.51.100.20");
    assert.equal(taken.status, "owner");
    if (taken.status === "owner") assert.equal(taken.gatewayKey, "198.51.100.20");
  });

  it("lists gateways that registered in the last day", () => {
    resetVoiceCallGatewaysForTests();
    noteVoiceGatewaySeen("34.46.39.52");
    noteVoiceGatewaySeen("198.51.100.8");
    const seen = recentVoiceGateways().map((row) => row.gatewayKey);
    assert.ok(seen.includes("34.46.39.52"));
    assert.ok(seen.includes("198.51.100.8"));
  });

  it("does not send one call's offer to a second gateway", async () => {
    const previousIp = getVoiceGatewayIp();
    const previousUrl = process.env.VOICE_GATEWAY_URL;
    const previousToken = process.env.META_ACCESS_TOKEN;
    resetMetaCallAnswerStateForTests();
    let gatewayCalls = 0;
    const urls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/webrtc/answer-offer")) {
        gatewayCalls += 1;
        return new Response(JSON.stringify({ sdpAnswer: REAL_SDP }), { status: 200 });
      }
      if (url.includes("graph.facebook.com")) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return original(input, init);
    }) as typeof fetch;
    try {
      process.env.META_ACCESS_TOKEN = "meta-test-token";
      setVoiceGatewayIp("203.0.113.10");
      process.env.VOICE_GATEWAY_URL = "http://203.0.113.10:3000";
      const call = {
        phoneNumberId: "1099000111",
        callId: `call-two-vm-${Date.now()}`,
        offerSdp: OFFER_SDP,
        fromPhone: "+919800011122",
        tenantId: "tenant-lumera-main",
      };
      const first = await handleMetaInboundCallAction({ ...call, action: "accept" });
      assert.equal(first.ok, true);
      assert.equal(gatewayCalls, 1);
      assert.ok(urls.some((url) => url.startsWith("http://203.0.113.10:3000/")));

      resetMetaCallAnswerMemoryForTests();
      setVoiceGatewayIp("198.51.100.20");
      process.env.VOICE_GATEWAY_URL = "http://198.51.100.20:3000";
      const second = await handleMetaInboundCallAction({ ...call, action: "accept" });
      assert.equal(second.ok, true);
      assert.equal(gatewayCalls, 1);
      assert.equal(urls.filter((url) => url.includes("198.51.100.20")).length, 0);
    } finally {
      globalThis.fetch = original;
      setVoiceGatewayIp(previousIp);
      if (previousUrl === undefined) delete process.env.VOICE_GATEWAY_URL;
      else process.env.VOICE_GATEWAY_URL = previousUrl;
      if (previousToken === undefined) delete process.env.META_ACCESS_TOKEN;
      else process.env.META_ACCESS_TOKEN = previousToken;
      resetMetaCallAnswerStateForTests();
    }
  });
});

describe("inbound turns from a second gateway", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  const envSnapshot = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
    VOICE_GATEWAY_SECRET: process.env.VOICE_GATEWAY_SECRET,
    MAYA_DEMO_MODE: process.env.MAYA_DEMO_MODE,
    MAYA_TTS_OFFLINE: process.env.MAYA_TTS_OFFLINE,
  };
  const headers = { "X-Voice-Gateway-Secret": "maya-gateway-owner-secret" };
  let phoneNumberId = "";

  before(async () => {
    process.env.MAYA_TTS_OFFLINE = "1";
    delete process.env.MAYA_DEMO_MODE;
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "maya-gateway-owner-jwt";
    initDatabase();
    process.env.NODE_ENV = "production";
    process.env.VOICE_GATEWAY_SECRET = "maya-gateway-owner-secret";
    const suffix = `${Date.now().toString(36)}gw`;
    const tenantId = `tenant-gw-${suffix}`;
    phoneNumberId = `1666${suffix.slice(-8)}`;
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, phone_number_id, created_at, updated_at)
         VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+919811122233', ?, 500, 0, 1, '', ?, ?, ?)`
      )
      .run(tenantId, "Gateway Clinic", now, phoneNumberId, now, now);
    saveWhatsAppTenantVoiceSettings(getDb(), tenantId, { escalationPhone: "+91 98000 33333", receptionistName: "Maya" });
    const server = await startTestServer((app) => {
      mountGeminiVoiceRoutes(app, () => null);
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await close?.();
  });

  it("ignores the second VM and lets the owner keep the name", async () => {
    const callId = `live-${Date.now()}`;
    const from = "+919812300001";
    const first = await jsonRequest(port, "POST", "/api/voice/inbound", {
      from,
      callerName: "Patient",
      message: "I need an appointment please",
      phoneNumberId,
      callId,
      conversationHistory: [],
    }, { ...headers, "x-forwarded-for": "203.0.113.10" });
    assert.equal(first.status, 200);
    assert.match(String(first.json.speechText), /patient's name/i);
    assert.notEqual(first.json.ignoredGateway, true);

    const other = await jsonRequest(port, "POST", "/api/voice/inbound", {
      from,
      callerName: "Patient",
      message: "Priya Sharma",
      phoneNumberId,
      callId,
      conversationHistory: [],
      bookingDraft: null,
    }, { ...headers, "x-forwarded-for": "198.51.100.20" });
    assert.equal(other.status, 200);
    assert.equal(other.json.ignoredGateway, true);
    assert.equal(other.json.dropped, true);
    assert.equal(other.json.speechText, "");
    assert.equal(other.json.intent, "SILENCE");

    const owner = await jsonRequest(port, "POST", "/api/voice/inbound", {
      from,
      callerName: "Patient",
      message: "Priya",
      phoneNumberId,
      callId,
      conversationHistory: [
        { role: "caller", text: "I need an appointment please" },
        { role: "maya", text: first.json.speechText },
      ],
      bookingDraft: first.json.bookingDraft,
    }, { ...headers, "x-forwarded-for": "203.0.113.10" });
    assert.equal(owner.status, 200);
    assert.notEqual(owner.json.ignoredGateway, true);
    assert.equal((owner.json.bookingDraft as { patientName?: string }).patientName, "Priya");
    assert.match(String(owner.json.speechText), /Priya/);
    assert.doesNotMatch(String(owner.json.speechText), /patient's name/i);

    const unlocked = await jsonRequest(port, "POST", "/api/voice/inbound", {
      from: "+919812300002",
      callerName: "Patient",
      message: "I need an appointment please",
      phoneNumberId,
    }, { ...headers, "x-forwarded-for": "198.51.100.20" });
    assert.equal(unlocked.status, 200);
    assert.notEqual(unlocked.json.ignoredGateway, true);
    assert.match(String(unlocked.json.speechText), /patient's name/i);
  });
});

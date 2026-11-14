import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { getDb, initDatabase } from "./db.ts";
import { mountGeminiVoiceRoutes } from "./gemini-voice.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { MAYA_FILLER_DELAY_MS, shouldPlayFiller, type FillerTurnInput } from "./voice-filler.ts";
import {
  GREETING_TAIL_MS,
  MIN_SPEECH_FRAMES,
  MIN_SPEECH_MS,
  NOISE_TRANSCRIPT_TOKENS,
  SPEECH_FRAME_MS,
  acceptsSpeechFrames,
  greetingListenClosed,
  isNoiseTranscript,
  openingAudioKind,
  shouldDropGatewayUtterance,
  shouldDropVoiceUtterance,
  shouldStartCallerTurn,
} from "./voice-listen-gate.ts";
import { saveWhatsAppTenantVoiceSettings } from "./whatsapp-numbers-store.ts";

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

function fillerTurn(overrides: Partial<FillerTurnInput> = {}): FillerTurnInput {
  return {
    elapsedMs: MAYA_FILLER_DELAY_MS,
    lookup: true,
    replyStarted: false,
    bargeIn: false,
    alreadyPlayedThisTurn: false,
    playedOnPreviousTurn: false,
    trackSpeaking: false,
    callerSpeaking: false,
    ...overrides,
  };
}

describe("Maya greeting-first and noise gate", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  const envSnapshot = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
    VOICE_GATEWAY_SECRET: process.env.VOICE_GATEWAY_SECRET,
    MAYA_TTS_OFFLINE: process.env.MAYA_TTS_OFFLINE,
  };

  before(async () => {
    process.env.MAYA_TTS_OFFLINE = "1";
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "maya-greeting-first-jwt-not-for-prod";
    initDatabase();
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

  it("opens with the clinic greeting or silence, never a hold clip", () => {
    assert.equal(openingAudioKind(true), "greeting");
    assert.equal(openingAudioKind(false), "silence");
    assert.equal(GREETING_TAIL_MS, 300);
    assert.equal(MIN_SPEECH_MS, 400);
    assert.equal(SPEECH_FRAME_MS, 32);
    assert.equal(MIN_SPEECH_FRAMES, 13);
    assert.equal(MIN_SPEECH_FRAMES * SPEECH_FRAME_MS >= MIN_SPEECH_MS, true);

    const gateway = fs.readFileSync(path.join(root, "deploy/webrtc-voice-gateway/gateway.py"), "utf8");
    assert.doesNotMatch(gateway, /Namaste, one moment please/);
    assert.doesNotMatch(gateway, /cached_hold_pcm/);
    assert.doesNotMatch(gateway, /NEUTRAL_HOLD_TEXT/);
    assert.match(gateway, /Namaste! Thank you for calling \{cl_name\}\. How can I help you today\?/);
    assert.match(gateway, /GREETING_TAIL_S = 0\.3/);
    assert.match(gateway, /MIN_SPEECH_MS = 400/);
    assert.match(gateway, /SPEECH_FRAME_MS = 32/);
    assert.match(gateway, /MIN_SPEECH_FRAMES = \(MIN_SPEECH_MS \+ SPEECH_FRAME_MS - 1\) \/\/ SPEECH_FRAME_MS/);
    assert.match(gateway, /def queue_greeting/);
    assert.match(gateway, /def listening_closed/);

    const prepare = gateway.slice(
      gateway.indexOf("async def prepare_call_greeting"),
      gateway.indexOf("async def warmup_and_queue")
    );
    assert.doesNotMatch(prepare, /await /);
    assert.match(prepare, /return np\.zeros\(0, dtype=np\.int16\), \(cache_key, text\)/);
    assert.doesNotMatch(prepare, /cached_hold_pcm|queue_audio|after_current/);

    const warmup = gateway.slice(
      gateway.indexOf("async def warmup_and_queue"),
      gateway.indexOf("def _encode_wav_sync")
    );
    assert.match(warmup, /tenant_greetings\[cache_key\] = pcm/);
    assert.match(warmup, /track\.queue_greeting\(pcm\)/);
    assert.doesNotMatch(warmup, /after_current/);
    assert.doesNotMatch(warmup, /hold/);

    const offer = gateway.slice(
      gateway.indexOf("async def handle_answer_offer"),
      gateway.indexOf("async def cleanup_call")
    );
    assert.match(offer, /asyncio\.create_task\(warmup_and_queue/);
    assert.doesNotMatch(offer, /await warmup_and_queue/);
    assert.doesNotMatch(offer, /await synthesize_tts_pcm/);
    assert.doesNotMatch(offer, /cached_hold_pcm|NEUTRAL_HOLD|Namaste, one moment/);
    assert.match(gateway, /One moment, let me check the schedule\./);
    assert.doesNotMatch(gateway, /Ji, one moment/);
    assert.doesNotMatch(gateway, /edge_tts|edge-tts|ElevenLabs|elevenlabs/);
  });

  it("ignores caller audio until the greeting has finished plus the tail", () => {
    assert.equal(greetingListenClosed({ greetingReady: false, playedGreeting: false, msAfterGreeting: 1000 }), true);
    assert.equal(greetingListenClosed({ greetingReady: true, playedGreeting: false, msAfterGreeting: 1000 }), true);
    assert.equal(greetingListenClosed({ greetingReady: true, playedGreeting: true, msAfterGreeting: 0 }), true);
    assert.equal(greetingListenClosed({ greetingReady: true, playedGreeting: true, msAfterGreeting: 299 }), true);
    assert.equal(greetingListenClosed({ greetingReady: true, playedGreeting: true, msAfterGreeting: 300 }), false);

    assert.equal(shouldStartCallerTurn({ listenClosed: true, speechFrames: 40, transcript: "I need an appointment" }), false);
    assert.equal(shouldStartCallerTurn({ listenClosed: false, speechFrames: 40, transcript: "I need an appointment" }), true);

    const gateway = fs.readFileSync(path.join(root, "deploy/webrtc-voice-gateway/gateway.py"), "utf8");
    const listener = gateway.slice(
      gateway.indexOf("async def process_inbound_audio"),
      gateway.indexOf("def fix_sdp_candidates")
    );
    const guard = listener.indexOf("listening_closed()");
    const vad = listener.indexOf("vad.is_speech");
    const barge = listener.indexOf("out_track.interrupt(");
    const handle = listener.indexOf("handle_caller_utterance(");
    assert.ok(guard >= 0 && vad > guard && barge > guard && handle > guard);

    const utter = gateway.slice(
      gateway.indexOf("async def handle_caller_utterance"),
      gateway.indexOf("def endpoint_silence_ms")
    );
    const closed = utter.indexOf("listening_closed()");
    const post = utter.indexOf("session.post(");
    assert.ok(closed >= 0 && post > closed);

    const filler = gateway.slice(
      gateway.indexOf("async def play_schedule_filler"),
      gateway.indexOf("def normalize_spoken_language")
    );
    const fillerGuard = filler.indexOf("listening_closed()");
    const fillerQueue = filler.indexOf("queue_audio(");
    assert.ok(fillerGuard >= 0 && fillerQueue > fillerGuard);
  });

  it("drops a short noise burst and an empty or noise transcript before any reply or filler", () => {
    assert.equal(acceptsSpeechFrames(12), false);
    assert.equal(acceptsSpeechFrames(13), true);
    assert.equal(shouldStartCallerTurn({ listenClosed: false, speechFrames: 4 }), false);
    assert.equal(shouldStartCallerTurn({ listenClosed: false, speechFrames: 12, transcript: "hello" }), false);
    assert.equal(shouldStartCallerTurn({ listenClosed: false, speechFrames: 13, transcript: "I need a slot tomorrow" }), true);

    assert.equal(isNoiseTranscript(""), false);
    assert.equal(isNoiseTranscript("   "), false);
    assert.equal(isNoiseTranscript("..."), true);
    assert.equal(isNoiseTranscript("[noise]"), true);
    assert.equal(isNoiseTranscript("uh"), true);
    assert.equal(isNoiseTranscript("background noise"), true);
    assert.equal(isNoiseTranscript("yes"), false);
    assert.equal(isNoiseTranscript("haan"), false);
    assert.equal(isNoiseTranscript("हाँ"), false);
    assert.equal(isNoiseTranscript("Ji, book a slot"), false);

    assert.equal(shouldDropVoiceUtterance("", 0), true);
    assert.equal(shouldDropVoiceUtterance("", 1), true);
    assert.equal(shouldDropVoiceUtterance("", 2), false);
    assert.equal(shouldDropVoiceUtterance("uh", 2), true);
    assert.equal(shouldDropVoiceUtterance("yes", 0), false);

    assert.equal(shouldDropGatewayUtterance("", "", "INQUIRY"), true);
    assert.equal(shouldDropGatewayUtterance("", "I'm sorry, I couldn't hear that clearly.", "INQUIRY"), true);
    assert.equal(shouldDropGatewayUtterance("uh", "One moment, let me check the schedule.", "BOOKING"), true);
    assert.equal(shouldDropGatewayUtterance("", "Please call the clinic.", "TRANSFER"), false);
    assert.equal(shouldDropGatewayUtterance("book a slot", "", "BOOKING"), false);

    assert.equal(shouldStartCallerTurn({ listenClosed: false, speechFrames: 20, transcript: "uh" }), false);
    assert.equal(shouldStartCallerTurn({ listenClosed: false, speechFrames: 20, transcript: "" }), false);
    assert.equal(shouldPlayFiller(fillerTurn({ utteranceDropped: true })), false);
    assert.equal(shouldPlayFiller(fillerTurn()), true);

    const gateway = fs.readFileSync(path.join(root, "deploy/webrtc-voice-gateway/gateway.py"), "utf8");
    for (const token of NOISE_TRANSCRIPT_TOKENS) {
      assert.match(gateway, new RegExp(`"${token}"`));
    }
    assert.match(gateway, /def transcript_is_noise/);
    assert.match(gateway, /def should_drop_utterance/);
    const listener = gateway.slice(
      gateway.indexOf("async def process_inbound_audio"),
      gateway.indexOf("def fix_sdp_candidates")
    );
    const fromMin = listener.slice(listener.indexOf("if speech_frames >= MIN_SPEECH_FRAMES"));
    const dropLog = fromMin.indexOf("Dropped short audio");
    assert.ok(dropLog > 0);
    const shortBranch = fromMin.slice(dropLog, fromMin.indexOf("barge_capture = False", dropLog));
    assert.match(shortBranch, /no reply and no filler/);
    assert.doesNotMatch(shortBranch, /handle_caller_utterance|play_schedule_filler/);

    const utter = gateway.slice(
      gateway.indexOf("async def handle_caller_utterance"),
      gateway.indexOf("def endpoint_silence_ms")
    );
    const drop = utter.indexOf("should_drop_utterance(");
    const fallback = utter.indexOf("couldn't hear that clearly");
    assert.ok(drop > 0 && fallback > drop);
    assert.match(utter, /no reply and no filler/);
    assert.match(utter, /utterance_dropped=bool\(filler_state\.get\("dropped"\)\)|filler_state\["dropped"\] = True/);

    const voice = fs.readFileSync(path.join(root, "server/gemini-voice.ts"), "utf8");
    const handler = voice.slice(
      voice.indexOf("const handleInboundVoiceCall"),
      voice.indexOf('app.post("/api/whatsapp/voice-call"')
    );
    const serverDrop = handler.indexOf("shouldDropVoiceUtterance(");
    const signal = handler.indexOf("signalScheduleLookup()");
    assert.ok(serverDrop > 0 && signal > serverDrop);
    assert.match(handler, /intent: "SILENCE"/);
    assert.doesNotMatch(handler, /100% dead digital silence/);
  });

  it("returns silence for noise and still answers a real sentence without a filler header", async () => {
    const suffix = `${Date.now().toString(36)}gf`;
    const tenantId = `tenant-greet-${suffix}`;
    const phoneNumberId = `1777${suffix.slice(-8)}`;
    seedTenant(tenantId, phoneNumberId, "North Clinic");
    saveWhatsAppTenantVoiceSettings(getDb(), tenantId, {
      receptionistName: "Asha",
      escalationPhone: "+91 98000 22222",
    });
    const previousSecret = process.env.VOICE_GATEWAY_SECRET;
    const previousNode = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.VOICE_GATEWAY_SECRET = "greeting-first-secret";
    const headers = { "X-Voice-Gateway-Secret": "greeting-first-secret" };
    try {
      const noise = await jsonRequest(port, "POST", "/api/voice/inbound", {
        from: "+919800011199",
        message: "uh",
        phoneNumberId,
        callId: `call-noise-${suffix}`,
      }, headers);
      assert.equal(noise.status, 200);
      assert.equal(noise.json.intent, "SILENCE");
      assert.equal(noise.json.speechText, "");
      assert.equal(noise.json.dropped, true);
      assert.equal(noise.headers.get("x-maya-lookup"), null);
      assert.doesNotMatch(String(noise.json.speechText), /one moment|checking|शेड्यूल/i);

      const burst = await jsonRequest(port, "POST", "/api/voice/inbound", {
        from: "+919800011199",
        message: "[background noise]",
        phoneNumberId,
        callId: `call-burst-${suffix}`,
      }, headers);
      assert.equal(burst.status, 200);
      assert.equal(burst.json.intent, "SILENCE");
      assert.equal(burst.json.speechText, "");
      assert.equal(burst.headers.get("x-maya-lookup"), null);

      const empty = await jsonRequest(port, "POST", "/api/voice/inbound", {
        from: "+919800011199",
        message: "",
        phoneNumberId,
        callId: `call-empty-${suffix}`,
      }, headers);
      assert.equal(empty.status, 200);
      assert.equal(empty.json.intent, "SILENCE");
      assert.equal(empty.json.speechText, "");
      assert.equal(empty.headers.get("x-maya-lookup"), null);

      const yes = await jsonRequest(port, "POST", "/api/voice/inbound", {
        from: "+919800011199",
        message: "yes",
        phoneNumberId,
        callId: `call-yes-${suffix}`,
      }, headers);
      assert.equal(yes.status, 200);
      assert.notEqual(yes.json.intent, "SILENCE");
      assert.match(String(yes.json.speechText), /Asha|North Clinic/);
      assert.equal(yes.headers.get("x-maya-lookup"), null);
      assert.doesNotMatch(String(yes.json.speechText), /One moment, let me check the schedule/);

      const timings = await jsonRequest(port, "POST", "/api/voice/inbound", {
        from: "+919800011188",
        message: "what are your timings",
        phoneNumberId,
        callId: `call-time-${suffix}`,
      }, headers);
      assert.equal(timings.status, 200);
      assert.equal(timings.headers.get("x-maya-lookup"), "1");
      assert.notEqual(String(timings.json.speechText || ""), "");

      const third = await jsonRequest(port, "POST", "/api/voice/inbound", {
        from: "+919800011177",
        message: "",
        phoneNumberId,
        callId: `call-third-${suffix}`,
        conversationHistory: [
          { role: "maya", text: "I'm sorry, I couldn't hear that clearly. Could you please repeat?" },
          { role: "maya", text: "I'm sorry, I couldn't hear that clearly. Could you please repeat?" },
        ],
      }, headers);
      assert.equal(third.status, 200);
      assert.equal(third.json.intent, "TRANSFER");
      assert.match(String(third.json.speechText), /98000 22222/);
      assert.equal(third.headers.get("x-maya-lookup"), null);
    } finally {
      if (previousSecret === undefined) delete process.env.VOICE_GATEWAY_SECRET;
      else process.env.VOICE_GATEWAY_SECRET = previousSecret;
      if (previousNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNode;
    }
  });
});

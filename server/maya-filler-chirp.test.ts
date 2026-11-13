import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MAYA_FILLER_DELAY_MS, MAYA_FILLER_LINES, shouldPlayFiller, voiceTurnNeedsScheduleLookup, type FillerTurnInput } from "./voice-filler.ts";
import {
  cloudTtsSynthesizeRequest,
  cloudTtsVoice,
  resetCloudTtsVoicePinsForTests,
  synthesizeCloudTts,
  synthesizeCloudTtsDetailed,
} from "./voice-tts.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function turn(overrides: Partial<FillerTurnInput> = {}): FillerTurnInput {
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

describe("Maya schedule filler and Chirp 3 HD voice", () => {
  const envSnapshot = {
    MAYA_TTS_OFFLINE: process.env.MAYA_TTS_OFFLINE,
    MAYA_TTS_VOICE_EN: process.env.MAYA_TTS_VOICE_EN,
    MAYA_TTS_VOICE_HI: process.env.MAYA_TTS_VOICE_HI,
    MAYA_TTS_VOICE_MR: process.env.MAYA_TTS_VOICE_MR,
  };

  after(() => {
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetCloudTtsVoicePinsForTests();
  });

  it("plays no filler on a fast reply and one filler on a slow lookup", () => {
    assert.equal(shouldPlayFiller(turn({ elapsedMs: 800, replyStarted: true })), false);
    assert.equal(shouldPlayFiller(turn({ elapsedMs: 1100 })), false);
    assert.equal(shouldPlayFiller(turn({ elapsedMs: 2000, lookup: false })), false);
    assert.equal(shouldPlayFiller(turn({ elapsedMs: MAYA_FILLER_DELAY_MS })), true);
    assert.equal(shouldPlayFiller(turn({ elapsedMs: 1600, replyStarted: true })), false);
    assert.equal(shouldPlayFiller(turn({ bargeIn: true })), false);
    assert.equal(shouldPlayFiller(turn({ trackSpeaking: true })), false);
    assert.equal(shouldPlayFiller(turn({ callerSpeaking: true })), false);

    const slowLookup = turn({ elapsedMs: 1500 });
    assert.equal(shouldPlayFiller(slowLookup), true);
    assert.equal(shouldPlayFiller({ ...slowLookup, alreadyPlayedThisTurn: true }), false);
    assert.equal(shouldPlayFiller({ ...slowLookup, playedOnPreviousTurn: true }), false);
    assert.equal(shouldPlayFiller(turn({ elapsedMs: 1500, playedOnPreviousTurn: false })), true);

    assert.equal(MAYA_FILLER_LINES.en, "One moment, let me check the schedule.");
    assert.doesNotMatch(MAYA_FILLER_LINES.en, /\bJi\b/);
    assert.match(MAYA_FILLER_LINES.hi, /^[\u0900-\u097F]/);
    assert.match(MAYA_FILLER_LINES.mr, /^[\u0900-\u097F]/);
    assert.doesNotMatch(MAYA_FILLER_LINES.hi, /^जी/);
    assert.equal(MAYA_FILLER_DELAY_MS >= 1200 && MAYA_FILLER_DELAY_MS <= 1500, true);

    assert.equal(voiceTurnNeedsScheduleLookup({ message: "Where is the clinic located?", intent: "LOCATION", wantsBooking: false }), false);
    assert.equal(voiceTurnNeedsScheduleLookup({ message: "thank you", intent: "INQUIRY", wantsBooking: false }), false);
    assert.equal(voiceTurnNeedsScheduleLookup({ message: "Please book an appointment tomorrow", intent: "INQUIRY", wantsBooking: true }), true);
    assert.equal(voiceTurnNeedsScheduleLookup({ message: "what are your timings", intent: "TIMINGS", wantsBooking: false }), true);
    assert.equal(voiceTurnNeedsScheduleLookup({ message: "अपॉइंटमेंट चाहिए", intent: "INQUIRY", wantsBooking: false }), true);
  });

  it("keeps the gateway from playing a filler after every utterance", () => {
    const gateway = fs.readFileSync(path.join(root, "deploy/webrtc-voice-gateway/gateway.py"), "utf8");
    const voice = fs.readFileSync(path.join(root, "server/gemini-voice.ts"), "utf8");
    assert.match(gateway, /One moment, let me check the schedule\./);
    assert.match(gateway, /एक पल, मैं शेड्यूल देख रही हूँ।/);
    assert.match(gateway, /एक क्षण, मी शेड्यूल बघते\./);
    assert.match(gateway, /FILLER_DELAY_S = 1\.35/);
    assert.match(gateway, /def filler_should_play/);
    assert.match(gateway, /X-Maya-Lookup/);
    assert.match(gateway, /fillerPlayedLastTurn/);
    assert.match(gateway, /reply_started/);
    assert.match(gateway, /barge_in/);
    assert.doesNotMatch(gateway, /Ji, one moment/);
    assert.doesNotMatch(gateway, /Play instant conversational filler/);
    assert.doesNotMatch(gateway, /edge_tts|edge-tts|ElevenLabs|elevenlabs/);
    const booking = voice.indexOf("if (wantsBooking)");
    const signal = voice.indexOf("signalScheduleLookup()", booking);
    const slot = voice.indexOf("findNextBookableSlot", booking);
    assert.ok(booking > 0 && signal > booking && signal < slot);
  });

  it("selects Chirp 3 HD per language and omits pitch from the Chirp request", () => {
    assert.deepEqual(cloudTtsVoice("en", {}), { languageCode: "en-IN", name: "en-IN-Chirp3-HD-Aoede" });
    assert.deepEqual(cloudTtsVoice("hi", {}), { languageCode: "hi-IN", name: "hi-IN-Chirp3-HD-Aoede" });
    assert.deepEqual(cloudTtsVoice("mr", {}), { languageCode: "mr-IN", name: "mr-IN-Chirp3-HD-Aoede" });
    const chirp = cloudTtsSynthesizeRequest("One moment, let me check the schedule.", {
      languageCode: "en-IN",
      name: "en-IN-Chirp3-HD-Aoede",
    });
    assert.deepEqual(chirp.input, { text: "One moment, let me check the schedule." });
    assert.equal("ssml" in chirp.input, false);
    assert.deepEqual(chirp.audioConfig, { audioEncoding: "MP3" });
    assert.equal("pitch" in chirp.audioConfig, false);
    assert.equal("speakingRate" in chirp.audioConfig, false);
    const wave = cloudTtsSynthesizeRequest("Hello", { languageCode: "hi-IN", name: "hi-IN-Wavenet-A" });
    assert.equal(wave.audioConfig.pitch, 0);
    assert.equal(wave.audioConfig.speakingRate, 0.98);
    assert.equal("ssml" in wave.input, false);
  });

  it("falls back to WaveNet when Chirp fails and does not switch again on that call", async () => {
    resetCloudTtsVoicePinsForTests();
    delete process.env.MAYA_TTS_VOICE_EN;
    delete process.env.MAYA_TTS_VOICE_HI;
    delete process.env.MAYA_TTS_VOICE_MR;
    delete process.env.MAYA_TTS_OFFLINE;
    const voices: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("metadata.google.internal")) {
        return new Response(JSON.stringify({ access_token: "test-token" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const body = JSON.parse(String(init?.body || "{}")) as { voice?: { name?: string }; audioConfig?: { pitch?: number }; input?: { ssml?: string } };
      const name = String(body.voice?.name || "");
      voices.push(name);
      assert.equal(body.input?.ssml, undefined);
      if (name.includes("Chirp3-HD")) {
        assert.equal(body.audioConfig?.pitch, undefined);
        return new Response("chirp unavailable", { status: 400 });
      }
      return new Response(JSON.stringify({ audioContent: "V0FW" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const first = await synthesizeCloudTtsDetailed(`fallback ${Date.now()}`, "en", "call-fallback");
      assert.equal(first.voice.name, "en-IN-Wavenet-D");
      assert.equal(first.audio, "V0FW");
      assert.deepEqual(voices.slice(0, 2), ["en-IN-Chirp3-HD-Aoede", "en-IN-Wavenet-D"]);
      voices.length = 0;
      const second = await synthesizeCloudTtsDetailed(`fallback-again ${Date.now()}`, "en", "call-fallback");
      assert.equal(second.voice.name, "en-IN-Wavenet-D");
      assert.equal(second.audio, "V0FW");
      assert.deepEqual(voices, ["en-IN-Wavenet-D"]);
      voices.length = 0;
      const hindi = await synthesizeCloudTtsDetailed(`fallback-hi ${Date.now()}`, "hi", "call-fallback");
      assert.equal(hindi.voice.name, "hi-IN-Wavenet-A");
      assert.equal(voices[0], "hi-IN-Chirp3-HD-Aoede");
    } finally {
      globalThis.fetch = originalFetch;
      resetCloudTtsVoicePinsForTests();
      process.env.MAYA_TTS_OFFLINE = "1";
    }
  });

  it("keeps a successful Chirp voice for the rest of the call when a later synth fails", async () => {
    resetCloudTtsVoicePinsForTests();
    delete process.env.MAYA_TTS_OFFLINE;
    const voices: string[] = [];
    let failChirp = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("metadata.google.internal")) {
        return new Response(JSON.stringify({ access_token: "test-token" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const body = JSON.parse(String(init?.body || "{}")) as { voice?: { name?: string } };
      const name = String(body.voice?.name || "");
      voices.push(name);
      if (name.includes("Chirp3-HD") && failChirp) return new Response("later failure", { status: 503 });
      if (name.includes("Wavenet")) return new Response(JSON.stringify({ audioContent: "V0FW" }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ audioContent: "Q0hJUlA=" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const first = await synthesizeCloudTtsDetailed(`chirp-ok ${Date.now()}`, "mr", "call-sticky");
      assert.equal(first.voice.name, "mr-IN-Chirp3-HD-Aoede");
      assert.equal(first.audio, "Q0hJUlA=");
      failChirp = true;
      voices.length = 0;
      const later = await synthesizeCloudTtsDetailed(`chirp-later ${Date.now()}`, "mr", "call-sticky");
      assert.equal(later.audio, null);
      assert.equal(later.voice.name, "mr-IN-Chirp3-HD-Aoede");
      assert.deepEqual(voices, ["mr-IN-Chirp3-HD-Aoede"]);
      assert.equal(await synthesizeCloudTts("", "en", "call-sticky"), null);
    } finally {
      globalThis.fetch = originalFetch;
      resetCloudTtsVoicePinsForTests();
      process.env.MAYA_TTS_OFFLINE = "1";
    }
  });
});

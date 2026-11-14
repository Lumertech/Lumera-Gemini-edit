import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { GoogleGenAI } from "@google/genai";
import { getDb, initDatabase } from "./db.ts";
import { mountGeminiVoiceRoutes, runGeminiVoiceReceptionist } from "./gemini-voice.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { saveWhatsAppTenantVoiceSettings } from "./whatsapp-numbers-store.ts";
import { mayaSpokenLanguage } from "./voice-tts.ts";
import {
  assessCallerLanguage,
  isAmbiguousLanguageTurn,
  mayaLockedLanguageInstruction,
  resolveMayaCallLanguage,
  speechConflictsWithLockedLanguage,
  speechMissesCallLanguage,
  type MayaCallLanguage,
  type MayaLanguageTurn,
} from "./voice-language-lock.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function walk(turns: Array<{ text: string; hint?: string }>, greeting?: "en" | "hi" | "mr"): MayaCallLanguage {
  let history: MayaLanguageTurn[] = [];
  let state = resolveMayaCallLanguage({ greeting, history, currentText: "" });
  for (const turn of turns) {
    state = resolveMayaCallLanguage({
      greeting,
      history,
      currentText: turn.text,
      currentHint: turn.hint,
    });
    history = [...history, { role: "caller", text: turn.text }];
  }
  return state;
}

describe("Maya call language lock", () => {
  it("keeps the per-utterance voice choice and does not let one hint decide the call", () => {
    assert.equal(mayaSpokenLanguage("appointment chahiye", "", "hi"), "hi");
    assert.equal(mayaSpokenLanguage("doktor pahije", "mr"), "mr");
    assert.equal(mayaSpokenLanguage("I need a slot", "en"), "en");
    assert.equal(mayaSpokenLanguage("வணக்கம்", "ta", "ta"), "en");
    assert.equal(mayaSpokenLanguage("haan", "hinglish"), "hi");
    assert.equal(assessCallerLanguage("appointment chahiye", "hinglish"), null);
    assert.equal(assessCallerLanguage("haan", "hi"), null);
    assert.equal(assessCallerLanguage("नमस्ते", "hi"), null);
    assert.equal(isAmbiguousLanguageTurn("प्रिया शर्मा"), true);
    assert.equal(isAmbiguousLanguageTurn("Dr Meera Shah"), true);
    assert.equal(isAmbiguousLanguageTurn("haan"), true);
    assert.equal(isAmbiguousLanguageTurn("10:30"), true);
    assert.equal(isAmbiguousLanguageTurn("कल सुबह 10:30 बजे"), true);
    assert.equal(isAmbiguousLanguageTurn("Hindi mein baat karo"), false);

    const voice = fs.readFileSync(path.join(root, "server/gemini-voice.ts"), "utf8");
    assert.match(voice, /mayaLockedLanguageInstruction\(priorLanguage\.language, priorLanguage\.locked\)/);
    assert.match(voice, /replyLanguage: spoken/);
    assert.match(voice, /spokenLanguage: spoken/);
    assert.doesNotMatch(voice, /edge_tts|edge-tts|Neural2/);
    const gateway = fs.readFileSync(path.join(root, "deploy/webrtc-voice-gateway/gateway.py"), "utf8");
    assert.match(gateway, /data\.get\("ttsLanguage"\)/);
    assert.match(gateway, /\["spokenLanguage"\] = spoken/);
    assert.match(mayaLockedLanguageInstruction("en", true), /LOCKED CALL LANGUAGE: English/);
    assert.match(mayaLockedLanguageInstruction("hi", true), /LOCKED CALL LANGUAGE: Hindi/);
    assert.match(mayaLockedLanguageInstruction("mr", true), /LOCKED CALL LANGUAGE: Marathi/);
    assert.match(mayaLockedLanguageInstruction("en", true), /Hindi mein baat karo/);
    assert.match(mayaLockedLanguageInstruction("en", true), /Marathi madhe bola/);
    assert.match(mayaLockedLanguageInstruction("en", true), /speak English/);
    assert.match(mayaLockedLanguageInstruction("en", true), /Chirp 3 HD/);
    assert.match(mayaLockedLanguageInstruction("hi", false), /Chirp 3 HD/);
    assert.equal(isAmbiguousLanguageTurn("okay"), true);
    assert.equal(isAmbiguousLanguageTurn("doctor"), true);
    assert.equal(isAmbiguousLanguageTurn("appointment"), true);
    assert.equal(isAmbiguousLanguageTurn("okay doctor appointment"), true);
  });

  it("locks from the first clear utterance and ignores names, haan, Hinglish, and one Devanagari word", () => {
    const english = walk([
      { text: "I need an appointment please" },
      { text: "प्रिया शर्मा", hint: "hi" },
      { text: "haan", hint: "hinglish" },
      { text: "नमस्ते", hint: "Hindi" },
      { text: "appointment chahiye", hint: "hinglish" },
      { text: "Dr Meera" },
      { text: "10:30" },
    ]);
    assert.equal(english.language, "en");
    assert.equal(english.locked, true);
    assert.equal(english.pendingCount, 0);

    const hindi = walk([
      { text: "मुझे अपॉइंटमेंट चाहिए। मेरा नाम रवि है।" },
      { text: "10:30" },
      { text: "9876543210" },
      { text: "रवि" },
      { text: "Dr Meera Shah" },
      { text: "haan", hint: "en" },
      { text: "कल सुबह 10:30 बजे" },
    ]);
    assert.equal(hindi.language, "hi");
    assert.equal(hindi.locked, true);

    const greeting = walk([{ text: "haan", hint: "hinglish" }], "mr");
    assert.equal(greeting.language, "mr");
    assert.equal(greeting.locked, false);
    const thenEnglish = walk([{ text: "haan" }, { text: "I need a doctor tomorrow" }], "mr");
    assert.equal(thenEnglish.language, "en");
    assert.equal(thenEnglish.locked, true);
  });

  it("switches on an explicit request or one clear sentence, and ignores loanwords and mixed Hinglish", () => {
    assert.equal(walk([{ text: "I need an appointment" }, { text: "Hindi mein baat karo" }]).language, "hi");
    assert.equal(walk([{ text: "मुझे डॉक्टर चाहिए" }, { text: "speak English" }]).language, "en");
    assert.equal(walk([{ text: "I need an appointment" }, { text: "Marathi madhe bola" }]).language, "mr");
    assert.equal(walk([{ text: "I don't speak Hindi" }]).language, "en");

    const oneMarathi = walk([
      { text: "I need an appointment" },
      { text: "मला उद्या डॉक्टरकडे दाखवायचे आहे" },
    ]);
    assert.equal(oneMarathi.language, "mr");
    assert.equal(oneMarathi.pendingLanguage, null);
    assert.equal(oneMarathi.pendingCount, 0);

    const oneHindi = walk([
      { text: "I need an appointment" },
      { text: "मुझे कल डॉक्टर के पास जाना है" },
    ]);
    assert.equal(oneHindi.language, "hi");
    assert.equal(oneHindi.pendingCount, 0);

    const backToEnglish = walk([
      { text: "I need an appointment" },
      { text: "मला उद्या डॉक्टरकडे दाखवायचे आहे" },
      { text: "I need the clinic address please" },
    ]);
    assert.equal(backToEnglish.language, "en");
    assert.equal(backToEnglish.pendingCount, 0);

    const loanwords = walk([
      { text: "I need an appointment please" },
      { text: "okay" },
      { text: "doctor" },
      { text: "appointment" },
      { text: "okay doctor appointment" },
    ]);
    assert.equal(loanwords.language, "en");
    assert.equal(loanwords.locked, true);

    const hinglish = walk([
      { text: "I need an appointment please" },
      { text: "mujhe kal doctor chahiye but I need the address please" },
    ]);
    assert.equal(hinglish.language, "en");
    assert.equal(hinglish.pendingLanguage, null);

    assert.equal(speechConflictsWithLockedLanguage("Thank you, प्रिया शर्मा. What date and time should I book?", "en"), false);
    assert.equal(speechConflictsWithLockedLanguage("माफ़ कीजिए, मुझे आपकी आवाज़ साफ़ नहीं आई। क्या आप दोबारा बोलेंगे?", "en"), true);
    assert.equal(speechConflictsWithLockedLanguage("May I have the patient's name for the appointment?", "hi"), true);
    assert.equal(speechConflictsWithLockedLanguage("अपॉइंटमेंट के लिए मरीज का नाम बता दीजिए।", "hi"), false);
    assert.equal(speechConflictsWithLockedLanguage("अपॉइंटमेंटसाठी रुग्णाचे नाव सांगा.", "mr"), false);
    assert.equal(speechConflictsWithLockedLanguage("अपॉइंटमेंट के लिए मरीज का नाम बता दीजिए।", "mr"), true);
    assert.equal(speechMissesCallLanguage("How can I help you?", "hi"), true);
    assert.equal(speechMissesCallLanguage("धन्यवाद, रवि। कौन सी तारीख और कौन सा समय चाहिए?", "hi"), false);
    assert.equal(speechMissesCallLanguage("How can I help you?", "en"), false);
  });
});

describe("Maya call language on a voice session", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  let phoneNumberId = "";
  const envSnapshot = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
    VOICE_GATEWAY_SECRET: process.env.VOICE_GATEWAY_SECRET,
    MAYA_DEMO_MODE: process.env.MAYA_DEMO_MODE,
    MAYA_TTS_OFFLINE: process.env.MAYA_TTS_OFFLINE,
  };
  const headers = { "X-Voice-Gateway-Secret": "maya-language-lock-secret" };

  before(async () => {
    process.env.MAYA_TTS_OFFLINE = "1";
    delete process.env.MAYA_DEMO_MODE;
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "maya-language-lock-jwt-secret";
    initDatabase();
    process.env.NODE_ENV = "production";
    process.env.VOICE_GATEWAY_SECRET = "maya-language-lock-secret";
    const suffix = `${Date.now().toString(36)}lang`;
    const tenantId = `tenant-lang-${suffix}`;
    phoneNumberId = `1777${suffix.slice(-8)}`;
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, phone_number_id, created_at, updated_at)
         VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+919811122233', ?, 500, 0, 1, '', ?, ?, ?)`
      )
      .run(tenantId, "Language Clinic", now, phoneNumberId, now, now);
    saveWhatsAppTenantVoiceSettings(getDb(), tenantId, { escalationPhone: "+91 98000 33333", receptionistName: "Maya" });
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

  function assertSpoken(json: Record<string, unknown>, language: "en" | "hi" | "mr") {
    const voices = {
      en: { ttsLanguage: "en-IN", ttsVoice: "en-IN-Chirp3-HD-Aoede" },
      hi: { ttsLanguage: "hi-IN", ttsVoice: "hi-IN-Chirp3-HD-Aoede" },
      mr: { ttsLanguage: "mr-IN", ttsVoice: "mr-IN-Chirp3-HD-Aoede" },
    };
    const speech = String(json.speechText || "");
    assert.equal(json.spokenLanguage, language, speech);
    assert.equal(json.ttsLanguage, voices[language].ttsLanguage, speech);
    assert.equal(json.ttsVoice, voices[language].ttsVoice, speech);
    assert.equal(speechConflictsWithLockedLanguage(speech, language), false, speech);
    if (language === "en") {
      assert.match(speech, /[A-Za-z]{4}/);
      assert.doesNotMatch(speech, /मरीज का नाम|कौन सी तारीख|रुग्णाचे नाव|कोणती तारीख/);
    } else if (language === "hi") {
      assert.match(speech, /[\u0900-\u097F]/);
      assert.doesNotMatch(speech, /May I have the patient's name|What date and time should I book|Shall I book this|I'll continue in English/);
    } else {
      assert.match(speech, /आहे|नाही|झाले|मला|नमस्कार|रुग्ण|मी /);
      assert.doesNotMatch(speech, /May I have the patient's name|What date and time should I book|मरीज का नाम/);
    }
  }

  async function call(from: string, message: string, state: { history: Array<{ role: string; text: string }>; draft: unknown }, extra: Record<string, unknown> = {}) {
    const response = await jsonRequest(port, "POST", "/api/voice/inbound", {
      from,
      callerName: "Patient",
      message,
      phoneNumberId,
      conversationHistory: state.history,
      bookingDraft: state.draft,
      ...extra,
    }, headers);
    assert.equal(response.status, 200, JSON.stringify(response.json));
    if (message) state.history.push({ role: "caller", text: message });
    if (response.json.speechText) state.history.push({ role: "maya", text: String(response.json.speechText) });
    if ("bookingDraft" in response.json) state.draft = response.json.bookingDraft;
    return response.json;
  }

  it("keeps an English call in English through a Hindi name, haan, and a Hinglish hint", async () => {
    const state = { history: [] as Array<{ role: string; text: string }>, draft: null as unknown };
    const from = "+919710000001";
    assertSpoken(await call(from, "I need an appointment please", state), "en");
    assertSpoken(await call(from, "प्रिया शर्मा", state, { language: "Hindi" }), "en");
    assertSpoken(await call(from, "haan", state, { language: "Hinglish" }), "en");
    assertSpoken(await call(from, "नमस्ते", state, { language: "hi" }), "en");
    assertSpoken(await call(from, "appointment chahiye", state, { language: "hinglish" }), "en");
  });

  it("keeps a Hindi call in Hindi through numbers, a doctor name, and haan", async () => {
    const state = { history: [] as Array<{ role: string; text: string }>, draft: null as unknown };
    const from = "+919710000002";
    assertSpoken(await call(from, "मुझे अपॉइंटमेंट चाहिए। मेरा नाम रवि है।", state, { language: "Hindi" }), "hi");
    assert.match(String(state.history.at(-1)?.text), /रवि/);
    assert.doesNotMatch(String(state.history.at(-1)?.text), /मरीज का नाम/);
    assertSpoken(await call(from, "10:30", state), "hi");
    assertSpoken(await call(from, "Dr Meera", state, { language: "en" }), "hi");
    assertSpoken(await call(from, "haan", state, { language: "English" }), "hi");
  });

  it("switches on an explicit request or one clear sentence, and keeps the Chirp 3 HD voice", async () => {
    const asked = { history: [] as Array<{ role: string; text: string }>, draft: null as unknown };
    const from = "+919710000003";
    const english = await call(from, "I need an appointment please", asked);
    assertSpoken(english, "en");
    const hindi = await call(from, "Hindi mein baat karo", asked);
    assertSpoken(hindi, "hi");
    assert.equal(String(hindi.ttsVoice).split("-Chirp3-HD-")[1], String(english.ttsVoice).split("-Chirp3-HD-")[1]);
    assertSpoken(await call(from, "okay", asked), "hi");
    assertSpoken(await call(from, "doctor", asked), "hi");
    assertSpoken(await call(from, "speak English", asked), "en");

    const marathi = { history: [] as Array<{ role: string; text: string }>, draft: null as unknown };
    const other = "+919710000004";
    assertSpoken(await call(other, "I need an appointment please", marathi), "en");
    assertSpoken(await call(other, "appointment", marathi), "en");
    const switched = await call(other, "मला उद्या डॉक्टरकडे दाखवायचे आहे", marathi, { language: "mr" });
    assertSpoken(switched, "mr");
    assert.equal(switched.ttsVoice, "mr-IN-Chirp3-HD-Aoede");
    assert.equal(String(switched.ttsVoice).split("-Chirp3-HD-")[1], String(english.ttsVoice).split("-Chirp3-HD-")[1]);
    assertSpoken(await call(other, "okay doctor appointment", marathi), "mr");
    assertSpoken(await call(other, "mujhe kal doctor chahiye but I need the address please", marathi), "mr");
  });

  it("starts from the clinic greeting language, then locks the caller's first clear sentence", async () => {
    const state = { history: [] as Array<{ role: string; text: string }>, draft: null as unknown };
    const from = "+919710000005";
    assertSpoken(await call(from, "haan", state, { clinicLanguage: "mr", language: "Hinglish" }), "mr");
    assertSpoken(await call(from, "I need an appointment please", state), "en");
  });

  it("tells Gemini the locked language and does not speak a mismatched reply", async () => {
    const prompts: string[] = [];
    const misleading = {
      models: {
        generateContent: async (params: { contents?: Array<{ text?: string }> }) => {
          prompts.push(JSON.stringify(params));
          return {
            text: JSON.stringify({
              speechText: "क्लिनिक का पता मैं हिंदी में बता रही हूँ और यह पूरा वाक्य देवनागरी में है।",
              language: "hi",
              intent: "LOCATION",
              suggestedAction: "Answered in Hindi",
            }),
          };
        },
      },
    } as unknown as GoogleGenAI;
    const server = await startTestServer((app) => {
      mountGeminiVoiceRoutes(app, () => misleading);
    });
    try {
      const response = await jsonRequest(server.port, "POST", "/api/voice/inbound", {
        from: "+919710000006",
        callerName: "Patient",
        message: "Where is the clinic located?",
        phoneNumberId,
        language: "Hinglish",
      }, headers);
      assert.equal(response.status, 200);
      assertSpoken(response.json, "en");
      assert.match(prompts.join("\n"), /LOCKED CALL LANGUAGE: English/);
      assert.match(String(response.json.speechText), /English/);
    } finally {
      await server.close();
    }
  });

  it("puts the locked language in the receptionist prompt for a Hindi call", async () => {
    const prompts: string[] = [];
    const result = await runGeminiVoiceReceptionist({
      message: "Where is the clinic located?",
      callerName: "Patient",
      callerPhone: "+919710000007",
      replyLanguage: "hi",
      tenantId: "tenant-lumera-main",
      getGenAI: () => ({
        models: {
          generateContent: async (params: { contents?: Array<{ text?: string }> }) => {
            prompts.push(JSON.stringify(params));
            return { text: JSON.stringify({ speechText: "पता फ्रंट डेस्क पर मिलेगा।", suggestedAction: "Address" }) };
          },
        },
      } as unknown as GoogleGenAI),
    });
    assert.match(prompts.join("\n"), /LOCKED CALL LANGUAGE: Hindi/);
    assert.match(result.speechText, /पता/);
    assert.equal(speechConflictsWithLockedLanguage(result.speechText, "hi"), false);
  });
});

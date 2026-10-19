import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { GoogleGenAI } from "@google/genai";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { setVertexClientForTests, vertexGeminiModel } from "./vertex-gemini.ts";
import { installWhatsAppRouterPatch } from "./whatsapp-dashboard-guard.ts";
import { createWhatsAppRouter } from "./whatsapp.ts";

const PATIENT = "Asha Nair";
const QUESTION = "hello there, just saying hi";
const MODEL_TEXT = "VERTEX_ONLY_REPLY";

function seedDoctor() {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-wa-vertex-${suffix}`;
  const userId = `user-wa-vertex-${suffix}`;
  const email = `wa.vertex.${suffix}@vertex-fallback.example`.toLowerCase();
  const phone = `+91${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', ?, ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Vertex ${suffix}`, phone, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(userId, tenantId, email, hashPassword("Lumera@2026"), "Dr Vertex", phone, `Clinic ${suffix}`, now, now);
  return { email, phone: `+9198${suffix.replace(/\W/g, "").slice(0, 8)}` };
}

describe("WhatsApp bot fallback uses Vertex", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  let token = "";
  let patientPhone = "";
  let modelCalls = 0;
  let seenModel = "";

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const doctor = seedDoctor();
    patientPhone = doctor.phone;
    installWhatsAppRouterPatch();
    const server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
      app.use("/api/whatsapp", createWhatsAppRouter());
    });
    port = server.port;
    close = server.close;
    const login = await jsonRequest(port, "POST", "/api/auth/login", {
      email: doctor.email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(login.status, 200, String(login.json.error || ""));
    token = String(login.json.token || "");
  });

  after(async () => {
    setVertexClientForTests(undefined);
    await close?.();
  });

  it("calls vertexGenerateContent with the pinned model and returns that text", async () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "whatsapp.ts"), "utf8");
    const start = src.indexOf("General Clinical or Query");
    const end = src.indexOf("function detectLanguageSimple");
    const slice = src.slice(start, end);
    assert.match(slice, /vertexGenerateContent\(/);
    assert.equal(slice.includes("gemini-2.5"), false);
    assert.equal(slice.includes("GEMINI_API_KEY"), false);
    assert.equal(slice.includes("generativelanguage"), false);
    assert.equal(/new GoogleGenAI/.test(slice), false);

    modelCalls = 0;
    seenModel = "";
    setVertexClientForTests({
      models: {
        generateContent: async (params: { model?: string }) => {
          modelCalls += 1;
          seenModel = String(params.model || "");
          return { text: MODEL_TEXT };
        },
      },
    } as unknown as GoogleGenAI);

    const res = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/send",
      { patientPhone, patientName: PATIENT, sender: "user", content: QUESTION },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.equal(modelCalls, 1);
    assert.equal(seenModel, vertexGeminiModel());
    assert.equal((res.json.botReply as { content?: string } | undefined)?.content, MODEL_TEXT);
  });

  it("returns the non-AI fallback and no model text when Vertex is unset", async () => {
    const before = modelCalls;
    setVertexClientForTests(null);
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map((part) => String(part)).join(" "));
    };
    try {
      const res = await jsonRequest(
        port,
        "POST",
        "/api/whatsapp/send",
        { patientPhone, patientName: PATIENT, sender: "user", content: QUESTION },
        { Authorization: `Bearer ${token}` }
      );
      assert.equal(res.status, 201, JSON.stringify(res.json));
      const content = String((res.json.botReply as { content?: string } | undefined)?.content || "");
      assert.match(content, new RegExp(`Namaste ${PATIENT}`));
      assert.equal(content.includes(QUESTION), false);
      assert.equal(content.includes(MODEL_TEXT), false);
      assert.equal(modelCalls, before);
      const logged = warns.filter((line) => line.includes("whatsapp.gemini.fallback")).join("\n");
      assert.match(logged, /whatsapp\.gemini\.fallback Error/);
      assert.equal(logged.includes(PATIENT), false);
      assert.equal(logged.includes(QUESTION), false);
    } finally {
      console.warn = original;
      setVertexClientForTests(undefined);
    }
  });

  it("returns the fixed non-AI reply when the Vertex fallback call errors", async () => {
    setVertexClientForTests({
      models: {
        generateContent: async () => {
          const err = new Error(`phi leak ${QUESTION}`);
          err.name = "ForcedVertexError";
          throw err;
        },
      },
    } as unknown as GoogleGenAI);
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map((part) => String(part)).join(" "));
    };
    try {
      const res = await jsonRequest(
        port,
        "POST",
        "/api/whatsapp/send",
        { patientPhone, patientName: PATIENT, sender: "user", content: QUESTION },
        { Authorization: `Bearer ${token}` }
      );
      assert.equal(res.status, 201, JSON.stringify(res.json));
      const content = String((res.json.botReply as { content?: string } | undefined)?.content || "");
      assert.match(content, /Namaste /);
      assert.equal(content.includes(QUESTION), false);
      assert.equal(content.includes(MODEL_TEXT), false);
      const logged = warns.filter((line) => line.includes("whatsapp.gemini.fallback")).join("\n");
      assert.match(logged, /whatsapp\.gemini\.fallback ForcedVertexError/);
      assert.equal(logged.includes(QUESTION), false);
      assert.equal(logged.includes(PATIENT), false);
    } finally {
      console.warn = original;
      setVertexClientForTests(undefined);
    }
  });

  it("sends voice audio through the Vertex client and fails closed when it errors", async () => {
    let calls = 0;
    setVertexClientForTests({
      models: {
        generateContent: async () => {
          calls += 1;
          return {
            text: JSON.stringify({
              transcription: "VERTEX_TRANSCRIPT",
              englishTranslation: "VERTEX_TRANSCRIPT",
              detectedLanguage: "en",
              clinicalSummary: "summary",
              symptoms: [],
              patientIntent: "consultation",
            }),
          };
        },
      },
    } as unknown as GoogleGenAI);
    const ok = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/voice-process",
      { audioBase64: "AAAA", mimeType: "audio/webm" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(calls, 1);
    assert.equal(ok.json.transcription, "VERTEX_TRANSCRIPT");

    setVertexClientForTests({
      models: {
        generateContent: async () => {
          calls += 1;
          const err = new Error("audio phi SECRET_AUDIO");
          err.name = "ForcedVoiceError";
          throw err;
        },
      },
    } as unknown as GoogleGenAI);
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map((part) => String(part)).join(" "));
    };
    try {
      const failed = await jsonRequest(
        port,
        "POST",
        "/api/whatsapp/voice-process",
        { audioBase64: "AAAA", mimeType: "audio/webm" },
        { Authorization: `Bearer ${token}` }
      );
      assert.equal(failed.status, 503);
      assert.equal(failed.json.message, "AI transcription is temporarily unavailable");
      assert.equal(JSON.stringify(failed.json).includes("SECRET_AUDIO"), false);
      assert.equal(JSON.stringify(failed.json).includes("VERTEX_TRANSCRIPT"), false);
      assert.equal(JSON.stringify(failed.json).includes("back pain"), false);
      assert.equal(calls, 2);
      const logged = warns.join("\n");
      assert.match(logged, /ForcedVoiceError/);
      assert.equal(logged.includes("SECRET_AUDIO"), false);
    } finally {
      console.warn = original;
      setVertexClientForTests(undefined);
    }
  });

  it("translates through the Vertex client and uses fixed text when it errors", async () => {
    const secret = "SECRET_TRANSLATE_PHI";
    let calls = 0;
    setVertexClientForTests({
      models: {
        generateContent: async () => {
          calls += 1;
          return { text: "VERTEX_TRANSLATION" };
        },
      },
    } as unknown as GoogleGenAI);
    const ok = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/translate",
      { text: `hello ${secret}`, targetLanguage: "hi" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(calls, 1);
    assert.equal(ok.json.translatedText, "VERTEX_TRANSLATION");

    setVertexClientForTests({
      models: {
        generateContent: async () => {
          calls += 1;
          const err = new Error(`translate phi ${secret}`);
          err.name = "ForcedTranslateError";
          throw err;
        },
      },
    } as unknown as GoogleGenAI);
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map((part) => String(part)).join(" "));
    };
    try {
      const failed = await jsonRequest(
        port,
        "POST",
        "/api/whatsapp/translate",
        { text: `hello ${secret}`, targetLanguage: "hi" },
        { Authorization: `Bearer ${token}` }
      );
      assert.equal(failed.status, 200, JSON.stringify(failed.json));
      assert.equal(calls, 2);
      assert.equal(failed.json.translatedText, "नमस्ते, आपकी पूछताछ दर्ज कर ली गई है। हमारा स्टाफ जल्द ही आपसे संपर्क करेगा।");
      assert.equal(String(failed.json.translatedText).includes(secret), false);
      const logged = warns.join("\n");
      assert.match(logged, /whatsapp\.translate\.gemini ForcedTranslateError/);
      assert.equal(logged.includes(secret), false);
    } finally {
      console.warn = original;
      setVertexClientForTests(undefined);
    }
  });
});

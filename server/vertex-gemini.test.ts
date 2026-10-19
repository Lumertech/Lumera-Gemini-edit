import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { GoogleGenAI } from "@google/genai";
import {
  AI_TRANSCRIPTION_NOT_CONFIGURED,
  getVertexClient,
  readVertexSettings,
  setVertexClientFactoryForTests,
  setVertexClientForTests,
  VERTEX_DEFAULT_GEMINI_MODEL,
  VERTEX_DEFAULT_LOCATION,
  VERTEX_DEFAULT_PROJECT,
  vertexClientOptions,
  vertexGeminiModel,
} from "./vertex-gemini.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PHI_ROUTES = [
  "server/gemini-clinical.ts",
  "server/gemini-voice.ts",
  "server/whatsapp.ts",
  "server/gemini-clinical-rest.ts",
  "server/gemini-soap-copilot.ts",
  "server/gemini-safety-voice.ts",
  "server/vertex-gemini.ts",
];

afterEach(() => {
  setVertexClientForTests(undefined);
});

describe("Vertex PHI client", () => {
  it("fails closed in production when project or location is missing and does not build a client", () => {
    let built = 0;
    setVertexClientFactoryForTests(() => {
      built += 1;
      return { models: { generateContent: async () => ({ text: "" }) } } as unknown as GoogleGenAI;
    });
    for (const env of [
      { NODE_ENV: "production" },
      { NODE_ENV: "production", VERTEX_PROJECT: VERTEX_DEFAULT_PROJECT },
      { NODE_ENV: "production", VERTEX_LOCATION: VERTEX_DEFAULT_LOCATION },
    ]) {
      assert.equal(readVertexSettings(env as NodeJS.ProcessEnv), null);
      assert.equal(getVertexClient(env as NodeJS.ProcessEnv), null);
    }
    assert.equal(built, 0);
    assert.equal(VERTEX_DEFAULT_GEMINI_MODEL, "gemini-3.5-flash-lite");
    assert.equal(vertexGeminiModel({}), "gemini-3.5-flash-lite");
    assert.equal(vertexGeminiModel({ NODE_ENV: "production" }), "gemini-3.5-flash-lite");
    assert.equal(vertexGeminiModel({ VERTEX_GEMINI_MODEL: "  gemini-3.5-flash  " }), "gemini-3.5-flash");
    assert.equal(AI_TRANSCRIPTION_NOT_CONFIGURED, "AI_TRANSCRIPTION_NOT_CONFIGURED");
  });

  it("sends asia-south1 and the project, and does not attach an API key", () => {
    const settings = readVertexSettings({
      NODE_ENV: "production",
      VERTEX_PROJECT: VERTEX_DEFAULT_PROJECT,
      VERTEX_LOCATION: VERTEX_DEFAULT_LOCATION,
    });
    assert.ok(settings);
    const options = vertexClientOptions(settings);
    assert.equal(options.vertexai, true);
    assert.equal(options.project, "gen-lang-client-0108182367");
    assert.equal(options.location, "asia-south1");
    assert.equal(Object.prototype.hasOwnProperty.call(options, "apiKey"), false);
    assert.equal(JSON.stringify(options).includes("apiKey"), false);

    let seen: { vertexai?: boolean; project?: string; location?: string } | null = null;
    setVertexClientFactoryForTests((next) => {
      seen = next;
      return { models: { generateContent: async () => ({ text: "ok" }) } } as unknown as GoogleGenAI;
    });
    const client = getVertexClient({
      NODE_ENV: "production",
      VERTEX_PROJECT: VERTEX_DEFAULT_PROJECT,
      VERTEX_LOCATION: "asia-south1",
    });
    assert.ok(client);
    assert.equal(seen?.vertexai, true);
    assert.equal(seen?.project, VERTEX_DEFAULT_PROJECT);
    assert.equal(seen?.location, "asia-south1");
  });

  it("uses documented defaults outside production", () => {
    const settings = readVertexSettings({ NODE_ENV: "test" });
    assert.deepEqual(settings, { project: VERTEX_DEFAULT_PROJECT, location: VERTEX_DEFAULT_LOCATION });
  });

  it("rejects an API-key client import on PHI routes", () => {
    for (const rel of PHI_ROUTES) {
      const text = fs.readFileSync(path.join(root, rel), "utf8");
      assert.equal(text.includes("GEMINI_API_KEY"), false, rel);
      assert.equal(text.includes("apiKey"), false, rel);
      assert.equal(/new GoogleGenAI\(\s*\{[^}]*apiKey/.test(text), false, rel);
    }
    const clinical = fs.readFileSync(path.join(root, "server/gemini-clinical.ts"), "utf8");
    const consentAt = clinical.indexOf("hasAmbientScribeConsent");
    const clientAt = clinical.indexOf("getVertexClient()");
    assert.ok(consentAt > 0 && clientAt > consentAt);
    assert.match(clinical, /AI_TRANSCRIPTION_NOT_CONFIGURED/);
    assert.match(clinical, /vertexGeminiModel\(/);
    const vertex = fs.readFileSync(path.join(root, "server/vertex-gemini.ts"), "utf8");
    assert.match(vertex, /VERTEX_GEMINI_MODEL/);
    assert.match(vertex, /gemini-3\.5-flash-lite/);
    assert.match(vertex, /21 July 2027/);
    assert.doesNotMatch(clinical, /transcribe_unavailable/);
  });
});

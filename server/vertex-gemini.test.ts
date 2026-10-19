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
  AI_TRANSCRIPTION_UNAVAILABLE,
  VERTEX_DEFAULT_GEMINI_MODEL,
  VERTEX_DEFAULT_LOCATION,
  VERTEX_DEFAULT_PROJECT,
  VERTEX_REQUIRED_LOCATION,
  vertexClientOptions,
  vertexGeminiModel,
} from "./vertex-gemini.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PHI_ROUTES = [
  "server/gemini-clinical.ts",
  "server/gemini-voice.ts",
  "server/whatsapp.ts",
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
    assert.equal(AI_TRANSCRIPTION_UNAVAILABLE, "AI_TRANSCRIPTION_UNAVAILABLE");
    assert.equal(VERTEX_REQUIRED_LOCATION, "asia-south1");
  });

  it("accepts only asia-south1 and fails closed for global, us-central1, and an empty location", () => {
    const logs: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args);
    };
    let built = 0;
    setVertexClientFactoryForTests(() => {
      built += 1;
      return { models: { generateContent: async () => ({ text: "ok" }) } } as unknown as GoogleGenAI;
    });
    try {
      for (const location of ["global", "us-central1", ""]) {
        for (const nodeEnv of ["production", "test"]) {
          const env = {
            NODE_ENV: nodeEnv,
            VERTEX_PROJECT: VERTEX_DEFAULT_PROJECT,
            VERTEX_LOCATION: location,
          } as NodeJS.ProcessEnv;
          assert.equal(readVertexSettings(env), null, `${nodeEnv} ${location || "(empty)"}`);
          assert.equal(getVertexClient(env), null);
        }
      }
      const allowed = readVertexSettings({
        NODE_ENV: "test",
        VERTEX_LOCATION: "asia-south1",
      });
      assert.deepEqual(allowed, { project: VERTEX_DEFAULT_PROJECT, location: "asia-south1" });
      assert.ok(getVertexClient({ NODE_ENV: "test", VERTEX_LOCATION: "asia-south1" }));
      assert.equal(built, 1);
      const rejected = logs.map((args) => String(args[1] ?? ""));
      assert.equal(rejected.filter((value) => value === "global").length, 1);
      assert.equal(rejected.filter((value) => value === "us-central1").length, 1);
      assert.equal(rejected.includes(VERTEX_DEFAULT_PROJECT), false);
      assert.equal(JSON.stringify(logs).includes("global endpoint"), false);
    } finally {
      console.error = original;
    }
  });

  it("rejects ASIA-SOUTH1 because the location match is exact", () => {
    const logs: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args);
    };
    try {
      const env = {
        NODE_ENV: "test",
        VERTEX_PROJECT: VERTEX_DEFAULT_PROJECT,
        VERTEX_LOCATION: "ASIA-SOUTH1",
      } as NodeJS.ProcessEnv;
      assert.equal(readVertexSettings(env), null);
      assert.equal(readVertexSettings(env), null);
      assert.equal(getVertexClient(env), null);
      const rejected = logs.filter((args) => args[0] === "vertex location rejected");
      assert.equal(rejected.length, 1);
      assert.equal(String(rejected[0]?.[1]), "ASIA-SOUTH1");
    } finally {
      console.error = original;
    }
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

  it("uses the documented project default outside production only when the location is asia-south1", () => {
    const logs: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args);
    };
    try {
      assert.equal(readVertexSettings({ NODE_ENV: "test" }), null);
      assert.equal(String(logs.at(-1)?.[1] ?? ""), "");
      const settings = readVertexSettings({ NODE_ENV: "test", VERTEX_LOCATION: VERTEX_DEFAULT_LOCATION });
      assert.deepEqual(settings, { project: VERTEX_DEFAULT_PROJECT, location: "asia-south1" });
    } finally {
      console.error = original;
    }
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

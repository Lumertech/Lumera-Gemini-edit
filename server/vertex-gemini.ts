import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";

/**
 * Patient audio and other PHI go through Vertex AI in Mumbai.
 * Documented defaults (production fails closed when either env var is missing):
 *   VERTEX_PROJECT=gen-lang-client-0108182367
 *   VERTEX_LOCATION=asia-south1
 *
 * Pinned model id `gemini-2.5-flash` (not a -latest or preview alias).
 * The model card lists audio input (audio/webm, audio/mp4) and asia-south1:
 * https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/2-5-flash
 * Region table: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations
 * That card also lists a retirement date of 2026-10-20.
 */
export const VERTEX_DEFAULT_PROJECT = "gen-lang-client-0108182367";
export const VERTEX_DEFAULT_LOCATION = "asia-south1";
export const VERTEX_GEMINI_MODEL = "gemini-2.5-flash";

export const AI_TRANSCRIPTION_NOT_CONFIGURED = "AI_TRANSCRIPTION_NOT_CONFIGURED";
export const AI_TRANSCRIPTION_NOT_CONFIGURED_MESSAGE = "AI transcription not configured";

export interface VertexSettings {
  project: string;
  location: string;
}

export interface VertexClientOptions {
  vertexai: true;
  project: string;
  location: string;
}

export function readVertexSettings(env: NodeJS.ProcessEnv = process.env): VertexSettings | null {
  const project = String(env.VERTEX_PROJECT || "").trim();
  const location = String(env.VERTEX_LOCATION || "").trim();
  if (env.NODE_ENV === "production") {
    if (!project || !location) return null;
    return { project, location };
  }
  return {
    project: project || VERTEX_DEFAULT_PROJECT,
    location: location || VERTEX_DEFAULT_LOCATION,
  };
}

/** True when a PHI call is allowed to construct a client. Production requires both env vars. */
export function vertexEnvConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readVertexSettings(env) !== null;
}

export function vertexClientOptions(settings: VertexSettings): VertexClientOptions {
  return {
    vertexai: true,
    project: settings.project,
    location: settings.location,
  };
}

type VertexFactory = (options: VertexClientOptions) => GoogleGenAI;

let cached: GoogleGenAI | null = null;
let cachedKey = "";
let forcedClient: { set: boolean; client: GoogleGenAI | null } = { set: false, client: null };
let factory: VertexFactory | undefined;

/** Test hook. Pass undefined to clear. Pass null to force the unconfigured path. */
export function setVertexClientForTests(client?: GoogleGenAI | null): void {
  if (client === undefined) {
    forcedClient = { set: false, client: null };
    factory = undefined;
  } else {
    forcedClient = { set: true, client };
  }
  cached = null;
  cachedKey = "";
}

export function setVertexClientFactoryForTests(next?: VertexFactory): void {
  factory = next;
  cached = null;
  cachedKey = "";
}

export function getVertexClient(env: NodeJS.ProcessEnv = process.env): GoogleGenAI | null {
  if (forcedClient.set) return forcedClient.client;
  const settings = readVertexSettings(env);
  if (!settings) return null;
  const options = vertexClientOptions(settings);
  if (factory) return factory(options);
  const key = `${settings.project}\0${settings.location}`;
  if (cached && cachedKey === key) return cached;
  cached = new GoogleGenAI(options);
  cachedKey = key;
  return cached;
}

export async function vertexGenerateContent(
  params: GenerateContentParameters,
  env: NodeJS.ProcessEnv = process.env
): Promise<GenerateContentResponse> {
  const ai = getVertexClient(env);
  if (!ai) {
    const err = new Error(AI_TRANSCRIPTION_NOT_CONFIGURED_MESSAGE);
    (err as { code?: string }).code = AI_TRANSCRIPTION_NOT_CONFIGURED;
    throw err;
  }
  return ai.models.generateContent({
    ...params,
    model: params.model || VERTEX_GEMINI_MODEL,
  });
}

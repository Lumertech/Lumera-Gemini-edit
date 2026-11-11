import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";

/**
 * Patient audio and other PHI go through Vertex AI in Mumbai.
 * Documented defaults (production fails closed when either env var is missing):
 *   VERTEX_PROJECT=gen-lang-client-0108182367
 *   VERTEX_LOCATION=asia-south1
 *
 * Default model when VERTEX_GEMINI_MODEL is unset: `gemini-2.5-flash` (VERTEX_DEFAULT_GEMINI_MODEL).
 * VERTEX_GEMINI_MODEL is used exactly as given, including `gemini-3.5-flash-lite`.
 * An earlier build remapped that id onto gemini-2.5-flash and ignored the operator pin.
 * That remap is removed. Do not substitute another model for an explicit setting.
 * gemini-3.5-flash-lite model card: GA, released 21 July 2026, retirement 21 July 2027 or later.
 * Audio MIME types include audio/webm, audio/mp4, and audio/x-aac.
 * Supported regions include Asia Pacific asia-south1:
 * https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite
 * Locations table:
 * https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations
 * Standard PayGo on the asia-south1 regional endpoint was verified live for
 * gemini-3.5-flash-lite on 2026-10-19. Provisioned Throughput is not required
 * for this pin. Do not send calls to global or a multi-region endpoint.
 */
export const VERTEX_DEFAULT_PROJECT = "gen-lang-client-0108182367";
export const VERTEX_DEFAULT_LOCATION = "asia-south1";
export const VERTEX_DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/** Resolved model id. An explicit VERTEX_GEMINI_MODEL is returned unchanged. */
export function vertexGeminiModel(env: NodeJS.ProcessEnv = process.env): string {
  const id = String(env.VERTEX_GEMINI_MODEL || "").trim();
  if (!id) return VERTEX_DEFAULT_GEMINI_MODEL;
  return id;
}

export const AI_TRANSCRIPTION_NOT_CONFIGURED = "AI_TRANSCRIPTION_NOT_CONFIGURED";
export const AI_TRANSCRIPTION_NOT_CONFIGURED_MESSAGE = "AI transcription not configured";
export const AI_TRANSCRIPTION_UNAVAILABLE = "AI_TRANSCRIPTION_UNAVAILABLE";
export const AI_TRANSCRIPTION_UNAVAILABLE_MESSAGE = "Transcription is temporarily unavailable. Tap Retry.";

/** Only Mumbai. There is no fallback to global, us, eu, or any other region. */
export const VERTEX_REQUIRED_LOCATION = "asia-south1";

/** One rejection log per distinct location for the life of the process. */
const loggedRejectedLocations = new Set<string>();

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
  if (location !== VERTEX_REQUIRED_LOCATION) {
    if (!loggedRejectedLocations.has(location)) {
      loggedRejectedLocations.add(location);
      console.error("vertex location rejected", location);
    }
    return null;
  }
  if (!project && env.NODE_ENV === "production") return null;
  return {
    project: project || VERTEX_DEFAULT_PROJECT,
    location,
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
    model: params.model || vertexGeminiModel(env),
  });
}

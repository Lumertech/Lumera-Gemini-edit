import type { Request } from "express";
import type { DatabaseSync } from "node:sqlite";
import {
  recordAiScribeUsage,
  scribeQuantityMinutes,
} from "./usage-billing.ts";

export function aiScribeTenantIdFromRequest(req: Request): string {
  return String(req.user?.tenantId || "").trim();
}

/**
 * Wallet balance does not block AI Scribe. A missing tenant still cannot call Gemini.
 */
export function blockedAiScribeResponse(tenantId: string, _database?: DatabaseSync) {
  const id = String(tenantId || "").trim();
  if (!id) {
    return {
      status: 401,
      body: {
        error: "Sign in required",
        code: "AUTH_REQUIRED" as const,
      },
    };
  }
  return null;
}

/**
 * Ambient transcription meter. Duration and byte count only.
 * The transcript is not a parameter and must not be added to metadata or logs.
 */
export function meterSuccessfulTranscription(opts: {
  tenantId: string;
  durationMs: number;
  audioBytes: number;
  database?: DatabaseSync;
}) {
  const durationMs = Number(opts.durationMs);
  const audioBytes = Number(opts.audioBytes);
  return meterSuccessfulGeminiScribe({
    tenantId: opts.tenantId,
    durationMinutes: Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 60_000 : undefined,
    metadata: {
      endpoint: "transcribe",
      audioBytes: Number.isFinite(audioBytes) && audioBytes > 0 ? Math.round(audioBytes) : 0,
      durationMs: Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : 0,
    },
    database: opts.database,
  });
}

/** Meter-after-success, mirroring `meterWhatsAppUsage` → `recordWhatsAppUsageAndDebit`. */
export function meterSuccessfulGeminiScribe(opts: {
  tenantId: string;
  durationMinutes?: unknown;
  transcript?: string;
  metadata?: Record<string, unknown>;
  database?: DatabaseSync;
}) {
  const tenantId = String(opts.tenantId || "").trim();
  if (!tenantId) return null;
  try {
    return recordAiScribeUsage({
      tenantId,
      quantityMinutes: scribeQuantityMinutes({
        durationMinutes: opts.durationMinutes,
        transcript: opts.transcript,
      }),
      metadata: opts.metadata,
      database: opts.database,
    });
  } catch (err) {
    console.error("Failed to record AI Scribe usage:", err);
    return null;
  }
}

/**
 * Gate → call `generate` (the real Gemini `generateContent` site) → record/debit
 * only if generate resolves. Thrown generate errors skip metering.
 */
export async function runMeteredGeminiScribe<T>(opts: {
  tenantId: string;
  durationMinutes?: unknown;
  transcript?: string;
  metadata?: Record<string, unknown>;
  database?: DatabaseSync;
  generate: () => Promise<T>;
}): Promise<
  | { ok: true; value: T; usage: ReturnType<typeof recordAiScribeUsage> }
  | { ok: false; status: number; body: Record<string, unknown>; usage?: undefined }
> {
  const blocked = blockedAiScribeResponse(opts.tenantId, opts.database);
  if (blocked) {
    return { ok: false, status: blocked.status, body: blocked.body };
  }
  const value = await opts.generate();
  const usage = meterSuccessfulGeminiScribe(opts);
  return { ok: true, value, usage };
}

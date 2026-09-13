import type { Request } from "express";
import type { DatabaseSync } from "node:sqlite";
import { WALLET_INSUFFICIENT_ERROR } from "./usage-wallet.ts";
import {
  assertWalletAllowsAiScribe,
  recordAiScribeUsage,
  scribeQuantityMinutes,
} from "./usage-billing.ts";

export function aiScribeTenantIdFromRequest(req: Request): string {
  return String(req.user?.tenantId || "").trim();
}

/**
 * Gate AI Scribe (non-critical). Missing tenantId is blocked — no silent skip.
 * Empty/insufficient wallet → 402 + Top up now (same as `assertWalletAllowsAiScribe`).
 */
export function blockedAiScribeResponse(tenantId: string, database?: DatabaseSync) {
  const id = String(tenantId || "").trim();
  if (!id) {
    return {
      status: 402,
      body: {
        error: WALLET_INSUFFICIENT_ERROR,
        code: "WALLET_INSUFFICIENT" as const,
        wallet: null as null,
      },
    };
  }
  const gate = assertWalletAllowsAiScribe(id, database);
  if (gate.ok) return null;
  return {
    status: gate.status,
    body: {
      error: gate.error,
      code: gate.code,
      wallet: gate.wallet,
    },
  };
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

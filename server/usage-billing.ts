import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { getDb } from "./db.ts";
import {
  GEMINI_SCRIBE_RAW_COST_NOTE,
  resolveGeminiScribeRawCostInr,
  META_SERVICE_WINDOW_CUTOVER_ISO,
  lookupMetaRate,
  recipientCountryFromPhone,
  type UsageResource,
  type WhatsAppCategory,
} from "./usage-rates.ts";
import { envFlag } from "./runtime.ts";
import {
  DEFAULT_MARKUP_PERCENT,
  WALLET_INSUFFICIENT_ERROR,
  applyWalletTransaction,
  ensureUsageWalletSchema,
  getMarkupPercent,
  publicWalletStatus,
  roundMoney,
} from "./usage-wallet.ts";

export {
  DEFAULT_MARKUP_PERCENT,
  WALLET_INSUFFICIENT_ERROR,
  USAGE_RESOURCES,
  WALLET_TX_TYPES,
  applyWalletTransaction,
  creditWalletFromRazorpayTopup,
  ensureUsageWalletSchema,
  ensureWallet,
  getMarkupPercent,
  listMarkupConfig,
  listWalletTransactions,
  markupSource,
  publicWalletStatus,
  roundMoney,
  seedDemoUsageWallet,
  upsertMarkupConfig,
  walletAlertState,
  withSqliteTransaction,
} from "./usage-wallet.ts";
export type { UsageResource, WalletAlertState, WalletRow, WalletTxType } from "./usage-wallet.ts";

export type CloudUsageKind = "otp" | "appointment_reminder" | "book_confirmation" | "payment_receipt" | "text";

const CRITICAL_WHATSAPP_KINDS = new Set<CloudUsageKind>(["otp", "book_confirmation"]);

export function isCriticalWhatsAppKind(kind?: string | null): boolean {
  return CRITICAL_WHATSAPP_KINDS.has(String(kind || "") as CloudUsageKind);
}

export function categoryForCloudKind(kind?: string | null): WhatsAppCategory {
  const k = String(kind || "");
  if (k === "otp") return "authentication";
  if (k === "text") return "service";
  return "utility";
}

/**
 * Oct 1 2026 cutover (WABA timezone approximated as UTC unless overridden).
 * META_BILL_SERVICE_WINDOW=true forces billed-in-window behavior now.
 * META_FREE_SERVICE_WINDOW=true keeps the pre-cutover free window (tests / rollback).
 * META_SERVICE_WINDOW_CUTOVER overrides the ISO timestamp.
 */
export function isMetaServiceWindowBilled(now: Date = new Date()): boolean {
  if (envFlag("META_FREE_SERVICE_WINDOW")) return false;
  if (envFlag("META_BILL_SERVICE_WINDOW")) return true;
  const cutover = Date.parse(String(process.env.META_SERVICE_WINDOW_CUTOVER || "").trim() || META_SERVICE_WINDOW_CUTOVER_ISO);
  return now.getTime() >= cutover;
}

export function estimateWhatsAppRawCostInr(opts: {
  kind?: string | null;
  to?: string;
  category?: WhatsAppCategory;
  inCustomerServiceWindow?: boolean;
  now?: Date;
}): { rawCost: number; country: "IN" | "OTHER"; category: WhatsAppCategory; windowFree: boolean; rateInr: number } {
  const category = opts.category || categoryForCloudKind(opts.kind);
  const country = recipientCountryFromPhone(opts.to || "");
  const rate = lookupMetaRate(country, category);
  const inWindow = Boolean(opts.inCustomerServiceWindow);
  const billedInWindow = isMetaServiceWindowBilled(opts.now);
  const windowEligible = category === "service" || category === "utility";
  const windowFree = windowEligible && inWindow && !billedInWindow;
  return {
    rawCost: windowFree ? 0 : rate.rateInr,
    country,
    category,
    windowFree,
    rateInr: rate.rateInr,
  };
}

export function billedAmountFromRaw(rawCost: number, markupPercent: number): number {
  const markup = Number.isFinite(markupPercent) ? markupPercent : DEFAULT_MARKUP_PERCENT;
  return roundMoney(rawCost * (1 + markup / 100));
}

export function insertUsageEvent(opts: {
  tenantId: string;
  resource: UsageResource;
  quantity: number;
  rawCost: number | null;
  metadata?: Record<string, unknown>;
  database?: DatabaseSync;
}): { id: string; createdAt: string } {
  const db = opts.database || getDb();
  ensureUsageWalletSchema(db);
  const id = `uev-${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO usage_events (id, tenant_id, resource, quantity, raw_cost, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    opts.tenantId,
    opts.resource,
    opts.quantity,
    opts.rawCost,
    JSON.stringify(opts.metadata || {}),
    createdAt
  );
  if (opts.resource === "ai_scribe_minutes") {
    refreshAiScribeMinutesRollup(opts.tenantId, db);
  }
  return { id, createdAt };
}

/** tenants.ai_scribe_minutes_used is a derived rollup of usage_events, not an independently written value. */
export function refreshAiScribeMinutesRollup(tenantId: string, database?: DatabaseSync) {
  const db = database || getDb();
  try {
    db.prepare(
      `UPDATE tenants SET ai_scribe_minutes_used = (
         SELECT COALESCE(SUM(quantity), 0) FROM usage_events
         WHERE tenant_id = ? AND resource = 'ai_scribe_minutes'
       ), updated_at = ? WHERE id = ?`
    ).run(tenantId, new Date().toISOString(), tenantId);
  } catch {
    /* tenants row may not exist in isolated tests */
  }
}

export function assertWalletAllowsDebit(opts: {
  tenantId: string;
  billedAmount: number;
  critical: boolean;
  database?: DatabaseSync;
}): { readonly ok: true } | { ok: false; error: string; code: "WALLET_INSUFFICIENT"; status: number; wallet: ReturnType<typeof publicWalletStatus> } {
  const wallet = publicWalletStatus(opts.tenantId, opts.database);
  if (opts.critical) return { ok: true };
  const next = roundMoney(wallet.balance - Math.abs(opts.billedAmount));
  if (next < 0) {
    return {
      ok: false,
      error: WALLET_INSUFFICIENT_ERROR,
      code: "WALLET_INSUFFICIENT",
      status: 402,
      wallet,
    };
  }
  return { ok: true };
}

export function assertWalletAllowsAiScribe(tenantId: string, database?: DatabaseSync) {
  const wallet = publicWalletStatus(tenantId, database);
  if (wallet.balance <= 0) {
    return {
      ok: false as const,
      error: WALLET_INSUFFICIENT_ERROR,
      code: "WALLET_INSUFFICIENT" as const,
      status: 402,
      wallet,
    };
  }
  return { ok: true as const, wallet };
}

export function recordWhatsAppUsageAndDebit(opts: {
  tenantId: string;
  kind?: string | null;
  to?: string;
  inCustomerServiceWindow?: boolean;
  metadata?: Record<string, unknown>;
  database?: DatabaseSync;
  now?: Date;
}): { usageEventId: string; rawCost: number; billedAmount: number; markupPercent: number } | null {
  const tenantId = String(opts.tenantId || "").trim();
  if (!tenantId) return null;
  const db = opts.database || getDb();
  const estimate = estimateWhatsAppRawCostInr({
    kind: opts.kind,
    to: opts.to,
    inCustomerServiceWindow: opts.inCustomerServiceWindow,
    now: opts.now,
  });
  const usage = insertUsageEvent({
    tenantId,
    resource: "whatsapp_message",
    quantity: 1,
    rawCost: estimate.rawCost,
    metadata: {
      kind: opts.kind || "text",
      category: estimate.category,
      country: estimate.country,
      windowFree: estimate.windowFree,
      inCustomerServiceWindow: Boolean(opts.inCustomerServiceWindow),
      serviceWindowBilled: isMetaServiceWindowBilled(opts.now),
      ...opts.metadata,
    },
    database: db,
  });
  if (estimate.rawCost == null) return { usageEventId: usage.id, rawCost: estimate.rawCost, billedAmount: 0, markupPercent: 0 };
  const markupPercent = getMarkupPercent(tenantId, "whatsapp_message", db);
  const billedAmount = billedAmountFromRaw(estimate.rawCost, markupPercent);
  if (billedAmount > 0) {
    applyWalletTransaction(tenantId, "usage_debit", -billedAmount, {
      usageEventId: usage.id,
      createdBy: "system",
      note: `WhatsApp ${opts.kind || "message"} (${estimate.category}/${estimate.country})`,
      database: db,
    });
  }
  return { usageEventId: usage.id, rawCost: estimate.rawCost, billedAmount, markupPercent };
}

/**
 * Record AI Scribe minutes, then debit the wallet the same way WhatsApp does
 * (`recordWhatsAppUsageAndDebit`): markup on raw_cost when a numeric session
 * cost exists. Null raw_cost → usage_events + minutes rollup, no usage_debit
 * (no invented Gemini per-minute rate).
 */
export function recordAiScribeUsage(opts: {
  tenantId: string;
  quantityMinutes: number;
  metadata?: Record<string, unknown>;
  database?: DatabaseSync;
}): { usageEventId: string; rawCost: number | null; billedAmount: number; markupPercent: number } | null {
  const tenantId = String(opts.tenantId || "").trim();
  if (!tenantId) return null;
  const db = opts.database || getDb();
  const quantity = Number(opts.quantityMinutes);
  const minutes = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const rawCost = resolveGeminiScribeRawCostInr();
  const usage = insertUsageEvent({
    tenantId,
    resource: "ai_scribe_minutes",
    quantity: minutes,
    rawCost,
    metadata: {
      rawCostNote: GEMINI_SCRIBE_RAW_COST_NOTE,
      ...opts.metadata,
    },
    database: db,
  });
  if (rawCost == null) {
    return { usageEventId: usage.id, rawCost: null, billedAmount: 0, markupPercent: 0 };
  }
  const markupPercent = getMarkupPercent(tenantId, "ai_scribe_minutes", db);
  const billedAmount = billedAmountFromRaw(rawCost, markupPercent);
  if (billedAmount > 0) {
    applyWalletTransaction(tenantId, "usage_debit", -billedAmount, {
      usageEventId: usage.id,
      createdBy: "system",
      note: `AI Scribe ${minutes} min`,
      database: db,
    });
  }
  return { usageEventId: usage.id, rawCost, billedAmount, markupPercent };
}

/** Alias matching `recordWhatsAppUsageAndDebit` — same implementation. */
export const recordAiScribeUsageAndDebit = recordAiScribeUsage;

/**
 * Client `durationMinutes` is accepted only when it stays inside a documented
 * band of the transcript-based estimate:
 *   ±20% **or** ±1 minute, whichever is larger.
 * Always compute the transcript estimate. Outside the band, bill the estimate
 * and `console.warn` (do not let a wildly understated client duration shrink
 * billed quantity).
 */
export const SCRIBE_DURATION_TOLERANCE_RATIO = 0.2;
export const SCRIBE_DURATION_TOLERANCE_MINUTES = 1;

/** ~130 spoken words/minute, rounded to 0.1 min, floor 0.5 when transcript has words. */
export function transcriptScribeMinutes(transcript?: string): number {
  const words = String(transcript || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  if (words > 0) return Math.max(0.5, Math.round((words / 130) * 10) / 10);
  return 1;
}

export function scribeDurationToleranceMinutes(estimated: number): number {
  return Math.max(SCRIBE_DURATION_TOLERANCE_MINUTES, SCRIBE_DURATION_TOLERANCE_RATIO * estimated);
}

export function scribeQuantityMinutes(body: { durationMinutes?: unknown; transcript?: string }): number {
  const estimated = transcriptScribeMinutes(body.transcript);
  const explicit = Number(body.durationMinutes);
  if (!Number.isFinite(explicit) || explicit <= 0) return estimated;
  const tolerance = scribeDurationToleranceMinutes(estimated);
  if (Math.abs(explicit - estimated) <= tolerance) return explicit;
  console.warn(
    `[Lumera] scribeQuantityMinutes: client durationMinutes=${explicit} is outside ±${SCRIBE_DURATION_TOLERANCE_RATIO * 100}% or ±${SCRIBE_DURATION_TOLERANCE_MINUTES}min of transcript estimate ${estimated} (tolerance ${tolerance}); billing the estimate`
  );
  return estimated;
}

export function usageBreakdown(opts: {
  tenantId?: string;
  from?: string;
  to?: string;
  database?: DatabaseSync;
}) {
  const db = opts.database || getDb();
  const from = String(opts.from || "").trim() || "1970-01-01T00:00:00.000Z";
  const to = String(opts.to || "").trim() || new Date().toISOString();
  const params: SQLInputValue[] = [from, to];
  let tenantSql = "";
  if (opts.tenantId) {
    tenantSql = "AND e.tenant_id = ?";
    params.push(opts.tenantId);
  }
  const rows = db
    .prepare(
      `SELECT e.tenant_id, e.resource,
              COALESCE(SUM(e.quantity), 0) AS quantity,
              COALESCE(SUM(e.raw_cost), 0) AS raw_cost,
              COALESCE(SUM(CASE WHEN t.type = 'usage_debit' THEN -t.amount ELSE 0 END), 0) AS billed_amount
       FROM usage_events e
       LEFT JOIN wallet_transactions t ON t.usage_event_id = e.id AND t.type = 'usage_debit'
       WHERE e.created_at >= ? AND e.created_at <= ? ${tenantSql}
       GROUP BY e.tenant_id, e.resource`
    )
    .all(...(params as any[])) as Array<{
    tenant_id: string;
    resource: string;
    quantity: number;
    raw_cost: number;
    billed_amount: number;
  }>;
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    resource: r.resource,
    quantity: Number(r.quantity),
    rawCost: roundMoney(Number(r.raw_cost)),
    billedAmount: roundMoney(Number(r.billed_amount)),
    margin: roundMoney(Number(r.billed_amount) - Number(r.raw_cost)),
  }));
}

export function platformMarginReport(opts: { from?: string; to?: string; database?: DatabaseSync }) {
  const rows = usageBreakdown(opts);
  const rawCost = roundMoney(rows.reduce((s, r) => s + r.rawCost, 0));
  const billedAmount = roundMoney(rows.reduce((s, r) => s + r.billedAmount, 0));
  return {
    from: opts.from || null,
    to: opts.to || null,
    rawCost,
    billedAmount,
    margin: roundMoney(billedAmount - rawCost),
    byResource: rows,
    note: "Margin = sum(billed_amount) − sum(raw_cost). Gemini raw_cost is null so it does not contribute until a real figure exists.",
  };
}

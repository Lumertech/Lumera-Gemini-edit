import type { DatabaseSync } from "node:sqlite";
import { DEMO_TENANT_ID, getDb, writeAudit } from "./db.ts";
import { type UsageResource } from "./usage-rates.ts";
export type { UsageResource } from "./usage-rates.ts";

/** PLACEHOLDER PRICING DECISION — 20% default markup. Not a contractual rate. Super Admin can override. 0% is not a sane default. */
export const DEFAULT_MARKUP_PERCENT = 20;

export const WALLET_INSUFFICIENT_ERROR =
  "Usage wallet balance is insufficient. Top up now to continue WhatsApp reminders, receipts, non-essential replies, and AI Scribe.";

export const USAGE_RESOURCES = ["ai_scribe_minutes", "whatsapp_message"] as const;
export const WALLET_TX_TYPES = ["topup", "usage_debit", "adjustment", "refund"] as const;
export type WalletTxType = (typeof WALLET_TX_TYPES)[number];
export type WalletAlertState = "ok" | "low" | "empty" | "negative";

export function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

export function withSqliteTransaction<T>(database: DatabaseSync, fn: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  }
}

/** Additive usage-wallet schema. Unique name so it can merge with concurrent WABA migrations. */
export function ensureUsageWalletSchema(database: DatabaseSync) {
  database.exec(`
    -- usage_wallet_billing_20260913: usage_events (resource-agnostic raw cost ledger)
    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      resource TEXT NOT NULL CHECK(resource IN ('ai_scribe_minutes','whatsapp_message')),
      quantity REAL NOT NULL,
      raw_cost REAL,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_resource_created
      ON usage_events (tenant_id, resource, created_at);

    -- usage_wallet_billing_20260913: usage_markup_config (Super-Admin-editable; not a code constant)
    CREATE TABLE IF NOT EXISTS usage_markup_config (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK(scope IN ('global','tenant')),
      tenant_id TEXT NOT NULL DEFAULT '',
      resource TEXT NOT NULL CHECK(resource IN ('ai_scribe_minutes','whatsapp_message')),
      markup_percent REAL NOT NULL,
      updated_by TEXT,
      updated_at TEXT,
      UNIQUE (scope, tenant_id, resource)
    );

    -- usage_wallet_billing_20260913: tenant_wallets
    CREATE TABLE IF NOT EXISTS tenant_wallets (
      tenant_id TEXT PRIMARY KEY,
      balance REAL NOT NULL DEFAULT 0,
      low_balance_threshold REAL NOT NULL DEFAULT 100,
      alert_state TEXT NOT NULL DEFAULT 'ok',
      updated_at TEXT
    );

    -- usage_wallet_billing_20260913: wallet_transactions
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('topup','usage_debit','adjustment','refund')),
      amount REAL NOT NULL,
      balance_after REAL NOT NULL,
      usage_event_id TEXT,
      razorpay_payment_id TEXT,
      created_by TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wallet_tx_tenant_created
      ON wallet_transactions (tenant_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_razorpay
      ON wallet_transactions (razorpay_payment_id)
      WHERE razorpay_payment_id IS NOT NULL AND razorpay_payment_id != '';
  `);
}

export function seedDemoUsageWallet(database: DatabaseSync) {
  try {
    const existing = database
      .prepare("SELECT tenant_id, balance FROM tenant_wallets WHERE tenant_id = ?")
      .get(DEMO_TENANT_ID) as { tenant_id: string; balance: number } | undefined;
    if (existing) return;
    applyWalletTransaction(DEMO_TENANT_ID, "adjustment", 10000, {
      note: "Demo seed credit so sandbox clinics can send WhatsApp / try AI Scribe. Not a Razorpay top-up.",
      createdBy: "system",
      database,
    });
  } catch {
    /* tenants table may be empty in isolated tests */
  }
}

export function getMarkupPercent(tenantId: string, resource: UsageResource, database?: DatabaseSync): number {
  const db = database || getDb();
  ensureUsageWalletSchema(db);
  const tenant = String(tenantId || "").trim();
  if (tenant) {
    const override = db
      .prepare(
        `SELECT markup_percent FROM usage_markup_config
         WHERE scope = 'tenant' AND tenant_id = ? AND resource = ?`
      )
      .get(tenant, resource) as { markup_percent: number } | undefined;
    if (override && Number.isFinite(Number(override.markup_percent))) {
      return Number(override.markup_percent);
    }
  }
  const global = db
    .prepare(
      `SELECT markup_percent FROM usage_markup_config
       WHERE scope = 'global' AND tenant_id = '' AND resource = ?`
    )
    .get(resource) as { markup_percent: number } | undefined;
  if (global && Number.isFinite(Number(global.markup_percent))) {
    return Number(global.markup_percent);
  }
  return DEFAULT_MARKUP_PERCENT;
}

export function listMarkupConfig(database?: DatabaseSync) {
  const db = database || getDb();
  ensureUsageWalletSchema(db);
  const rows = db
    .prepare(
      `SELECT id, scope, tenant_id, resource, markup_percent, updated_by, updated_at
       FROM usage_markup_config
       ORDER BY scope ASC, tenant_id ASC, resource ASC`
    )
    .all() as Array<{
    id: string;
    scope: string;
    tenant_id: string;
    resource: string;
    markup_percent: number;
    updated_by: string | null;
    updated_at: string | null;
  }>;
  return {
    defaultMarkupPercent: DEFAULT_MARKUP_PERCENT,
    defaultMarkupNote:
      "PLACEHOLDER PRICING DECISION: hardcoded fallback is 20% when no global or tenant row exists. Super Admin should set an explicit global row. 0% is not a sane default.",
    rows: rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      tenantId: r.tenant_id,
      resource: r.resource,
      markupPercent: r.markup_percent,
      updatedBy: r.updated_by,
      updatedAt: r.updated_at,
    })),
  };
}

export function upsertMarkupConfig(opts: {
  scope: "global" | "tenant";
  tenantId?: string;
  resource: UsageResource;
  markupPercent: number;
  updatedBy?: string;
  database?: DatabaseSync;
}) {
  if (!USAGE_RESOURCES.includes(opts.resource)) {
    throw Object.assign(new Error("Unknown resource"), { status: 400 });
  }
  if (opts.scope !== "global" && opts.scope !== "tenant") {
    throw Object.assign(new Error("scope must be global or tenant"), { status: 400 });
  }
  const tenantId = opts.scope === "global" ? "" : String(opts.tenantId || "").trim();
  if (opts.scope === "tenant" && !tenantId) {
    throw Object.assign(new Error("tenantId is required for a tenant override"), { status: 400 });
  }
  const percent = Number(opts.markupPercent);
  if (!Number.isFinite(percent) || percent < 0 || percent > 1000) {
    throw Object.assign(new Error("markupPercent must be a number between 0 and 1000"), { status: 400 });
  }
  const db = opts.database || getDb();
  ensureUsageWalletSchema(db);
  const now = new Date().toISOString();
  const existing = db
    .prepare(
      `SELECT id FROM usage_markup_config WHERE scope = ? AND tenant_id = ? AND resource = ?`
    )
    .get(opts.scope, tenantId, opts.resource) as { id: string } | undefined;
  const id = existing?.id || `markup-${crypto.randomUUID()}`;
  db.prepare(
    `INSERT INTO usage_markup_config (id, scope, tenant_id, resource, markup_percent, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope, tenant_id, resource) DO UPDATE SET
       markup_percent = excluded.markup_percent,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`
  ).run(id, opts.scope, tenantId, opts.resource, percent, opts.updatedBy || null, now);
  return {
    id,
    scope: opts.scope,
    tenantId,
    resource: opts.resource,
    markupPercent: percent,
    updatedBy: opts.updatedBy || null,
    updatedAt: now,
  };
}

export type WalletRow = {
  tenant_id: string;
  balance: number;
  low_balance_threshold: number;
  alert_state: string;
  updated_at: string | null;
};

export function ensureWallet(tenantId: string, database?: DatabaseSync): WalletRow {
  const id = String(tenantId || "").trim();
  if (!id) throw Object.assign(new Error("tenantId is required"), { status: 400 });
  const db = database || getDb();
  ensureUsageWalletSchema(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tenant_wallets (tenant_id, balance, low_balance_threshold, alert_state, updated_at)
     VALUES (?, 0, 100, 'ok', ?)
     ON CONFLICT(tenant_id) DO NOTHING`
  ).run(id, now);
  const row = db
    .prepare("SELECT tenant_id, balance, low_balance_threshold, alert_state, updated_at FROM tenant_wallets WHERE tenant_id = ?")
    .get(id) as WalletRow;
  return row;
}

export function walletAlertState(balance: number, threshold: number): WalletAlertState {
  if (balance < 0) return "negative";
  if (balance <= 0) return "empty";
  if (balance <= threshold) return "low";
  return "ok";
}

export function publicWalletStatus(tenantId: string, database?: DatabaseSync) {
  const wallet = ensureWallet(tenantId, database);
  const state = walletAlertState(Number(wallet.balance), Number(wallet.low_balance_threshold));
  return {
    tenantId,
    balance: roundMoney(Number(wallet.balance)),
    lowBalanceThreshold: Number(wallet.low_balance_threshold),
    state,
    topUpPrompt: state !== "ok",
    message:
      state === "ok"
        ? null
        : state === "low"
          ? "Usage wallet is running low. Top up now to avoid losing WhatsApp reminders, receipts, and AI Scribe."
          : "Usage wallet is empty. OTP and booking confirmations still send; other WhatsApp traffic and AI Scribe are blocked until you top up.",
  };
}

export function applyWalletTransaction(
  tenantId: string,
  type: WalletTxType,
  amount: number,
  opts?: {
    usageEventId?: string | null;
    razorpayPaymentId?: string | null;
    createdBy?: string | null;
    note?: string;
    database?: DatabaseSync;
  }
): { id: string; balanceAfter: number; amount: number; type: WalletTxType } {
  if (!WALLET_TX_TYPES.includes(type)) {
    throw Object.assign(new Error(`Unknown wallet transaction type "${type}"`), { status: 400 });
  }
  const note = String(opts?.note || "").trim();
  if (type === "adjustment" && !note) {
    throw Object.assign(new Error("Wallet adjustments require a note"), { status: 400 });
  }
  const delta = roundMoney(amount);
  if (!Number.isFinite(delta) || delta === 0) {
    throw Object.assign(new Error("Wallet transaction amount must be a non-zero number"), { status: 400 });
  }
  if (type === "usage_debit" && delta > 0) {
    throw Object.assign(new Error("usage_debit amount must be negative"), { status: 400 });
  }
  if ((type === "topup" || type === "refund") && delta < 0) {
    throw Object.assign(new Error(`${type} amount must be positive`), { status: 400 });
  }

  const db = opts?.database || getDb();
  const id = `wtx-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const createdBy = opts?.createdBy || "system";
  const razorpayPaymentId = String(opts?.razorpayPaymentId || "").trim();

  return withSqliteTransaction(db, () => {
    if (razorpayPaymentId) {
      const dup = db
        .prepare("SELECT id, balance_after, amount, type FROM wallet_transactions WHERE razorpay_payment_id = ?")
        .get(razorpayPaymentId) as { id: string; balance_after: number; amount: number; type: WalletTxType } | undefined;
      if (dup) {
        return { id: dup.id, balanceAfter: Number(dup.balance_after), amount: Number(dup.amount), type: dup.type };
      }
    }

    ensureWallet(tenantId, db);
    const current = db
      .prepare("SELECT balance, low_balance_threshold, alert_state FROM tenant_wallets WHERE tenant_id = ?")
      .get(tenantId) as { balance: number; low_balance_threshold: number; alert_state: string };
    const balanceAfter = roundMoney(Number(current.balance) + delta);
    db.prepare(
      `INSERT INTO wallet_transactions (
        id, tenant_id, type, amount, balance_after, usage_event_id, razorpay_payment_id, created_by, note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      tenantId,
      type,
      delta,
      balanceAfter,
      opts?.usageEventId || null,
      razorpayPaymentId || null,
      createdBy,
      note,
      now
    );
    if (note === "__test_fail_after_insert__") {
      throw new Error("forced failure");
    }
    const nextState = walletAlertState(balanceAfter, Number(current.low_balance_threshold));
    db.prepare("UPDATE tenant_wallets SET balance = ?, alert_state = ?, updated_at = ? WHERE tenant_id = ?").run(
      balanceAfter,
      nextState,
      now,
      tenantId
    );
    maybeWriteBalanceAudit({
      database: db,
      tenantId,
      previousState: String(current.alert_state || "ok") as WalletAlertState,
      nextState,
      balanceAfter,
      threshold: Number(current.low_balance_threshold),
      createdBy,
    });
    return { id, balanceAfter, amount: delta, type };
  });
}

function maybeWriteBalanceAudit(opts: {
  database: DatabaseSync;
  tenantId: string;
  previousState: WalletAlertState | string;
  nextState: WalletAlertState;
  balanceAfter: number;
  threshold: number;
  createdBy: string;
}) {
  const prev = String(opts.previousState || "ok");
  if (opts.nextState === prev) return;
  if (opts.nextState === "ok") return;
  const action =
    opts.nextState === "low"
      ? "Usage wallet low balance"
      : "Usage wallet empty";
  const details =
    opts.nextState === "low"
      ? `tenant=${opts.tenantId} balance=${opts.balanceAfter} threshold=${opts.threshold}`
      : `tenant=${opts.tenantId} balance=${opts.balanceAfter} (zero or negative). OTP and booking confirmations still send; other usage is blocked.`;
  try {
    writeAudit(opts.database, null, opts.createdBy || "system", action, details);
  } catch {
    /* audit table may be missing in isolated tests */
  }
}

export function listWalletTransactions(tenantId: string, limit = 50, database?: DatabaseSync) {
  const db = database || getDb();
  const rows = db
    .prepare(
      `SELECT id, tenant_id, type, amount, balance_after, usage_event_id, razorpay_payment_id, created_by, note, created_at
       FROM wallet_transactions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(tenantId, Math.min(200, Math.max(1, limit))) as Array<Record<string, unknown>>;
  return rows.map(mapWalletTx);
}

function mapWalletTx(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    type: String(row.type),
    amount: Number(row.amount),
    balanceAfter: Number(row.balance_after),
    usageEventId: row.usage_event_id ? String(row.usage_event_id) : null,
    razorpayPaymentId: row.razorpay_payment_id ? String(row.razorpay_payment_id) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
    note: String(row.note || ""),
    createdAt: String(row.created_at),
  };
}

export function markupSource(tenantId: string, resource: UsageResource): "tenant" | "global" | "default" {
  const db = getDb();
  const override = db
    .prepare(`SELECT id FROM usage_markup_config WHERE scope = 'tenant' AND tenant_id = ? AND resource = ?`)
    .get(tenantId, resource);
  if (override) return "tenant";
  const global = db
    .prepare(`SELECT id FROM usage_markup_config WHERE scope = 'global' AND tenant_id = '' AND resource = ?`)
    .get(resource);
  if (global) return "global";
  return "default";
}

export function creditWalletFromRazorpayTopup(opts: {
  tenantId: string;
  amountRupees: number;
  razorpayPaymentId?: string;
  note?: string;
}) {
  const amount = roundMoney(opts.amountRupees);
  if (!opts.tenantId || !(amount > 0)) {
    throw Object.assign(new Error("Invalid wallet top-up"), { status: 400 });
  }
  return applyWalletTransaction(opts.tenantId, "topup", amount, {
    razorpayPaymentId: opts.razorpayPaymentId || null,
    createdBy: "system",
    note: opts.note || "Razorpay wallet top-up",
  });
}

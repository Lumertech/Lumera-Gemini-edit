import type { DatabaseSync } from "node:sqlite";
import type { SqlDatabase } from "./sql-engine.ts";
import { phoneMatchKey } from "./clinical.ts";
import { writeAudit } from "./db-seed-maps.ts";
import { isSandboxOrDemoTenant } from "./graph-whatsapp.ts";
import { upsertTenantSubscription } from "./platform-tenants-schema.ts";

/** Card-free clinic trial. Day 8 is read-only. */
export const TRIAL_DAYS = 7;
export const TRIAL_READ_ONLY_DAY = 8;
export const PENDING_VERIFICATION = "pending_verification";

export const RAZORPAY_PLAN_ENV = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"] as const;

export const REPEAT_TRIAL_ERROR =
  "A free trial has already been used for this email or WhatsApp number. Sign in or upgrade.";

const MS_DAY = 24 * 60 * 60 * 1000;

export function ensureTrialClaimsTable(database: SqlDatabase) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS trial_claims (
      id TEXT PRIMARY KEY,
      email_key TEXT NOT NULL,
      phone_key TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      started_at TEXT NOT NULL
    );
  `);
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_trial_claims_email ON trial_claims(email_key)");
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_trial_claims_phone ON trial_claims(phone_key)");
}

export function trialEndsFrom(fromMs = Date.now()): string {
  return new Date(fromMs + TRIAL_DAYS * MS_DAY).toISOString();
}

export function daysLeftUntil(endsAt: string | null | undefined, now = Date.now()): number | null {
  if (!endsAt) return null;
  const ends = Date.parse(endsAt);
  if (!Number.isFinite(ends)) return null;
  if (ends <= now) return 0;
  return Math.ceil((ends - now) / MS_DAY);
}

function emailKey(email: string): string {
  return String(email || "").trim().toLowerCase();
}

function phoneKey(phone: string, tenantId: string): string {
  const key = phoneMatchKey(phone);
  // Real mobiles are 10 national digits and are claimed once. Shorter test
  // numbers must not share one bucket.
  if (key.length >= 10) return key;
  return `unparsed:${tenantId}`;
}

type ClaimRow = { id: string; email_key: string; phone_key: string; tenant_id: string; started_at: string };

function findClaim(database: SqlDatabase, column: "email_key" | "phone_key", value: string): ClaimRow | undefined {
  if (!value) return undefined;
  return database.prepare(`SELECT id, email_key, phone_key, tenant_id, started_at FROM trial_claims WHERE ${column} = ?`).get(value) as
    | ClaimRow
    | undefined;
}

export type TrialStartResult =
  | { ok: true; trialEndsAt: string; alreadyStarted: boolean }
  | { ok: false; code: "repeat_trial"; error: string };

/**
 * Starts the 7-day trial after a verified WhatsApp number.
 * One claim per email and per phone. A second clinic cannot reuse either.
 * Audit text is the tenant id and the day count — no phone, email, or OTP.
 */
export function beginVerifiedWhatsAppTrial(
  database: SqlDatabase,
  input: { tenantId: string; email: string; phone: string; userId?: string | null }
): TrialStartResult {
  ensureTrialClaimsTable(database);
  const tenantId = String(input.tenantId || "").trim();
  const email = emailKey(input.email);
  const phone = phoneKey(input.phone, tenantId);
  if (!tenantId || !email || !phone) {
    return { ok: false, code: "repeat_trial", error: REPEAT_TRIAL_ERROR };
  }
  if (isSandboxOrDemoTenant(database as unknown as DatabaseSync, tenantId)) {
    const existing = database.prepare("SELECT trial_ends_at FROM tenants WHERE id = ?").get(tenantId) as
      | { trial_ends_at?: string }
      | undefined;
    return { ok: true, trialEndsAt: String(existing?.trial_ends_at || trialEndsFrom()), alreadyStarted: true };
  }

  const byEmail = findClaim(database, "email_key", email);
  const byPhone = findClaim(database, "phone_key", phone);
  const foreign = [byEmail, byPhone].find((row) => row && row.tenant_id !== tenantId);
  if (foreign) return { ok: false, code: "repeat_trial", error: REPEAT_TRIAL_ERROR };

  const same = byEmail?.tenant_id === tenantId ? byEmail : byPhone?.tenant_id === tenantId ? byPhone : undefined;
  if (same) {
    const existing = database.prepare("SELECT trial_ends_at FROM tenants WHERE id = ?").get(tenantId) as
      | { trial_ends_at?: string }
      | undefined;
    return { ok: true, trialEndsAt: String(existing?.trial_ends_at || trialEndsFrom()), alreadyStarted: true };
  }

  const now = new Date().toISOString();
  const endsAt = trialEndsFrom();
  try {
    database
      .prepare(
        `INSERT INTO trial_claims (id, email_key, phone_key, tenant_id, started_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(`claim-${crypto.randomUUID().slice(0, 12)}`, email, phone, tenantId, now);
  } catch {
    return { ok: false, code: "repeat_trial", error: REPEAT_TRIAL_ERROR };
  }

  database
    .prepare(
      `UPDATE tenants
       SET trial_ends_at = ?, lifecycle_status = 'trial', active_status = 1, updated_at = ?
       WHERE id = ?`
    )
    .run(endsAt, now, tenantId);

  upsertTenantSubscription(database, tenantId, {
    planCode: "trial",
    status: "trial",
    billingSource: "manual",
    startedAt: same?.started_at || now,
    endsAt,
    notes: `card-free trial ${TRIAL_DAYS} days`,
  });

  writeAudit(database, input.userId || null, "Clinic account", "Trial started", `tenant=${tenantId} days=${TRIAL_DAYS}`);
  return { ok: true, trialEndsAt: endsAt, alreadyStarted: false };
}

/** Social sign-on does not start a trial until this clinic's WhatsApp number is verified. */
export function maybeStartTrialIfPending(database: SqlDatabase, userId: string): TrialStartResult | null {
  const user = database
    .prepare("SELECT id, tenant_id, email, phone, whatsapp_verified, role FROM users WHERE id = ?")
    .get(userId) as
    | { id: string; tenant_id?: string; email?: string; phone?: string; whatsapp_verified?: number; role?: string }
    | undefined;
  if (!user?.tenant_id) return null;
  if (user.role === "patient" || user.role === "super_admin") return null;
  const tenant = database.prepare("SELECT lifecycle_status FROM tenants WHERE id = ?").get(user.tenant_id) as
    | { lifecycle_status?: string }
    | undefined;
  if (String(tenant?.lifecycle_status || "") !== PENDING_VERIFICATION) return null;
  if (!Number(user.whatsapp_verified)) return null;
  return beginVerifiedWhatsAppTrial(database, {
    tenantId: user.tenant_id,
    email: String(user.email || ""),
    phone: String(user.phone || ""),
    userId: user.id,
  });
}

export type TrialAccessView = {
  status: "none" | "pending_whatsapp" | "active" | "read_only";
  daysLeft: number | null;
  trialEndsAt: string | null;
  upgradeRequired: boolean;
  whatsappVerificationRequired: boolean;
  readOnly: boolean;
};

const OPEN_ACCESS: TrialAccessView = {
  status: "none",
  daysLeft: null,
  trialEndsAt: null,
  upgradeRequired: false,
  whatsappVerificationRequired: false,
  readOnly: false,
};

export function describeTrialAccess(database: SqlDatabase, tenantId: string, now = Date.now()): TrialAccessView {
  const id = String(tenantId || "").trim();
  if (!id || isSandboxOrDemoTenant(database as unknown as DatabaseSync, id)) return OPEN_ACCESS;
  let lifecycle = "";
  let trialEnds = "";
  try {
    const tenant = database.prepare("SELECT lifecycle_status, trial_ends_at FROM tenants WHERE id = ?").get(id) as
      | { lifecycle_status?: string; trial_ends_at?: string }
      | undefined;
    lifecycle = String(tenant?.lifecycle_status || "");
    trialEnds = String(tenant?.trial_ends_at || "");
  } catch {
    return OPEN_ACCESS;
  }
  if (lifecycle === PENDING_VERIFICATION) {
    return {
      status: "pending_whatsapp",
      daysLeft: null,
      trialEndsAt: null,
      upgradeRequired: false,
      whatsappVerificationRequired: true,
      readOnly: true,
    };
  }

  let subStatus = "";
  let subEnds = "";
  let billing = "";
  try {
    const sub = database
      .prepare("SELECT status, ends_at, billing_source FROM tenant_subscriptions WHERE tenant_id = ?")
      .get(id) as { status?: string; ends_at?: string; billing_source?: string } | undefined;
    subStatus = String(sub?.status || "").toLowerCase();
    subEnds = String(sub?.ends_at || "");
    billing = String(sub?.billing_source || "").toLowerCase();
  } catch {
    /* subscription table missing */
  }
  if (billing === "sandbox" || billing === "demo") return OPEN_ACCESS;
  if (subStatus === "active") return OPEN_ACCESS;

  const tracked = lifecycle === "trial" || subStatus === "trial";
  if (!tracked) return OPEN_ACCESS;
  const endsAt = subEnds || trialEnds;
  const left = daysLeftUntil(endsAt, now);
  if (endsAt && Date.parse(endsAt) <= now) {
    return {
      status: "read_only",
      daysLeft: 0,
      trialEndsAt: endsAt,
      upgradeRequired: true,
      whatsappVerificationRequired: false,
      readOnly: true,
    };
  }
  return {
    status: "active",
    daysLeft: left,
    trialEndsAt: endsAt || null,
    upgradeRequired: false,
    whatsappVerificationRequired: false,
    readOnly: false,
  };
}

export function extendTenantTrial(database: SqlDatabase, tenantId: string, endsAt: string) {
  const now = new Date().toISOString();
  database
    .prepare(
      `UPDATE tenants
       SET trial_ends_at = ?, lifecycle_status = 'trial', active_status = 1, updated_at = ?
       WHERE id = ? AND lifecycle_status IN ('trial', 'pending_verification', '')`
    )
    .run(endsAt, now, tenantId);
  writeAudit(database, null, "Platform admin", "Trial extended", `tenant=${tenantId}`);
}

/** Verified Razorpay plan payment. Billing source stays manual — the catalog refuses a PSP-paid flag. */
export function activatePaidPlan(
  database: SqlDatabase,
  input: { tenantId: string; planCode: string; cycle: string; paymentId: string }
) {
  const cycle = input.cycle === "annual" ? "annual" : "monthly";
  const days = cycle === "annual" ? 365 : 30;
  const now = new Date();
  const endsAt = new Date(now.getTime() + days * MS_DAY).toISOString();
  const planCode = input.planCode === "polyclinic" ? "polyclinic" : "individual";
  upsertTenantSubscription(database, input.tenantId, {
    planCode,
    status: "active",
    billingSource: "manual",
    startedAt: now.toISOString(),
    endsAt,
    notes: `plan payment ${cycle}`,
  });
  database
    .prepare(
      `UPDATE tenants SET lifecycle_status = 'active', trial_ends_at = ?, active_status = 1, updated_at = ? WHERE id = ?`
    )
    .run(endsAt, now.toISOString(), input.tenantId);
  writeAudit(
    database,
    null,
    "Razorpay webhook",
    "Plan payment",
    `tenant=${input.tenantId} plan=${planCode} cycle=${cycle} ref=${input.paymentId || "unspecified"}`
  );
}

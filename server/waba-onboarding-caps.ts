/**
 * Meta rolling 7-day new-client onboarding caps.
 * Unverified Tech Providers: 10 new client WABAs / 7 days.
 * After Meta business verification: 200 / 7 days.
 *
 * Lumera is NOT verified / certified. Default cap is 10 unless the founder
 * sets META_WHATSAPP_ONBOARDING_VERIFIED=true after Meta actually verifies.
 */

import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db.ts";
import { envFlag } from "./runtime.ts";
import { ensureWhatsAppOwnershipSchema, type WhatsAppNumberRow } from "./whatsapp-numbers-store.ts";

export const UNVERIFIED_ONBOARDING_CAP_7D = 10;
export const VERIFIED_ONBOARDING_CAP_7D = 200;
export const TOKEN_EXPIRY_WARN_DAYS = 14;

export function metaWhatsAppOnboardingVerified(): boolean {
  return envFlag("META_WHATSAPP_ONBOARDING_VERIFIED");
}

export function rollingOnboardingCap(): number {
  return metaWhatsAppOnboardingVerified() ? VERIFIED_ONBOARDING_CAP_7D : UNVERIFIED_ONBOARDING_CAP_7D;
}

export function countEmbeddedSignupOnboardingsSince(sinceIso: string, database: DatabaseSync = getDb()): number {
  ensureWhatsAppOwnershipSchema(database);
  try {
    const row = database
      .prepare(
        `SELECT COUNT(*) AS c FROM whatsapp_numbers
         WHERE connected_via = 'embedded_signup'
           AND status = 'connected'
           AND created_at >= ?`
      )
      .get(sinceIso) as { c?: number } | undefined;
    return Number(row?.c || 0);
  } catch {
    return 0;
  }
}

function parseExpiry(value: string): Date | null {
  const raw = String(value || "").trim();
  if (!raw || /sandbox|dev-only|unknown|placeholder/i.test(raw)) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

export function listTokenExpiryWarnings(
  now = new Date(),
  warnWithinDays = TOKEN_EXPIRY_WARN_DAYS,
  database: DatabaseSync = getDb()
) {
  ensureWhatsAppOwnershipSchema(database);
  let rows: WhatsAppNumberRow[] = [];
  try {
    rows = database.prepare("SELECT * FROM whatsapp_numbers WHERE status = 'connected'").all() as WhatsAppNumberRow[];
  } catch {
    return [];
  }
  const horizon = now.getTime() + warnWithinDays * 24 * 60 * 60 * 1000;
  return rows
    .map((row) => {
      const expires = parseExpiry(row.meta_token_expires_at);
      if (!expires) return null;
      const expired = expires.getTime() <= now.getTime();
      const expiringSoon = !expired && expires.getTime() <= horizon;
      if (!expired && !expiringSoon) return null;
      return {
        id: row.id,
        ownerType: row.owner_type,
        ownerId: row.owner_id,
        wabaId: row.waba_id,
        phoneNumberId: row.phone_number_id,
        metaWabaName: row.meta_waba_name,
        metaTokenExpiresAt: row.meta_token_expires_at,
        expired,
        expiringSoon,
      };
    })
    .filter(Boolean);
}

export function wabaOnboardingCapsOverview(now = new Date(), database: DatabaseSync = getDb()) {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const count = countEmbeddedSignupOnboardingsSince(since, database);
  const cap = rollingOnboardingCap();
  const verified = metaWhatsAppOnboardingVerified();
  return {
    windowDays: 7,
    newClientOnboardings: count,
    cap,
    remaining: Math.max(0, cap - count),
    overCap: count > cap,
    businessVerifiedFlag: verified,
    notice: verified
      ? "META_WHATSAPP_ONBOARDING_VERIFIED=true — using Meta's 200 / 7-day cap. This flag is manual, not proof of Tech Provider certification."
      : "SANDBOX-honest: Lumera is not Meta-business-verified. Rolling cap is 10 new Embedded Signup clients / 7 days until META_WHATSAPP_ONBOARDING_VERIFIED=true. Contact ravee@lumer.me.",
    tokenExpiryWarnings: listTokenExpiryWarnings(now, TOKEN_EXPIRY_WARN_DAYS, database),
  };
}

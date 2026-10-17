import crypto from "node:crypto";
import type { Request, Response } from "express";
import { toE164Phone } from "./clinical.ts";
import { getDb } from "./db.ts";
import type { SqlDatabase } from "./sql-engine.ts";
import { consumeSendOtpAttempt, otpSubjectKey, requestClientIp } from "./otp-rate-limit.ts";

export const OTP_SEND_LIMIT_ERROR = "Too many OTP requests. Try again later.";
export const OTP_VERIFY_LOCK_ERROR = "Too many incorrect codes. This code is no longer valid. Request a new OTP.";
export const VERIFY_OTP_MAX_FAILURES = 5;

/** Six-digit OTP. crypto.randomInt is exclusive of the upper bound. */
export function generateNumericOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export type PendingOtp = { id: string; otp: string; expires_at: string };

export function ensureOtpFailureColumn(database: SqlDatabase) {
  try {
    database.exec("ALTER TABLE otp_verifications ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0");
  } catch {
    // Column already exists on databases created after the bootstrap change.
  }
}

export function sendOtpLimited(res: Response, retryAfterSec: number) {
  res.setHeader("Retry-After", String(Math.max(1, retryAfterSec || 1)));
  res.status(429).json({ error: OTP_SEND_LIMIT_ERROR });
}

/**
 * Counts one code send against the phone, user, and client IP windows.
 * A pending code for the same phone, purpose, and email is reused instead of sending again.
 * The 60s cooldown applies to that phone and user. A different recipient behind the same
 * address is still capped at 3 sends per 10 minutes.
 */
export function reserveOtpSend(
  req: Request,
  phone: string,
  purpose: string,
  subject: { userId?: string; email?: string },
  reusePending: boolean
): { limited: true; retryAfterSec: number } | { limited: false; pending: PendingOtp | null } {
  const email = String(subject.email || "").trim().toLowerCase();
  const decision = consumeSendOtpAttempt(phone, requestClientIp(req), otpSubjectKey({ userId: subject.userId, email, phone }));
  if (!decision.ok) return { limited: true, retryAfterSec: decision.retryAfterSec };

  const pending = reusePending ? findPendingOtp(phone, purpose, email) : null;
  if (pending) return { limited: false, pending };
  if (decision.targetCooldown) return { limited: true, retryAfterSec: decision.retryAfterSec || 1 };
  return { limited: false, pending: null };
}

/** Digit spellings that toE164Phone maps back to the same number. */
function e164DigitForms(e164: string): string[] {
  const digits = e164.replace(/\D/g, "");
  const forms = new Set<string>([digits, `00${digits}`]);
  if (digits.startsWith("91") && digits.length === 12) {
    const national = digits.slice(2);
    forms.add(national);
    forms.add(`0${national}`);
  }
  return [...forms];
}

export function findPendingOtp(phone: string, purpose: string, email: string): PendingOtp | null {
  const phoneKey = toE164Phone(phone);
  if (!phoneKey) return null;
  const forms = e164DigitForms(phoneKey);
  const stripped = `replace(replace(replace(replace(replace(phone, '+', ''), ' ', ''), '-', ''), '(', ''), ')', '')`;
  const rows = getDb()
    .prepare(
      `SELECT id, otp, expires_at, phone FROM otp_verifications
       WHERE purpose = ? AND lower(email) = ? AND verified_at IS NULL AND expires_at > ?
         AND COALESCE(failed_attempts, 0) < ?
         AND TRIM(COALESCE(otp, '')) != ''
         AND ${stripped} IN (${forms.map(() => "?").join(", ")})
       ORDER BY created_at DESC`
    )
    .all(purpose, email, new Date().toISOString(), VERIFY_OTP_MAX_FAILURES, ...forms) as Array<PendingOtp & { phone?: string }>;
  return rows.find((row) => toE164Phone(String(row.phone || "")) === phoneKey) || null;
}

export function rejectWrongOtp(
  record: { id: string; otp: string; failed_attempts?: number | null },
  inputOtp: string,
  incorrectError: string
): { ok: true } | { ok: false; status: 400 | 429; error: string } {
  const attempts = Number(record.failed_attempts || 0);
  if (attempts >= VERIFY_OTP_MAX_FAILURES || !String(record.otp || "")) {
    return { ok: false, status: 429, error: OTP_VERIFY_LOCK_ERROR };
  }
  if (record.otp === inputOtp) return { ok: true };
  const next = attempts + 1;
  if (next >= VERIFY_OTP_MAX_FAILURES) {
    getDb().prepare("UPDATE otp_verifications SET failed_attempts = ?, otp = '' WHERE id = ?").run(next, record.id);
    return { ok: false, status: 429, error: OTP_VERIFY_LOCK_ERROR };
  }
  getDb().prepare("UPDATE otp_verifications SET failed_attempts = ? WHERE id = ?").run(next, record.id);
  return { ok: false, status: 400, error: incorrectError };
}

/**
 * send-otp limits, separate from the short auth-path IP window.
 * 3 requests per 10 minutes per user, per phone, and per client IP,
 * plus a cooldown between new sends. A pending verification is reused.
 */

export const SEND_OTP_WINDOW_MS = 10 * 60 * 1000;
export const SEND_OTP_COOLDOWN_MS = 60 * 1000;
export const SEND_OTP_MAX_PER_PHONE = 3;
export const SEND_OTP_MAX_PER_IP = 3;
export const SEND_OTP_MAX_PER_USER = 3;

type Bucket = { count: number; resetAt: number; lastAt: number };

const phoneBuckets = new Map<string, Bucket>();
const ipBuckets = new Map<string, Bucket>();
const userBuckets = new Map<string, Bucket>();

export function normalizeOtpPhone(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export function otpSubjectKey(input: { userId?: string; email?: string; phone: string }): string {
  const userId = String(input.userId || "").trim();
  if (userId) return `user:${userId}`;
  const email = String(input.email || "").trim().toLowerCase();
  if (email) return `email:${email}`;
  const phone = normalizeOtpPhone(input.phone) || String(input.phone || "").trim();
  return `phone:${phone}`;
}

export function requestClientIp(req: { ip?: string; socket?: { remoteAddress?: string | null } }): string {
  return String(req.ip || req.socket?.remoteAddress || "unknown");
}

function atLimit(store: Map<string, Bucket>, key: string, max: number, now: number): { limited: boolean; retryAfterSec: number } {
  const prev = store.get(key);
  if (!prev || prev.resetAt <= now) return { limited: false, retryAfterSec: 0 };
  if (prev.count >= max) {
    return { limited: true, retryAfterSec: Math.max(1, Math.ceil((prev.resetAt - now) / 1000)) };
  }
  return { limited: false, retryAfterSec: 0 };
}

function cooldownLeft(store: Map<string, Bucket>, key: string, now: number): number {
  const prev = store.get(key);
  if (!prev) return 0;
  const remaining = prev.lastAt + SEND_OTP_COOLDOWN_MS - now;
  if (remaining <= 0) return 0;
  return Math.max(1, Math.ceil(remaining / 1000));
}

function bump(store: Map<string, Bucket>, key: string, now: number) {
  const prev = store.get(key);
  if (!prev || prev.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + SEND_OTP_WINDOW_MS, lastAt: now });
    return;
  }
  prev.count += 1;
  prev.lastAt = now;
}

function consumeOtpWindow(
  targetKey: string,
  ip: string,
  userKey: string,
  now: number
): { ok: true; withinCooldown: boolean; targetCooldown: boolean; retryAfterSec: number } | { ok: false; retryAfterSec: number } {
  const phoneKey = String(targetKey || "").trim();
  const ipKey = String(ip || "unknown");
  const subject = String(userKey || "").trim() || `phone:${phoneKey}`;
  const trackIp = tracksClientIp(ipKey);
  const phoneLimit = atLimit(phoneBuckets, phoneKey, SEND_OTP_MAX_PER_PHONE, now);
  const ipLimit = trackIp ? atLimit(ipBuckets, ipKey, SEND_OTP_MAX_PER_IP, now) : { limited: false, retryAfterSec: 0 };
  const userLimit = atLimit(userBuckets, subject, SEND_OTP_MAX_PER_USER, now);
  if (phoneLimit.limited || ipLimit.limited || userLimit.limited) {
    return {
      ok: false,
      retryAfterSec: Math.max(phoneLimit.retryAfterSec, ipLimit.retryAfterSec, userLimit.retryAfterSec, 1),
    };
  }
  const targetRetryAfterSec = Math.max(cooldownLeft(phoneBuckets, phoneKey, now), cooldownLeft(userBuckets, subject, now));
  const retryAfterSec = Math.max(targetRetryAfterSec, trackIp ? cooldownLeft(ipBuckets, ipKey, now) : 0);
  bump(phoneBuckets, phoneKey, now);
  if (trackIp) bump(ipBuckets, ipKey, now);
  bump(userBuckets, subject, now);
  return { ok: true, withinCooldown: retryAfterSec > 0, targetCooldown: targetRetryAfterSec > 0, retryAfterSec };
}

export function consumeSendOtpAttempt(
  phone: string,
  ip: string,
  userKey: string,
  now = Date.now()
): { ok: true; withinCooldown: boolean; targetCooldown: boolean; retryAfterSec: number } | { ok: false; retryAfterSec: number } {
  const phoneKey = normalizeOtpPhone(phone) || String(phone || "").trim();
  return consumeOtpWindow(phoneKey, ip, userKey, now);
}

/**
 * Same windows as send-otp. targetKey is stored as given so a caller can pass
 * a hash instead of a phone. Do not pass a raw Aadhaar number.
 */
/** Forgot-password window. Keyed by normalised email and by client IP, before any user lookup. */
export function consumeForgotPasswordAttempt(
  email: string,
  ip: string,
  now = Date.now()
): { ok: true; withinCooldown: boolean; targetCooldown: boolean; retryAfterSec: number } | { ok: false; retryAfterSec: number } {
  const normalised = String(email || "").trim().toLowerCase();
  const key = `forgot-email:${normalised}`;
  return consumeHashedOtpAttempt(key, ip, key, now);
}

export function consumeHashedOtpAttempt(
  targetKey: string,
  ip: string,
  userKey: string,
  now = Date.now()
): { ok: true; withinCooldown: boolean; targetCooldown: boolean; retryAfterSec: number } | { ok: false; retryAfterSec: number } {
  return consumeOtpWindow(String(targetKey || "").trim(), ip, userKey, now);
}

/** Loopback is the test server and a local proxy hop, not a shared clinic client. */
function tracksClientIp(ip: string): boolean {
  return ip !== "127.0.0.1" && ip !== "::1" && ip !== "::ffff:127.0.0.1";
}

/** Same IP window as send-otp. Loopback is not counted. Shares `ipBuckets` with OTP sends. */
export function consumeClientIpAttempt(
  ip: string,
  now = Date.now()
): { ok: true } | { ok: false; retryAfterSec: number } {
  const ipKey = String(ip || "unknown");
  if (!tracksClientIp(ipKey)) return { ok: true };
  const ipLimit = atLimit(ipBuckets, ipKey, SEND_OTP_MAX_PER_IP, now);
  if (ipLimit.limited) return { ok: false, retryAfterSec: ipLimit.retryAfterSec || 1 };
  bump(ipBuckets, ipKey, now);
  return { ok: true };
}

export function resetSendOtpRateLimits() {
  phoneBuckets.clear();
  ipBuckets.clear();
  userBuckets.clear();
}

/**
 * A failed Graph send must not start the 60s cooldown, or the retry cannot
 * place a new call. The 3-per-10-minute counters stay where they are.
 */
export function releaseOtpSendCooldown(phone: string, userKey: string, ip?: string) {
  const phoneKey = normalizeOtpPhone(phone) || String(phone || "").trim();
  const clearLast = (store: Map<string, Bucket>, key: string) => {
    const prev = store.get(key);
    if (!prev) return;
    prev.lastAt = 0;
  };
  clearLast(phoneBuckets, phoneKey);
  clearLast(userBuckets, String(userKey || "").trim() || `phone:${phoneKey}`);
  if (ip && tracksClientIp(ip)) clearLast(ipBuckets, ip);
}

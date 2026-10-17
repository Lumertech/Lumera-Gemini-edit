import type { NextFunction, Request, Response } from "express";

export const TRANSCRIBE_RATE_WINDOW_MS = 10 * 60 * 1000;
export const TRANSCRIBE_USER_MAX = 12;
export const TRANSCRIBE_TENANT_MAX = 40;

type Bucket = { count: number; resetAt: number };

const userHits = new Map<string, Bucket>();
const tenantHits = new Map<string, Bucket>();

let userMax = TRANSCRIBE_USER_MAX;
let tenantMax = TRANSCRIBE_TENANT_MAX;

export function resetTranscribeRateLimits(): void {
  userHits.clear();
  tenantHits.clear();
  userMax = TRANSCRIBE_USER_MAX;
  tenantMax = TRANSCRIBE_TENANT_MAX;
}

/** Tests only. Production limits are restored by resetTranscribeRateLimits. */
export function setTranscribeRateLimitForTests(opts?: { userMax?: number; tenantMax?: number }): void {
  userHits.clear();
  tenantHits.clear();
  userMax = opts?.userMax ?? TRANSCRIBE_USER_MAX;
  tenantMax = opts?.tenantMax ?? TRANSCRIBE_TENANT_MAX;
}

function allowed(store: Map<string, Bucket>, key: string, max: number, now: number): boolean {
  const prev = store.get(key);
  if (!prev || prev.resetAt <= now) return true;
  return prev.count < max;
}

function commit(store: Map<string, Bucket>, key: string, now: number): void {
  const prev = store.get(key);
  if (!prev || prev.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + TRANSCRIBE_RATE_WINDOW_MS });
    return;
  }
  prev.count += 1;
}

function retryAfter(store: Map<string, Bucket>, key: string, now: number): number {
  const prev = store.get(key);
  if (!prev) return 1;
  return Math.max(1, Math.ceil((prev.resetAt - now) / 1000));
}

export function consumeTranscribeRateLimit(
  userId: string,
  tenantId: string,
  now = Date.now()
): { ok: true } | { ok: false; retryAfterSeconds: number; scope: "user" | "tenant" } {
  const userKey = `user:${userId || "unknown"}`;
  const tenantKey = `tenant:${tenantId || "unknown"}`;
  if (!allowed(userHits, userKey, userMax, now)) {
    return { ok: false, retryAfterSeconds: retryAfter(userHits, userKey, now), scope: "user" };
  }
  if (!allowed(tenantHits, tenantKey, tenantMax, now)) {
    return { ok: false, retryAfterSeconds: retryAfter(tenantHits, tenantKey, now), scope: "tenant" };
  }
  commit(userHits, userKey, now);
  commit(tenantHits, tenantKey, now);
  return { ok: true };
}

/** Counts one attempt per signed-in user and per tenant. Runs before the large JSON parser. */
export function transcribeRateLimit(req: Request, res: Response, next: NextFunction): void {
  const userId = String(req.user?.id || "").trim();
  const tenantId = String(req.user?.tenantId || "").trim();
  const result = consumeTranscribeRateLimit(userId, tenantId);
  if (result.ok === false) {
    res.setHeader("Retry-After", String(result.retryAfterSeconds));
    res.status(429).json({ error: "Too many transcription requests. Try again later." });
    return;
  }
  next();
}

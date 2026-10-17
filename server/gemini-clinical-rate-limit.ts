import type { NextFunction, Request, Response } from "express";

/** Shared by generate-soap, copilot, pulse, hexa, and safety-check. 12 calls per signed-in user and 40 per tenant in 10 minutes, counted in this process only. */
export const CLINICAL_GEMINI_RATE_WINDOW_MS = 10 * 60 * 1000;
export const CLINICAL_GEMINI_USER_MAX = 12;
export const CLINICAL_GEMINI_TENANT_MAX = 40;

type Bucket = { count: number; resetAt: number };

const userHits = new Map<string, Bucket>();
const tenantHits = new Map<string, Bucket>();

let userMax = CLINICAL_GEMINI_USER_MAX;
let tenantMax = CLINICAL_GEMINI_TENANT_MAX;

export function resetClinicalGeminiRateLimits(): void {
  userHits.clear();
  tenantHits.clear();
  userMax = CLINICAL_GEMINI_USER_MAX;
  tenantMax = CLINICAL_GEMINI_TENANT_MAX;
}

/** Tests only. Production limits are restored by resetClinicalGeminiRateLimits. */
export function setClinicalGeminiRateLimitForTests(opts?: { userMax?: number; tenantMax?: number }): void {
  userHits.clear();
  tenantHits.clear();
  userMax = opts?.userMax ?? CLINICAL_GEMINI_USER_MAX;
  tenantMax = opts?.tenantMax ?? CLINICAL_GEMINI_TENANT_MAX;
}

function allowed(store: Map<string, Bucket>, key: string, max: number, now: number): boolean {
  const prev = store.get(key);
  if (!prev || prev.resetAt <= now) return true;
  return prev.count < max;
}

function commit(store: Map<string, Bucket>, key: string, now: number): void {
  const prev = store.get(key);
  if (!prev || prev.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + CLINICAL_GEMINI_RATE_WINDOW_MS });
    return;
  }
  prev.count += 1;
}

function retryAfter(store: Map<string, Bucket>, key: string, now: number): number {
  const prev = store.get(key);
  if (!prev) return 1;
  return Math.max(1, Math.ceil((prev.resetAt - now) / 1000));
}

export function consumeClinicalGeminiRateLimit(
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

/**
 * One shared bucket for copilot, pulse-assistant, hexa-assistant, and safety-check.
 * Runs after requireAuth and the prescriber guard, before the handler.
 */
export function clinicalGeminiRateLimit(req: Request, res: Response, next: NextFunction): void {
  const userId = String(req.user?.id || "").trim();
  const tenantId = String(req.user?.tenantId || "").trim();
  const result = consumeClinicalGeminiRateLimit(userId, tenantId);
  if (result.ok === false) {
    res.setHeader("Retry-After", String(result.retryAfterSeconds));
    res.status(429).json({ error: "Too many clinical assistant requests. Try again later." });
    return;
  }
  next();
}

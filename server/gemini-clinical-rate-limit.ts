import type { NextFunction, Request, Response } from "express";

/** Shared by generate-soap, copilot, pulse, and hexa. Safety-check has its own budget. 12 calls per signed-in user and 40 per tenant in 10 minutes, counted in this process only. */
export const CLINICAL_GEMINI_RATE_WINDOW_MS = 10 * 60 * 1000;
export const CLINICAL_GEMINI_USER_MAX = 12;
export const CLINICAL_GEMINI_TENANT_MAX = 40;

type Bucket = { count: number; resetAt: number };

const userHits = new Map<string, Bucket>();
const tenantHits = new Map<string, Bucket>();
const safetyUserHits = new Map<string, Bucket>();
const safetyTenantHits = new Map<string, Bucket>();

let userMax = CLINICAL_GEMINI_USER_MAX;
let tenantMax = CLINICAL_GEMINI_TENANT_MAX;
let safetyUserMax = CLINICAL_GEMINI_USER_MAX;
let safetyTenantMax = CLINICAL_GEMINI_TENANT_MAX;

export function resetClinicalGeminiRateLimits(): void {
  userHits.clear();
  tenantHits.clear();
  safetyUserHits.clear();
  safetyTenantHits.clear();
  userMax = CLINICAL_GEMINI_USER_MAX;
  tenantMax = CLINICAL_GEMINI_TENANT_MAX;
  safetyUserMax = CLINICAL_GEMINI_USER_MAX;
  safetyTenantMax = CLINICAL_GEMINI_TENANT_MAX;
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

function consume(
  userStore: Map<string, Bucket>,
  tenantStore: Map<string, Bucket>,
  userLimit: number,
  tenantLimit: number,
  userId: string,
  tenantId: string,
  now: number
): { ok: true } | { ok: false; retryAfterSeconds: number; scope: "user" | "tenant" } {
  const userKey = `user:${userId || "unknown"}`;
  const tenantKey = `tenant:${tenantId || "unknown"}`;
  if (!allowed(userStore, userKey, userLimit, now)) {
    return { ok: false, retryAfterSeconds: retryAfter(userStore, userKey, now), scope: "user" };
  }
  if (!allowed(tenantStore, tenantKey, tenantLimit, now)) {
    return { ok: false, retryAfterSeconds: retryAfter(tenantStore, tenantKey, now), scope: "tenant" };
  }
  commit(userStore, userKey, now);
  commit(tenantStore, tenantKey, now);
  return { ok: true };
}

export function consumeClinicalGeminiRateLimit(
  userId: string,
  tenantId: string,
  now = Date.now()
): { ok: true } | { ok: false; retryAfterSeconds: number; scope: "user" | "tenant" } {
  return consume(userHits, tenantHits, userMax, tenantMax, userId, tenantId, now);
}

export function consumeSafetyCheckRateLimit(
  userId: string,
  tenantId: string,
  now = Date.now()
): { ok: true } | { ok: false; retryAfterSeconds: number; scope: "user" | "tenant" } {
  return consume(safetyUserHits, safetyTenantHits, safetyUserMax, safetyTenantMax, userId, tenantId, now);
}

function rejectRateLimit(
  res: Response,
  result: { retryAfterSeconds: number },
  error: string
): void {
  res.setHeader("Retry-After", String(result.retryAfterSeconds));
  res.status(429).json({ error });
}

/**
 * One shared bucket for generate-soap, copilot, pulse-assistant, and hexa-assistant.
 * Safety-check uses safetyCheckRateLimit so an assistant burst cannot lock the audit.
 */
export function clinicalGeminiRateLimit(req: Request, res: Response, next: NextFunction): void {
  const userId = String(req.user?.id || "").trim();
  const tenantId = String(req.user?.tenantId || "").trim();
  const result = consumeClinicalGeminiRateLimit(userId, tenantId);
  if (result.ok === false) {
    rejectRateLimit(res, result, "Too many clinical assistant requests. Try again later.");
    return;
  }
  next();
}

/** Separate user and tenant counters from copilot and SOAP. */
export function safetyCheckRateLimit(req: Request, res: Response, next: NextFunction): void {
  const userId = String(req.user?.id || "").trim();
  const tenantId = String(req.user?.tenantId || "").trim();
  const result = consumeSafetyCheckRateLimit(userId, tenantId);
  if (result.ok === false) {
    rejectRateLimit(res, result, "Too many safety checks. Try again later.");
    return;
  }
  next();
}

/** Tests only. Does not change the copilot or SOAP budget. */
export function setSafetyCheckRateLimitForTests(opts?: { userMax?: number; tenantMax?: number }): void {
  safetyUserHits.clear();
  safetyTenantHits.clear();
  safetyUserMax = opts?.userMax ?? CLINICAL_GEMINI_USER_MAX;
  safetyTenantMax = opts?.tenantMax ?? CLINICAL_GEMINI_TENANT_MAX;
}

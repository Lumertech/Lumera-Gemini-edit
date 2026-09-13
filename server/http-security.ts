/**
 * CORS allowlist, cookie CSRF, and auth-endpoint rate limits.
 * Meta / Razorpay webhooks and /healthz are exempt so signature-verified
 * callbacks are not blocked by browser Origin / CSRF / login throttles.
 */
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { isUnsetOrPlaceholder } from "./runtime.ts";

export const CSRF_COOKIE = "lumera_csrf";
export const CSRF_HEADER = "x-csrf-token";
export const SESSION_COOKIE = "lumera_sid";

export const AUTH_RATE_LIMITED_PATHS = [
  "/api/auth/login",
  "/api/auth/whatsapp/send-otp",
  "/api/auth/whatsapp/verify-otp",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
] as const;

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 8;

type HitRecord = { count: number; resetAt: number };

const defaultHitStore = new Map<string, HitRecord>();

export function parseAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = String(env.ALLOWED_ORIGINS || "").trim();
  const fromEnv = raw
    ? raw
        .split(",")
        .map((s) => s.trim().replace(/\/$/, ""))
        .filter((s) => s && !isUnsetOrPlaceholder(s))
    : [];
  if (fromEnv.length) return [...new Set(fromEnv)];
  const appUrl = String(env.APP_URL || "").trim().replace(/\/$/, "");
  if (appUrl && !isUnsetOrPlaceholder(appUrl)) return [appUrl];
  if (!isProductionFromEnv(env)) {
    return ["http://localhost:3000", "http://127.0.0.1:3000"];
  }
  return [];
}

function isProductionFromEnv(env: NodeJS.ProcessEnv): boolean {
  return String(env.NODE_ENV || "") === "production";
}

export function isSecurityExemptPath(path: string): boolean {
  const p = String(path || "").split("?")[0];
  if (p === "/healthz") return true;
  if (p === "/data-deletion-callback") return true;
  if (p === "/api/meta/webhook" || p === "/meta/webhook") return true;
  if (p === "/api/meta/data-deletion" || p === "/meta/data-deletion") return true;
  if (p === "/api/billing/razorpay/webhook") return true;
  return false;
}

export function originAllowed(origin: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!origin) return false;
  const normalized = origin.trim().replace(/\/$/, "");
  return parseAllowedOrigins(env).includes(normalized);
}

/**
 * Production is fail-closed: missing Origin and unknown Origin are rejected
 * except webhook/health paths. Non-prod allows missing Origin (curl, tests).
 */
export function corsShouldReject(req: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  if (isSecurityExemptPath(req.path) || isSecurityExemptPath(req.originalUrl || "")) return false;
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  if (origin) return !originAllowed(origin, env);
  if (isProductionFromEnv(env)) return true;
  return false;
}

function parseCookieHeader(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

function isMutating(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method || "GET").toUpperCase());
}

function hasBearerOrSessionHeader(req: Request): boolean {
  const auth = req.headers.authorization;
  if (auth && typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return Boolean(auth.slice(7).trim());
  }
  const xToken = req.headers["x-session-token"];
  return typeof xToken === "string" && Boolean(xToken.trim());
}

/** Cookie-only mutating requests must echo the non-HttpOnly CSRF cookie as X-CSRF-Token. */
export function csrfShouldReject(req: Request): boolean {
  if (isSecurityExemptPath(req.path) || isSecurityExemptPath(req.originalUrl || "")) return false;
  if (!isMutating(req.method)) return false;
  if (hasBearerOrSessionHeader(req)) return false;
  const cookies = parseCookieHeader(req.headers.cookie);
  if (!cookies[SESSION_COOKIE]) return false;
  const cookieToken = cookies[CSRF_COOKIE] || "";
  const headerToken = String(req.headers[CSRF_HEADER] || req.headers["X-CSRF-Token"] || "").trim();
  return !cookieToken || !headerToken || cookieToken !== headerToken;
}

export function corsAllowlistMiddleware(env: NodeJS.ProcessEnv = process.env) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    if (origin && originAllowed(origin, env)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, X-Session-Token");
      res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
    }
    if (req.method === "OPTIONS") {
      if (corsShouldReject(req, env)) {
        return res.status(403).json({ error: "Origin not allowed" });
      }
      return res.status(204).end();
    }
    if (corsShouldReject(req, env)) {
      return res.status(403).json({ error: "Origin not allowed" });
    }
    next();
  };
}

export function csrfProtectionMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (csrfShouldReject(req)) {
      return res.status(403).json({ error: "CSRF token missing or invalid" });
    }
    next();
  };
}

export function authRateLimitKey(req: Request): string | null {
  const path = String(req.originalUrl || req.path || "").split("?")[0];
  const normalized = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
  if (!(AUTH_RATE_LIMITED_PATHS as readonly string[]).includes(normalized)) return null;
  const ip = String(req.ip || req.socket?.remoteAddress || "unknown");
  return `${ip}:${normalized}`;
}

export function createAuthRateLimiter(opts?: {
  windowMs?: number;
  max?: number;
  store?: Map<string, HitRecord>;
}) {
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  const max = opts?.max ?? DEFAULT_MAX;
  const store = opts?.store ?? defaultHitStore;
  return (req: Request, res: Response, next: NextFunction) => {
    if (isSecurityExemptPath(req.path) || isSecurityExemptPath(req.originalUrl || "")) {
      return next();
    }
    const key = authRateLimitKey(req);
    if (!key) return next();
    const now = Date.now();
    const prev = store.get(key);
    if (!prev || prev.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (prev.count >= max) {
      const retry = Math.max(1, Math.ceil((prev.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retry));
      return res.status(429).json({ error: "Too many attempts. Try again later." });
    }
    prev.count += 1;
    return next();
  };
}

export function resetAuthRateLimitStore(store: Map<string, HitRecord> = defaultHitStore) {
  store.clear();
}

export function attachHttpSecurity(app: Express, env: NodeJS.ProcessEnv = process.env) {
  if ((app as Express & { __lumeraHttpSecurity?: boolean }).__lumeraHttpSecurity) return;
  (app as Express & { __lumeraHttpSecurity?: boolean }).__lumeraHttpSecurity = true;
  app.use(corsAllowlistMiddleware(env));
  app.use(csrfProtectionMiddleware());
  app.use(createAuthRateLimiter());
}

/** Install allowlist CORS / CSRF / rate-limit when the app enables trust proxy (server.ts). */
function patchExpressTrustProxyInstall() {
  const proto = express.application as express.Application & {
    set: (setting: string, ...args: unknown[]) => unknown;
    __lumeraTrustProxyPatched?: boolean;
  };
  if (proto.__lumeraTrustProxyPatched) return;
  proto.__lumeraTrustProxyPatched = true;
  const origSet = proto.set;
  proto.set = function patchedSet(this: Express, setting: string, ...args: unknown[]) {
    const result = origSet.apply(this, [setting, ...args] as never);
    if (setting === "trust proxy") {
      attachHttpSecurity(this);
    }
    return result;
  };
}

patchExpressTrustProxyInstall();

export function csrfCookieValue(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

export function csrfSetCookieHeader(token: string): string {
  return `${CSRF_COOKIE}=${encodeURIComponent(token)}; Path=/; SameSite=None; Secure; Partitioned; Max-Age=${7 * 24 * 60 * 60}`;
}

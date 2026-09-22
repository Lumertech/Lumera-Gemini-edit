/**
 * CORS allowlist, cookie CSRF, and auth-endpoint rate limits.
 * Meta / Razorpay webhooks and /healthz are exempt so signature-verified
 * callbacks are not blocked by browser Origin / CSRF / login throttles.
 *
 * Production is fail-closed for unknown Origins and for missing / literal
 * `null` Origin on mutating / API requests. Top-level document GETs
 * (SPA / HTML) often omit Origin, or send Origin: null after cross-origin
 * redirects / privacy contexts, and must not be blocked. Canonical host is
 * www; apex is allowed as a same-site companion and redirected to www on
 * safe navigations.
 */
import { type Express, type NextFunction, type Request, type Response } from "express";
import { applyHtmlDocumentSecurityHeaders } from "./html-security-headers.ts";
import { isUnsetOrPlaceholder } from "./runtime.ts";
import { isBackendPath, isHtmlDocumentPath } from "./spa-fallback.ts";

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

function isProductionFromEnv(env: NodeJS.ProcessEnv): boolean {
  return String(env.NODE_ENV || "") === "production";
}

/** Skip localhost / loopback / literal IPs when expanding www↔apex pairs. */
function isExpandablePublicHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (!h || h === "localhost") return false;
  if (h.endsWith(".localhost")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
  if (h.includes(":")) return false; // IPv6
  return h.includes(".");
}

/**
 * When www.example.com is allowlisted, also allow https://example.com (and the
 * reverse for bare apex hosts with exactly two DNS labels). Does not open * or
 * localhost — local defaults stay explicit via ALLOWED_ORIGINS / non-prod.
 */
export function withWwwApexCompanions(origins: string[]): string[] {
  const out = new Set(origins);
  for (const o of origins) {
    try {
      const u = new URL(o);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      if (!isExpandablePublicHost(u.hostname)) continue;
      if (u.hostname.startsWith("www.")) {
        const apex = new URL(o);
        apex.hostname = u.hostname.slice(4);
        out.add(apex.origin);
      } else if (u.hostname.split(".").length === 2) {
        const www = new URL(o);
        www.hostname = `www.${u.hostname}`;
        out.add(www.origin);
      }
    } catch {
      /* ignore malformed */
    }
  }
  return [...out];
}

export function parseAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = String(env.ALLOWED_ORIGINS || "").trim();
  const fromEnv = raw
    ? raw
        .split(",")
        .map((s) => s.trim().replace(/\/$/, ""))
        .filter((s) => s && !isUnsetOrPlaceholder(s))
    : [];
  if (fromEnv.length) return withWwwApexCompanions([...new Set(fromEnv)]);
  const appUrl = String(env.APP_URL || "").trim().replace(/\/$/, "");
  if (appUrl && !isUnsetOrPlaceholder(appUrl)) return withWwwApexCompanions([appUrl]);
  if (!isProductionFromEnv(env)) {
    return ["http://localhost:3000", "http://127.0.0.1:3000"];
  }
  return [];
}

export function isSecurityExemptPath(path: string): boolean {
  const p = String(path || "").split("?")[0];
  if (p === "/healthz") return true;
  if (p === "/data-deletion-callback") return true;
  if (p === "/api/meta/webhook" || p === "/meta/webhook") return true;
  if (p === "/api/meta/data-deletion" || p === "/meta/data-deletion") return true;
  if (p === "/api/meta/deauthorize" || p === "/meta/deauthorize") return true;
  if (p === "/api/billing/razorpay/webhook") return true;
  return false;
}

export function originAllowed(origin: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!origin) return false;
  const normalized = origin.trim().replace(/\/$/, "");
  return parseAllowedOrigins(env).includes(normalized);
}

function requestPathname(req: Request): string {
  return String(req.path || req.originalUrl || "").split("?")[0] || "/";
}

/**
 * Safe document navigations (GET/HEAD to any SPA/HTML path — /login, /app,
 * /w/{clinic}/… deep links, admin shells, etc.) omit Origin or send the
 * literal Origin: null (Chrome after cross-origin redirects). Not login-only:
 * anything that is not isBackendPath (/api, /uploads, /meta, /v3, …) qualifies.
 * Mutating methods and backend/API paths still require an allowlisted Origin
 * in production (except webhook/health exemptions).
 */
export function isSafeDocumentGetWithoutOrigin(req: Request): boolean {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  return !isBackendPath(requestPathname(req));
}

/** True when Origin is absent or the opaque literal `null` (case-insensitive). */
export function isMissingOrNullOrigin(origin: string | undefined): boolean {
  if (origin == null || origin === "") return true;
  return origin.trim().toLowerCase() === "null";
}

/**
 * Production is fail-closed for unknown Origin. Missing / literal `null`
 * Origin is rejected on mutating / API requests, but allowed for top-level
 * SPA/HTML GET/HEAD. Non-prod allows missing/null Origin (curl, tests).
 */
export function corsShouldReject(req: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  if (isSecurityExemptPath(req.path) || isSecurityExemptPath(req.originalUrl || "")) return false;
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  if (!isMissingOrNullOrigin(origin)) return !originAllowed(origin, env);
  if (!isProductionFromEnv(env)) return false;
  if (isSafeDocumentGetWithoutOrigin(req)) return false;
  return true;
}

/** Canonical public origin from APP_URL / first ALLOWED_ORIGINS entry (prefer www). */
export function canonicalPublicOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const appUrl = String(env.APP_URL || "").trim().replace(/\/$/, "");
  if (appUrl && !isUnsetOrPlaceholder(appUrl)) {
    try {
      return new URL(appUrl).origin;
    } catch {
      /* fall through */
    }
  }
  const allowed = parseAllowedOrigins(env);
  const www = allowed.find((o) => {
    try {
      return new URL(o).hostname.startsWith("www.");
    } catch {
      return false;
    }
  });
  return www || allowed[0] || null;
}

/**
 * 301 apex → www for browser document navigations when APP_URL/canonical is www.
 * Does not redirect API/backend paths (those rely on apex being in the allowlist).
 */
export function canonicalHostRedirectMiddleware(env: NodeJS.ProcessEnv = process.env) {
  return (req: Request, res: Response, next: NextFunction) => {
    const method = String(req.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") return next();
    if (isBackendPath(requestPathname(req))) return next();

    const canonical = canonicalPublicOrigin(env);
    if (!canonical) return next();
    let canonicalUrl: URL;
    try {
      canonicalUrl = new URL(canonical);
    } catch {
      return next();
    }
    if (!canonicalUrl.hostname.startsWith("www.")) return next();

    const rawHost = String(req.headers["x-forwarded-host"] || req.headers.host || "")
      .split(",")[0]
      .trim()
      .toLowerCase();
    const hostname = rawHost.split(":")[0];
    const apexHost = canonicalUrl.hostname.slice(4);
    if (!hostname || hostname !== apexHost) return next();

    const target = new URL(req.originalUrl || req.url || "/", canonicalUrl.origin);
    return res.redirect(301, target.toString());
  };
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

/** Document navigations only. API JSON must not pick up a page CSP. */
export function shouldAttachHtmlSecurityHeaders(req: Request): boolean {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  return isHtmlDocumentPath(requestPathname(req));
}

export function htmlDocumentSecurityMiddleware(env: NodeJS.ProcessEnv = process.env) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (shouldAttachHtmlSecurityHeaders(req)) {
      applyHtmlDocumentSecurityHeaders(res, env);
    }
    next();
  };
}

export function attachHttpSecurity(app: Express, env: NodeJS.ProcessEnv = process.env) {
  if ((app as Express & { __lumeraHttpSecurity?: boolean }).__lumeraHttpSecurity) return;
  (app as Express & { __lumeraHttpSecurity?: boolean }).__lumeraHttpSecurity = true;
  app.disable("x-powered-by");
  app.use(canonicalHostRedirectMiddleware(env));
  app.use(corsAllowlistMiddleware(env));
  app.use(htmlDocumentSecurityMiddleware(env));
  app.use(csrfProtectionMiddleware());
  app.use(createAuthRateLimiter());
}

export function csrfCookieValue(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

export function csrfSetCookieHeader(token: string): string {
  return `${CSRF_COOKIE}=${encodeURIComponent(token)}; Path=/; SameSite=None; Secure; Partitioned; Max-Age=${7 * 24 * 60 * 60}`;
}

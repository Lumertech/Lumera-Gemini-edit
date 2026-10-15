/**
 * CORS allowlist, cookie CSRF, and auth-endpoint rate limits.
 * Meta / Razorpay webhooks and /healthz are exempt so signature-verified
 * callbacks are not blocked by browser Origin / CSRF / login throttles.
 *
 * Production is fail-closed for unknown Origins and for the literal `null`
 * Origin on API requests. Top-level document GETs (SPA / HTML) often omit
 * Origin, or send Origin: null after cross-origin redirects / privacy
 * contexts, and must not be blocked. Browsers also omit Origin on
 * same-origin calls. A missing Origin is allowed only when Sec-Fetch-Site
 * is exactly `same-origin` (any method) or exactly `none` on GET/HEAD.
 * Missing, `same-site`, `cross-site`, and any other value are rejected.
 * Referer is not a substitute. Canonical host is www; apex is allowed as a
 * same-site companion and redirected to www on safe navigations.
 *
 * The session JWT is not a browser credential. `clientMayUseSessionToken`
 * documents when login JSON may include `token` and when
 * `Authorization: Bearer` / `X-Session-Token` are accepted.
 */
import { type Express, type NextFunction, type Request, type Response } from "express";
import { applyHtmlDocumentSecurityHeaders } from "./html-security-headers.ts";
import { isUnsetOrPlaceholder } from "./runtime.ts";
import { isBackendPath, isHtmlDocumentPath } from "./spa-fallback.ts";

export const CSRF_COOKIE = "lumera_csrf";
export const CSRF_HEADER = "x-csrf-token";
/** Anonymous CSRF failure: client may retry the same mutation once with this secret. */
export const CSRF_REFRESHED_CODE = "CSRF_REFRESHED";
export const SESSION_COOKIE = "lumera_sid";
/**
 * Firebase Hosting rewrites www.mylumera.in to Cloud Run and strips every
 * inbound cookie except `__session` (it is also the CDN cache key).
 * `lumera_sid` still reaches the browser, and direct Cloud Run, but not the app.
 */
export const HOST_SESSION_COOKIE = "__session";
/** Splits the JWT from the CSRF secret inside `__session`. Neither side contains `~`. */
const HOST_SESSION_SEP = "~";

export const AUTH_RATE_LIMITED_PATHS = [
  "/api/auth/login",
  "/api/auth/demo-login",
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

function csrfRequestPath(req: Request): string {
  const raw = String(req.originalUrl || req.path || "").split("?")[0] || "/";
  return raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

/**
 * Pre-auth mutations keep #133 header-match across duplicate `__session`
 * cookies, including when a leftover authenticated cookie is also present.
 * Authenticated actions bind CSRF to the cookie that actually authenticated.
 */
const LOOSE_DUPLICATE_CSRF_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/demo-login",
  "/api/auth/oauth",
  "/api/auth/whatsapp/send-otp",
  "/api/auth/whatsapp/verify-otp",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/register-practice",
  "/api/auth/register-clinic",
]);

function keepsLooseDuplicateCsrf(req: Request): boolean {
  const path = csrfRequestPath(req);
  if (LOOSE_DUPLICATE_CSRF_PATHS.has(path)) return true;
  return LOOSE_DUPLICATE_CSRF_PATHS.has(`/api${path.startsWith("/") ? path : `/${path}`}`);
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

function headerOne(req: Request, name: string): string {
  const raw = req.headers[name];
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0].trim();
  return "";
}

function isApiRequestPath(pathname: string): boolean {
  const p = (pathname.split("?")[0] || "/").toLowerCase();
  return p === "/api" || p.startsWith("/api/");
}

/** Opaque `null` Origin (privacy / sandboxed). Not the same as a header the browser omitted. */
function isLiteralNullOrigin(origin: string): boolean {
  return origin.trim().toLowerCase() === "null";
}

/**
 * Missing Origin on /api. Sec-Fetch-Site must be exactly `same-origin`
 * (any method) or exactly `none` on GET/HEAD. Missing, `same-site`,
 * `cross-site`, and every other value are rejected. Referer is ignored.
 * A present Origin is never accepted here. Literal Origin: null is not
 * an absent Origin.
 */
function allowsAbsentOriginApiRequest(req: Request): boolean {
  if (!isApiRequestPath(requestPathname(req))) return false;
  const site = headerOne(req, "sec-fetch-site");
  if (site === "same-origin") return true;
  if (site !== "none") return false;
  const method = String(req.method || "GET").toUpperCase();
  return method === "GET" || method === "HEAD";
}

/**
 * Production is fail-closed for unknown Origin. Literal `null` Origin is
 * rejected on API requests, but allowed for top-level SPA/HTML GET/HEAD.
 * An omitted Origin on /api is allowed only for exact `Sec-Fetch-Site:
 * same-origin`, or exact `none` on GET/HEAD. Non-prod allows missing/null
 * Origin (curl, tests). Cookie CSRF on state-changing methods is unchanged
 * and runs after this check.
 */
export function corsShouldReject(req: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  if (isSecurityExemptPath(req.path) || isSecurityExemptPath(req.originalUrl || "")) return false;
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  if (!isMissingOrNullOrigin(origin)) return !originAllowed(origin, env);
  if (!isProductionFromEnv(env)) return false;
  if (isSafeDocumentGetWithoutOrigin(req)) return false;
  if (isLiteralNullOrigin(origin)) return true;
  if (allowsAbsentOriginApiRequest(req)) return false;
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

export function packHostSession(credential: string, csrf: string): string {
  return `${credential}${HOST_SESSION_SEP}${csrf}`;
}

export function unpackHostSession(raw: string): { credential: string; csrf: string } {
  const value = String(raw || "");
  const idx = value.lastIndexOf(HOST_SESSION_SEP);
  if (idx <= 0) return { credential: value, csrf: "" };
  return { credential: value.slice(0, idx), csrf: value.slice(idx + 1) };
}

/**
 * Every value for `name`, in header order. Chrome sends the oldest cookie
 * first and the newest last when paths are equal, so the last entry is the
 * newest. Duplicates happen when an older build set the same name with a
 * different Domain or Path; a host-only Path=/ clear does not remove those.
 */
export function listCookieValues(header: string | undefined, name: string): string[] {
  const out: string[] = [];
  if (!header || !name) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== name) continue;
    const raw = part.slice(idx + 1).trim();
    if (!raw) continue;
    try {
      out.push(decodeURIComponent(raw));
    } catch {
      out.push(raw);
    }
  }
  return out;
}

/**
 * `__session` whose embedded CSRF secret equals `csrfHeader`. When several
 * match, the last one (newest, in Chrome's order) wins. When none match, the
 * newest is still the one a single-cookie parser would have kept.
 */
export function selectHostSession(cookieHeader: string | undefined, csrfHeader: string): string {
  const values = listCookieValues(cookieHeader, HOST_SESSION_COOKIE);
  if (!values.length) return "";
  const wanted = csrfHeader.trim();
  if (wanted) {
    const matches = values.filter((value) => unpackHostSession(value).csrf === wanted);
    if (matches.length) return matches[matches.length - 1];
  }
  return values[values.length - 1];
}

/**
 * What Cloud Run actually receives for a browser cookie jar on www.mylumera.in.
 * Tests use this so a green run cannot depend on `lumera_sid`, which Hosting drops.
 * Every `__session` is kept, in order, so a duplicate Domain cookie is visible.
 */
export function cookiesForwardedByFirebaseHosting(cookieHeader: string): string {
  const sessions = listCookieValues(cookieHeader, HOST_SESSION_COOKIE);
  if (!sessions.length) return "";
  return sessions.map((value) => `${HOST_SESSION_COOKIE}=${encodeURIComponent(value)}`).join("; ");
}

/** Paths an older build may have stored. `/api/auth` defaults to directory `/api`. */
const STALE_COOKIE_PATHS = ["/", "/api"] as const;

const SESSION_COOKIE_NAMES: Array<{ name: string; httpOnly: boolean }> = [
  { name: HOST_SESSION_COOKIE, httpOnly: true },
  { name: SESSION_COOKIE, httpOnly: true },
  { name: CSRF_COOKIE, httpOnly: false },
];

/**
 * Older builds set SameSite=None; Partitioned copies. Chrome treats those as
 * different cookies from the Lax ones, so a Lax Max-Age=0 does not delete them.
 * These lines only expire. Nothing in the app sets a Partitioned value cookie.
 */
export function partitionedCookieExpiryLines(): string[] {
  return SESSION_COOKIE_NAMES.map(({ name, httpOnly }) => {
    const parts = [`${name}=`, "Path=/", "Max-Age=0", "Secure", "SameSite=None", "Partitioned"];
    if (httpOnly) parts.push("HttpOnly");
    return parts.join("; ");
  });
}

function publicHostnames(env: NodeJS.ProcessEnv): string[] {
  const hosts: string[] = [];
  for (const origin of parseAllowedOrigins(env)) {
    try {
      const hostname = new URL(origin).hostname.toLowerCase();
      if (!isExpandablePublicHost(hostname)) continue;
      if (!hosts.includes(hostname)) hosts.push(hostname);
    } catch {
      /* ignore malformed */
    }
  }
  return hosts;
}

/** Domain attributes to expire for an allowlisted public host. Never a public suffix. */
export function cookieDomainsToExpire(hostname: string): string[] {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "").split(":")[0];
  if (!isExpandablePublicHost(host)) return [];
  const labels = host.split(".");
  const domains: string[] = [];
  const push = (domain: string) => {
    if (!domains.includes(domain)) domains.push(domain);
    const dotted = domain.startsWith(".") ? domain : `.${domain}`;
    if (!domains.includes(dotted)) domains.push(dotted);
  };
  push(host);
  for (let i = 1; i <= labels.length - 2; i++) push(labels.slice(i).join("."));
  return domains;
}

function expireCookieLine(name: string, opts: { path: string; domain?: string; httpOnly: boolean }): string {
  const parts = [`${name}=`, `Path=${opts.path}`, "Max-Age=0", "Secure", "SameSite=Lax"];
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  return parts.join("; ");
}

function allowlistedCookieDomains(env: NodeJS.ProcessEnv): string[] {
  return [...new Set(publicHostnames(env).flatMap((host) => cookieDomainsToExpire(host)))];
}

/**
 * Clears sent before the new anonymous cookie. Host-only, `.mylumera.in`, and
 * `mylumera.in` (from the allowlist), on Path=/ and Path=/api, for `__session`
 * and `lumera_csrf`. A browser applies these before the retry, so the user
 * does not have to clear cookies by hand.
 * Domains come only from the CORS allowlist / APP_URL, not from a request header.
 */
export function refreshSessionExpiryLines(env: NodeJS.ProcessEnv = process.env): string[] {
  const domains = allowlistedCookieDomains(env);
  const lines: string[] = [...partitionedCookieExpiryLines()];
  for (const { name, httpOnly } of SESSION_COOKIE_NAMES) {
    for (const path of STALE_COOKIE_PATHS) {
      lines.push(expireCookieLine(name, { path, httpOnly }));
      for (const domain of domains) {
        lines.push(expireCookieLine(name, { path, httpOnly, domain }));
      }
    }
  }
  return lines;
}

/**
 * Variant clears that are safe to append after a new host-only Path=/ cookie.
 * Host-only Path=/ is omitted so it cannot delete the cookie just set.
 * Empty when the allowlist has no public host (local tests).
 */
export function sessionCookieExpiryLines(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!allowlistedCookieDomains(env).length) return [];
  return refreshSessionExpiryLines(env).filter((line) => /domain=/i.test(line) || /path=\/api(?:;|$)/i.test(line));
}

function isMutating(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method || "GET").toUpperCase());
}

/**
 * Session JWT in login JSON, and as `Authorization: Bearer` or `X-Session-Token`.
 *
 * A browser request is one that carries `Sec-Fetch-Site` or `Origin`. Browsers
 * send `Sec-Fetch-Site` on every request; page scripts cannot omit or rewrite
 * it. They send `Origin` on CORS requests and on mutating requests. Literal
 * `Origin: null` counts as present here. CORS still treats that literal as
 * missing and fail-closes it on `/api` in production — this check does not
 * change that.
 *
 * Those browser requests do not receive `token` and their Bearer /
 * `X-Session-Token` headers are ignored, so a page script cannot capture the
 * credential at login and replay it. Cookie sessions and cookie CSRF stay in
 * force. A browser-presented bearer does not skip CSRF.
 *
 * The credential is returned and the header is accepted only when either:
 * - `X-Client` is `mobile`, `ios`, `android`, or `native` (case-insensitive,
 *   comma-separated values allowed), even if `Sec-Fetch-Site` or `Origin` is
 *   also present. That mark is how Android, iOS, and other native clients
 *   identify themselves when their HTTP stack or WebView sends Origin or
 *   Fetch Metadata; or
 * - neither `Sec-Fetch-Site` nor `Origin` is present. curl, this repo's
 *   server tests, and URLSession / OkHttp calls that do not set those headers
 *   take this path.
 *
 * This repository has no Android or iOS source. Those clients authenticate
 * with the login JSON `token` as Bearer or `X-Session-Token`. Production CORS
 * is unchanged: an `/api` call with neither an allowlisted Origin nor
 * `Sec-Fetch-Site: same-origin` (or `none` on GET/HEAD) is still rejected.
 * `X-Client` does not bypass CORS. A native client that sends Origin to pass
 * that gate must also send `X-Client`.
 *
 * An accepted native bearer still skips cookie CSRF, because those clients
 * do not hold the cookie pair.
 */
const NATIVE_CLIENT_MARKS = new Set(["mobile", "ios", "android", "native"]);

export function explicitNativeClient(req: Request): boolean {
  const raw = req.headers["x-client"];
  const chunks = (Array.isArray(raw) ? raw : raw == null ? [] : [raw]).flatMap((value) =>
    String(value)
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
  );
  return chunks.some((part) => NATIVE_CLIENT_MARKS.has(part));
}

export function browserMetadataPresent(req: Request): boolean {
  return Boolean(headerOne(req, "sec-fetch-site") || headerOne(req, "origin"));
}

/** True when login JSON may include `token` and header credentials may authenticate. */
export function clientMayUseSessionToken(req: Request): boolean {
  if (explicitNativeClient(req)) return true;
  return !browserMetadataPresent(req);
}

/** Bearer or `X-Session-Token` when this request is allowed to present one. */
export function acceptedHeaderCredential(req: Request): string | null {
  if (!clientMayUseSessionToken(req)) return null;
  const auth = req.headers.authorization;
  const authValue = Array.isArray(auth) ? auth[0] : auth;
  if (typeof authValue === "string" && authValue.toLowerCase().startsWith("bearer ")) {
    const token = authValue.slice(7).trim();
    if (token) return token;
  }
  const xToken = req.headers["x-session-token"];
  const xValues = Array.isArray(xToken) ? xToken : xToken == null ? [] : [xToken];
  for (const value of xValues) {
    const token = String(value || "").trim();
    if (token) return token;
  }
  return null;
}

function hasBearerOrSessionHeader(req: Request): boolean {
  return Boolean(acceptedHeaderCredential(req));
}

function csrfHeaderValue(req: Request): string {
  return String(req.headers[CSRF_HEADER] || req.headers["X-CSRF-Token"] || "").trim();
}

function expectedCsrf(cookieHeader: string | undefined, csrfHeader: string): string {
  const selected = selectHostSession(cookieHeader, csrfHeader);
  if (selected) {
    const embedded = unpackHostSession(selected).csrf;
    if (embedded) return embedded;
  }
  const readable = listCookieValues(cookieHeader, CSRF_COOKIE);
  if (csrfHeader && readable.includes(csrfHeader)) return csrfHeader;
  return readable.length ? readable[readable.length - 1] : "";
}

function hasSessionCookie(cookieHeader: string | undefined): boolean {
  return listCookieValues(cookieHeader, HOST_SESSION_COOKIE).length > 0 || listCookieValues(cookieHeader, SESSION_COOKIE).length > 0;
}

/**
 * Cookie-only mutating requests must echo the CSRF secret as X-CSRF-Token.
 * On Firebase Hosting the non-HttpOnly `lumera_csrf` cookie is not forwarded;
 * the secret travels inside `__session`, and the browser still reads `lumera_csrf`
 * to set the header.
 * An accepted native bearer skips this check. A bearer on a browser request
 * (`Sec-Fetch-Site` or `Origin`, without `X-Client: mobile|ios|android|native`)
 * does not: the header is ignored and the cookie still needs its CSRF secret.
 */
export function csrfShouldReject(req: Request): boolean {
  if (isSecurityExemptPath(req.path) || isSecurityExemptPath(req.originalUrl || "")) return false;
  if (!isMutating(req.method)) return false;
  if (hasBearerOrSessionHeader(req)) return false;
  const cookieHeader = typeof req.headers.cookie === "string" ? req.headers.cookie : "";
  const headerToken = csrfHeaderValue(req);
  const hostSessions = listCookieValues(cookieHeader, HOST_SESSION_COOKIE);
  // Firebase Hosting forwards only __session. The page can still send
  // X-CSRF-Token read from lumera_csrf, which never reaches Cloud Run.
  // That anonymous same-origin request is refreshable. A cookieless request
  // with no token (curl) is unchanged.
  if (!hostSessions.length && headerToken && !hasSessionCookie(cookieHeader)) return true;
  if (!hasSessionCookie(cookieHeader)) return false;
  const cookieToken = expectedCsrf(cookieHeader, headerToken);
  return !cookieToken || !headerToken || cookieToken !== headerToken;
}

export function corsAllowlistMiddleware(env: NodeJS.ProcessEnv = process.env) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    // No Origin (and any disallowed Origin) must not receive ACAO or
    // Allow-Credentials. Only an allowlisted Origin is echoed.
    if (origin && originAllowed(origin, env)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-CSRF-Token, X-Session-Token, X-Client"
      );
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

function csrfReject(res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(403).json({ error: "CSRF token missing or invalid" });
}

/**
 * Anonymous reissue clears the browser's session cookie. Only a same-origin
 * request, or an Origin already on the CORS allowlist, may trigger that.
 * A cross-site form POST (Sec-Fetch-Site: cross-site, or a foreign Origin)
 * stays a plain 403 so it cannot log the user out.
 */
export function csrfRefreshAllowed(req: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  if (headerOne(req, "sec-fetch-site") === "same-origin") return true;
  return originAllowed(headerOne(req, "origin"), env);
}

/**
 * Cookie CSRF stays on, including login. A stale anonymous `__session` (no
 * valid user in `__session` or `lumera_sid`) is replaced with a fresh secret
 * so the browser can retry once, but only when `csrfRefreshAllowed` is true.
 * A credential that still authenticates is rejected with no new cookie and
 * no token — reissue there would bypass CSRF.
 */
export function csrfProtectionMiddleware(env: NodeJS.ProcessEnv = process.env) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Login and the other pre-auth posts still accept the __session whose
    // secret matches the header (#133), even if another cookie authenticates.
    if (
      keepsLooseDuplicateCsrf(req) ||
      hasBearerOrSessionHeader(req) ||
      !isMutating(req.method) ||
      isSecurityExemptPath(req.path) ||
      isSecurityExemptPath(req.originalUrl || "")
    ) {
      if (!csrfShouldReject(req)) return next();
      if (!csrfRefreshAllowed(req, env)) return csrfReject(res);
      return refreshAnonymousCsrf(req, res, env);
    }
    void (async () => {
      try {
        const { authenticatedCookieCsrf } = await import("./auth.ts");
        const bound = authenticatedCookieCsrf(req);
        if (bound != null) {
          // Authenticated duplicate: only that cookie's secret is valid.
          // No Set-Cookie and no CSRF_REFRESHED — a real session is not reissued.
          if (!bound || csrfHeaderValue(req) !== bound) return csrfReject(res);
          return next();
        }
        if (!csrfShouldReject(req)) return next();
        if (!csrfRefreshAllowed(req, env)) return csrfReject(res);
        return refreshAnonymousCsrf(req, res, env);
      } catch {
        if (!res.headersSent) return csrfReject(res);
      }
    })();
  };
}

function refreshAnonymousCsrf(req: Request, res: Response, env: NodeJS.ProcessEnv) {
  void (async () => {
    try {
      const { sessionCookieIsAuthenticated, issueAnonymousCsrfCookie } = await import("./auth.ts");
      if (sessionCookieIsAuthenticated(req)) return csrfReject(res);
      const token = issueAnonymousCsrfCookie(res, env);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-CSRF-Token", token);
      return res.status(403).json({
        error: "CSRF token missing or invalid",
        code: CSRF_REFRESHED_CODE,
        csrfToken: token,
      });
    } catch {
      if (!res.headersSent) return csrfReject(res);
    }
  })();
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
  app.use(csrfProtectionMiddleware(env));
  app.use(createAuthRateLimiter());
}

export function csrfCookieValue(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

export function csrfSetCookieHeader(token: string): string {
  return `${CSRF_COOKIE}=${encodeURIComponent(token)}; Path=/; SameSite=Lax; Secure; Max-Age=${7 * 24 * 60 * 60}`;
}

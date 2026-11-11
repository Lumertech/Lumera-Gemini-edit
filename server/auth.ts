import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { isDemoAccountEmail } from "../src/lib/demoAccounts.ts";
import { getDb, publicUser, type DbUser, type UserRole } from "./db.ts";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  HOST_SESSION_COOKIE,
  csrfCookieValue,
  csrfRefreshAllowed,
  csrfSetCookieHeader,
  acceptedHeaderCredential,
  listCookieValues,
  packHostSession,
  partitionedCookieExpiryLines,
  refreshSessionExpiryLines,
  selectHostSession,
  sessionCookieExpiryLines,
  unpackHostSession,
} from "./http-security.ts";
import { clinicTenantAccessError } from "./platform-tenants.ts";

/** Clinician login has authenticated the account and then found no WhatsApp number. */
export const USER_PHONE_MISSING = "USER_PHONE_MISSING";

const COOKIE = "lumera_sid";
const SESSION_DAYS = 7;

export function isProductionEnv(nodeEnv = process.env.NODE_ENV): boolean {
  return nodeEnv === "production";
}

/** skipOtp is a local/demo convenience only — never honor it in production. */
export function allowSkipOtp(nodeEnv = process.env.NODE_ENV): boolean {
  return !isProductionEnv(nodeEnv);
}

/** Echo OTPs in JSON only outside production (no live WhatsApp/SMS in local). */
export function allowOtpEcho(nodeEnv = process.env.NODE_ENV): boolean {
  return !isProductionEnv(nodeEnv);
}

export function otpEchoPayload(otp: string): { demoOtp?: string } {
  return allowOtpEcho() ? { demoOtp: otp } : {};
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (typeof secret !== "string" || secret.trim() === "") {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return secret;
}

export interface JwtTokenPayload {
  userId: string;
  tenantId: string;
  email?: string;
  role?: string;
  name?: string;
}

export function signJwtToken(payload: JwtTokenPayload): string {
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, getJwtSecret(), { expiresIn: `${SESSION_DAYS}d` });
}

/** Cookie + Bearer share one JWT shape (OTP verify, Facebook OAuth, skipOtp). */
export function issueLumeraSession(res: Response, user: DbUser): string {
  const jwtToken = signJwtToken({
    userId: user.id,
    tenantId: user.tenant_id || "",
    email: user.email,
    role: user.role,
    name: user.name,
  });
  // New credential and a new CSRF secret. The previous secret must not keep
  // working with this cookie. Callers put `res.locals.csrfToken` in the JSON
  // body; the header is set here so the page can adopt it on the same response.
  setSessionCookie(res, jwtToken);
  // Row is in the shared SQL database (Postgres in production). There is no
  // process-local session map: each instance verifies this JWT with JWT_SECRET
  // and loads the user from that database. Login JSON includes this JWT only
  // when `clientMayUseSessionToken` is true (no `Sec-Fetch-Site`, and either
  // native `X-Client` or no `Origin`). The web app never reads it, and /me
  // does not echo it.
  createSession(user.id);
  return jwtToken;
}

export function verifyJwtToken(token: string): JwtTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (decoded && typeof decoded === "object" && (decoded as any).userId) {
      return decoded as JwtTokenPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export interface AuthUser {
  id: string;
  tenantId?: string;
  email: string;
  name: string;
  role: UserRole;
  status: string;
  phone: string;
  lastLogin: string | null;
  createdAt: string;
  clinicName?: string;
  hprId?: string;
  onboardingCompleted?: boolean;
  practiceType?: "individual" | "polyclinic";
  specialty?: string;
  packId?: string;
  workspaceSlug?: string;
  roleHome?: "admin" | "app" | "portal" | "login";
  homeView?: string;
  isDemoWorkspace?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      rawBody?: Buffer;
    }
  }
}

function parseCookies(header?: string): Record<string, string> {
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

const SESSION_COOKIE_ATTRS = "HttpOnly; Path=/; SameSite=Lax; Secure";
const CLEAR_CSRF_ATTRS = "Path=/; SameSite=Lax; Secure";

export function setSessionCookie(res: Response, sessionId: string): string {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const csrf = csrfCookieValue();
  const sid = `${COOKIE}=${encodeURIComponent(sessionId)}; ${SESSION_COOKIE_ATTRS}; Max-Age=${maxAge}`;
  // `__session` is the only cookie Firebase Hosting forwards to Cloud Run.
  // It carries the same JWT as lumera_sid plus the CSRF secret, because
  // lumera_csrf is stripped on the way in. lumera_sid / lumera_csrf stay for
  // direct Cloud Run and for the browser script that sets X-CSRF-Token.
  const host = `${HOST_SESSION_COOKIE}=${encodeURIComponent(packHostSession(sessionId, csrf))}; ${SESSION_COOKIE_ATTRS}; Max-Age=${maxAge}`;
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-CSRF-Token", csrf);
  res.locals.csrfToken = csrf;
  // Value cookies first so a reader that keeps the first pair still sees them.
  // Variant clears follow and do not share the host-only Path=/ slot.
  res.setHeader("Set-Cookie", [
    sid,
    host,
    csrfSetCookieHeader(csrf),
    ...sessionCookieExpiryLines(),
    ...partitionedCookieExpiryLines(),
  ]);
  return csrf;
}

export function clearSessionCookie(res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Set-Cookie", [
    `${HOST_SESSION_COOKIE}=; ${SESSION_COOKIE_ATTRS}; Max-Age=0`,
    `${COOKIE}=; ${SESSION_COOKIE_ATTRS}; Max-Age=0`,
    `${CSRF_COOKIE}=; ${CLEAR_CSRF_ATTRS}; Max-Age=0`,
    ...sessionCookieExpiryLines(),
    ...partitionedCookieExpiryLines(),
  ]);
}

function appendSetCookies(res: Response, lines: string[]) {
  if (!lines.length) return;
  const prev = res.getHeader("Set-Cookie");
  const existing = prev == null ? [] : Array.isArray(prev) ? prev.map(String) : [String(prev)];
  res.setHeader("Set-Cookie", [...existing, ...lines]);
}

/**
 * Page load calls GET /api/auth/me with no __session when Firebase has stripped
 * lumera_sid and lumera_csrf. Issue a host-only __session (credential~csrf)
 * so the next login can echo that secret. Never rotates a real session, and
 * never sets a cookie for a cross-site request.
 */
export function ensureBrowserCsrf(req: Request, res: Response, env: NodeJS.ProcessEnv = process.env): string {
  if (!csrfRefreshAllowed(req, env)) return "";
  const header = cookieHeaderOf(req);
  appendSetCookies(res, partitionedCookieExpiryLines());
  if (sessionCookieIsAuthenticated(req)) {
    // The secret of the cookie that authenticated, not a duplicate whose
    // CSRF happened to match the header or happened to be last.
    const csrf = authenticatedCookieCsrf(req) || "";
    if (csrf) res.setHeader("X-CSRF-Token", csrf);
    return csrf;
  }
  const existing = selectHostSession(header, "");
  const embedded = unpackHostSession(existing).csrf;
  if (existing && embedded) {
    res.setHeader("X-CSRF-Token", embedded);
    return embedded;
  }
  const csrf = issueAnonymousCsrfCookie(res, env);
  res.setHeader("X-CSRF-Token", csrf);
  return csrf;
}

/**
 * Replace a dead `__session` with a new anonymous cookie that carries a fresh
 * CSRF secret. The credential is not a JWT and is not inserted into `sessions`,
 * so the next request stays logged out until a real login. Cookie flags match
 * the authenticated session cookie.
 */
export function issueAnonymousCsrfCookie(res: Response, env: NodeJS.ProcessEnv = process.env): string {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const csrf = csrfCookieValue();
  const credential = `anon.${crypto.randomUUID()}`;
  const host = `${HOST_SESSION_COOKIE}=${encodeURIComponent(packHostSession(credential, csrf))}; ${SESSION_COOKIE_ATTRS}; Max-Age=${maxAge}`;
  res.setHeader("Cache-Control", "private, no-store");
  // Clears first, including Domain/Path variants, then the new host-only cookie.
  res.setHeader("Set-Cookie", [
    ...refreshSessionExpiryLines(env),
    host,
    csrfSetCookieHeader(csrf),
  ]);
  return csrf;
}

function cookieHeaderOf(req: Request): string {
  const raw = req.headers.cookie;
  return typeof raw === "string" ? raw : "";
}

function presentedCsrfHeader(req: Request): string {
  const raw = req.headers[CSRF_HEADER] ?? req.headers["X-CSRF-Token"];
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0].trim();
  return "";
}

/**
 * True when any presented `__session` or `lumera_sid` belongs to a real user.
 * A stale duplicate must not hide a still-valid cookie: either one blocks
 * anonymous CSRF reissue.
 */
export function sessionCookieIsAuthenticated(req: Request): boolean {
  const header = cookieHeaderOf(req);
  for (const raw of listCookieValues(header, HOST_SESSION_COOKIE)) {
    const credential = unpackHostSession(raw).credential.trim();
    if (credential && userFromCredential(credential)) return true;
  }
  for (const sid of listCookieValues(header, COOKIE)) {
    if (sid && userFromCredential(sid)) return true;
  }
  return false;
}

export function createSession(userId: string): string {
  const id = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  getDb()
    .prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(id, userId, expires.toISOString(), now.toISOString());
  return id;
}

export function destroySession(sessionId: string) {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

function credentialHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function ensureRevokedCredentialsTable() {
  getDb().exec(
    `CREATE TABLE IF NOT EXISTS revoked_credentials (
      token_hash TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`
  );
}

function credentialExpiryIso(token: string): string {
  const decoded = jwt.decode(token);
  if (decoded && typeof decoded === "object" && typeof (decoded as { exp?: unknown }).exp === "number") {
    return new Date(Number((decoded as { exp: number }).exp) * 1000).toISOString();
  }
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function isCredentialRevoked(token: string): boolean {
  const raw = String(token || "").trim();
  if (!raw) return false;
  try {
    ensureRevokedCredentialsTable();
    const row = getDb()
      .prepare("SELECT token_hash FROM revoked_credentials WHERE token_hash = ? AND expires_at > ?")
      .get(credentialHash(raw), new Date().toISOString()) as { token_hash?: string } | undefined;
    return Boolean(row?.token_hash);
  } catch {
    return false;
  }
}

/** Invalidate the presented Bearer / cookie JWT. Other unrevoked bearers keep working. */
export function revokePresentedCredential(token: string): void {
  const raw = String(token || "").trim();
  if (!raw) return;
  ensureRevokedCredentialsTable();
  const now = new Date().toISOString();
  const hash = credentialHash(raw);
  const existing = getDb().prepare("SELECT token_hash FROM revoked_credentials WHERE token_hash = ?").get(hash);
  if (existing) {
    getDb().prepare("UPDATE revoked_credentials SET expires_at = ? WHERE token_hash = ?").run(credentialExpiryIso(raw), hash);
    return;
  }
  getDb()
    .prepare("INSERT INTO revoked_credentials (token_hash, expires_at, created_at) VALUES (?, ?, ?)")
    .run(hash, credentialExpiryIso(raw), now);
}

/**
 * Drop server session rows for this login and revoke the presented credential.
 * Does not revoke a different bearer still held by another client.
 */
export function endPresentedSession(token: string | null): void {
  const raw = String(token || "").trim();
  if (!raw) return;
  if (!isCredentialRevoked(raw)) {
    const payload = verifyJwtToken(raw);
    if (payload?.userId) {
      getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(payload.userId);
    } else {
      destroySession(raw);
    }
  }
  revokePresentedCredential(raw);
}

/**
 * Last `__session` whose credential is a real user. Header match does not
 * promote a non-authenticating duplicate ahead of this cookie.
 */
function authenticatingHostSession(cookieHeader: string): string {
  let chosen = "";
  for (const raw of listCookieValues(cookieHeader, HOST_SESSION_COOKIE)) {
    const credential = unpackHostSession(raw).credential.trim();
    if (credential && userFromCredential(credential)) chosen = raw;
  }
  return chosen;
}

/**
 * CSRF secret bound to the cookie that authenticated.
 * Null when no cookie authenticated (anonymous header-match rules apply).
 * Empty string when a cookie authenticated but it carried no secret.
 */
export function authenticatedCookieCsrf(req: Request): string | null {
  const header = cookieHeaderOf(req);
  const host = authenticatingHostSession(header);
  if (host) return unpackHostSession(host).csrf;
  const sid = parseCookies(header)[COOKIE];
  if (!sid || !userFromCredential(sid)) return null;
  const paired = listCookieValues(header, HOST_SESSION_COOKIE).filter(
    (raw) => unpackHostSession(raw).credential.trim() === sid.trim()
  );
  if (paired.length) return unpackHostSession(paired[paired.length - 1]).csrf;
  const readable = listCookieValues(header, CSRF_COOKIE);
  const presented = presentedCsrfHeader(req);
  if (presented && readable.includes(presented)) return presented;
  return readable.length ? readable[readable.length - 1] : "";
}

export function getSessionId(req: Request): string | null {
  // Header credential only when `clientMayUseSessionToken` is true.
  // Any `Sec-Fetch-Site` is a browser: `X-Client` cannot bring Bearer back.
  // This repo has no Android or iOS tree; those apps send Bearer or
  // X-Session-Token, with `X-Client` when they also send Origin and no
  // Sec-Fetch-Site.
  const headerCredential = acceptedHeaderCredential(req);
  if (headerCredential) return headerCredential;
  const header = cookieHeaderOf(req);
  const host = authenticatingHostSession(header);
  if (host) {
    const credential = unpackHostSession(host).credential.trim();
    if (credential) return credential;
  }
  const cookies = parseCookies(header);
  if (cookies[COOKIE] && userFromCredential(cookies[COOKIE])) return cookies[COOKIE];
  const anon = selectHostSession(header, presentedCsrfHeader(req));
  if (anon) {
    const credential = unpackHostSession(anon).credential.trim();
    if (credential) return credential;
  }
  return cookies[COOKIE] || null;
}

function userFromCredential(sid: string): AuthUser | null {
  if (!sid) return null;
  if (isCredentialRevoked(sid)) return null;

  // 1. Try decoding as JWT token (which contains userId & tenantId)
  const jwtPayload = verifyJwtToken(sid);
  if (jwtPayload?.userId) {
    const userRow = getDb().prepare("SELECT * FROM users WHERE id = ?").get(jwtPayload.userId) as unknown as DbUser | undefined;
    if (!userRow) return null;
    if (userRow.status === "disabled") return null;
    return publicUser(userRow);
  }

  // 2. Fallback to session record lookup in database
  const row = getDb()
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`
    )
    .get(sid, new Date().toISOString()) as unknown as DbUser | undefined;
  if (!row) return null;
  if (row.status === "disabled") return null;
  return publicUser(row);
}

export function loadUserFromSession(req: Request): AuthUser | null {
  const sid = getSessionId(req);
  if (!sid) return null;
  return userFromCredential(sid);
}

function isDashboardWhatsAppPath(req: Request): boolean {
  const raw = String(req.originalUrl || req.path || "").split("?")[0];
  const p = raw.startsWith("/api/whatsapp") ? raw.slice("/api".length) : raw.startsWith("/whatsapp") ? raw : `/whatsapp${raw.startsWith("/") ? raw : `/${raw}`}`;
  // Document ids are not inbox routes. Prescription and lab-report PDF auth
  // is on the handler (session + clinician role + tenant ownership).
  if (p.startsWith("/whatsapp/prescription/") || p.startsWith("/whatsapp/lab-report/")) return false;
  const protectedPrefixes = [
    "/whatsapp/conversations",
    "/whatsapp/messages",
    "/whatsapp/send",
    "/whatsapp/emr-action",
    "/whatsapp/voice-process",
    "/whatsapp/translate",
    "/whatsapp/send-rx",
    "/whatsapp/outbound/trigger",
    "/whatsapp/outbound-trigger",
    "/whatsapp/outbound/events",
    "/whatsapp/outbound-events",
    "/whatsapp/reminders/run",
  ];
  return protectedPrefixes.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

export function attachUser(req: Request, res: Response, next: NextFunction) {
  req.user = loadUserFromSession(req) || undefined;
  if (isDashboardWhatsAppPath(req)) {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const role = req.user.role;
    const allowed =
      (CLINICIAN_ROLES as readonly string[]).includes(role) || isPlatformAdminRole(role);
    if (!allowed) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const blocked = clinicTenantAccessError(req.user);
  if (blocked) {
    return res.status(403).json({ error: blocked });
  }
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const allowed = (roles as readonly string[]).includes(req.user.role) ||
      (isPlatformAdminRole(req.user.role) && (roles as readonly string[]).includes("super_admin"));
    if (!allowed) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

/** Platform Superadmin. Legacy role alias `admin` is accepted where #56 treated it as platform admin. */
export function isPlatformAdminRole(role?: string | null): boolean {
  const r = String(role || "").trim();
  return r === "super_admin" || r === "admin";
}

export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (!isPlatformAdminRole(req.user.role)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }
  next();
}

export const ADMIN_ROLES: UserRole[] = ["super_admin"];
/** Admin desk Users API — matches AdminShell admin/super_admin gates. */
export const USER_MANAGER_ROLES: UserRole[] = ["super_admin", "polyclinic_admin", "CLINIC_ADMIN"];
/** Password login completes without WhatsApp OTP — Admin / clinic admin must not block on Graph. */
export const PASSWORD_SESSION_ROLES: UserRole[] = ["super_admin", "polyclinic_admin", "CLINIC_ADMIN"];

/**
 * Seeded product-demo matrix only (`*@lumera.me` from DEMO_LOGIN_MATRIX).
 * Sandbox/demo password session for www/Clinical UX smoke — not a production clinic auth weaken.
 * Never matches arbitrary clinic domains or unseeded @lumera.me addresses.
 */
export function isSeededDemoPasswordSessionEmail(email?: string | null): boolean {
  const value = String(email || "").trim().toLowerCase();
  return value.endsWith("@lumera.me") && isDemoAccountEmail(value);
}

/**
 * Server-only password session for Sunrise Family Clinic video demos (tenant-543feff7).
 * Those accounts have fake phones and cannot receive a WhatsApp OTP.
 * Not part of DEMO_ACCOUNTS / DEMO_LOGIN_MATRIX — those feed the public Quick Demo picker and seeding.
 * Match is trimmed and case-insensitive, and still requires an `@lumera.me` suffix.
 */
export const SANDBOX_PASSWORD_SESSION_EMAILS: readonly string[] = [
  "ananya.sunrise@lumera.me",
  "reception.sunrise@lumera.me",
];

export function isSandboxPasswordSessionEmail(email?: string | null): boolean {
  const value = String(email || "").trim().toLowerCase();
  if (!value.endsWith("@lumera.me")) return false;
  return SANDBOX_PASSWORD_SESSION_EMAILS.some((entry) => entry.trim().toLowerCase() === value);
}

/**
 * Production email+password session — no WhatsApp OTP required.
 * MUST: super_admin / admin (role alias + admin@lumera.me). Clinic admins included so desk login is not Graph-gated.
 * Seeded @lumera.me demos (doctor, reception, pack aliases, patient) are OTP-safe the same way —
 * Clinical UX chrome smoke on www must not invent OTP codes.
 * SANDBOX_PASSWORD_SESSION_EMAILS covers the Sunrise video accounts only.
 * Client skipOtp stays ignored for everyone outside this allowlist.
 */
export function allowPasswordLoginWithoutOtp(user?: { role?: string; email?: string } | null): boolean {
  const role = String(user?.role || "");
  const email = String(user?.email || "").trim().toLowerCase();
  if (email === "admin@lumera.me") return true;
  if (isSeededDemoPasswordSessionEmail(email)) return true;
  if (isSandboxPasswordSessionEmail(email)) return true;
  if (role === "admin") return true;
  return (PASSWORD_SESSION_ROLES as readonly string[]).includes(role);
}
export const CLINIC_MANAGER_ROLES: UserRole[] = ["doctor", "polyclinic_admin", "CLINIC_ADMIN"];
export const CLINICIAN_ROLES: UserRole[] = [
  "doctor",
  "receptionist",
  "polyclinic_admin",
  "CLINIC_ADMIN",
  "super_admin",
];

import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getDb, publicUser, type DbUser, type UserRole } from "./db.ts";

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
  return jwt.sign(payload, getJwtSecret(), { expiresIn: `${SESSION_DAYS}d` });
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
  setSessionCookie(res, jwtToken);
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

export function setSessionCookie(res: Response, sessionId: string) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=None; Secure; Partitioned; Max-Age=${maxAge}`
  );
}

export function clearSessionCookie(res: Response) {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; SameSite=None; Secure; Partitioned; Max-Age=0`);
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

export function getSessionId(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  const xToken = req.headers["x-session-token"];
  if (typeof xToken === "string" && xToken.trim()) {
    return xToken.trim();
  }
  return parseCookies(req.headers.cookie)[COOKIE] || null;
}

export function loadUserFromSession(req: Request): AuthUser | null {
  const sid = getSessionId(req);
  if (!sid) return null;

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

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  req.user = loadUserFromSession(req) || undefined;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

export const ADMIN_ROLES: UserRole[] = ["super_admin"];
/** Admin desk Users API — matches AdminShell admin/super_admin gates. */
export const USER_MANAGER_ROLES: UserRole[] = ["super_admin", "polyclinic_admin", "CLINIC_ADMIN"];
export const CLINIC_MANAGER_ROLES: UserRole[] = ["doctor", "polyclinic_admin", "CLINIC_ADMIN"];
export const CLINICIAN_ROLES: UserRole[] = [
  "doctor",
  "receptionist",
  "polyclinic_admin",
  "CLINIC_ADMIN",
  "super_admin",
];

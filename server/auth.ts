import type { NextFunction, Request, Response } from "express";
import { getDb, publicUser, type DbUser, type UserRole } from "./db.ts";

const COOKIE = "lumera_sid";
const SESSION_DAYS = 7;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: string;
  phone: string;
  lastLogin: string | null;
  createdAt: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
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
export const CLINIC_MANAGER_ROLES: UserRole[] = ["doctor", "polyclinic_admin"];
export const CLINICIAN_ROLES: UserRole[] = [
  "doctor",
  "receptionist",
  "polyclinic_admin",
  "super_admin",
];

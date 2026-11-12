/**
 * Opaque, short-lived visit links.
 * The URL is /v/<random>. It carries no name, phone, UHID, or diagnosis.
 * PATIENT_LINK_OTP_SECRET hashes the WhatsApp code. Outside production, JWT_SECRET is the fallback
 * so tests and local boots keep working. Production refuses to mint a link when the dedicated secret is empty.
 */
import crypto from "node:crypto";
import type { SqlDatabase } from "./sql-engine.ts";

export const PATIENT_LINK_PURPOSE = "visit";
const DEFAULT_TTL_SEC = 72 * 60 * 60;
const OTP_TTL_SEC = 15 * 60;
const UNLOCK_TTL_SEC = 30 * 60;
const MAX_OTP_ATTEMPTS = 5;

export type PatientVisitLinkRow = {
  id: string;
  tenant_id: string;
  patient_id: string;
  appointment_id: string;
  purpose: string;
  expires_at: string;
  created_at: string;
};

export type MintedPatientLink = {
  id: string;
  expiresAt: string;
  otp: string;
  path: string;
};

export function ensurePatientVisitTables(db: SqlDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS patient_visit_links (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      appointment_id TEXT NOT NULL DEFAULT '',
      purpose TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_patient_visit_links_tenant_patient ON patient_visit_links(tenant_id, patient_id)"
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS patient_visit_notices (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      appointment_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      UNIQUE (appointment_id, kind)
    )
  `);
}

export function patientLinkSecret(env: NodeJS.ProcessEnv = process.env): string {
  const dedicated = String(env.PATIENT_LINK_OTP_SECRET || "").trim();
  if (dedicated) return dedicated;
  if (String(env.NODE_ENV || "") === "production") return "";
  return String(env.JWT_SECRET || "").trim();
}

export function patientLinkTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.PATIENT_LINK_TTL_SECONDS);
  if (Number.isFinite(raw) && raw >= 60 && raw <= 7 * 24 * 60 * 60) return Math.floor(raw);
  return DEFAULT_TTL_SEC;
}

export function patientLinkPath(id: string): string {
  return `/v/${id}`;
}

export function patientLinkUrl(id: string, env: NodeJS.ProcessEnv = process.env): string {
  const origin = String(env.APP_URL || "").trim().replace(/\/$/, "");
  const path = patientLinkPath(id);
  return origin ? `${origin}${path}` : path;
}

function hmac(secret: string, message: string): string {
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function otpHash(secret: string, code: string, linkId: string): string {
  return hmac(secret, `${code}:${linkId}`);
}

export function mintPatientVisitLink(
  db: SqlDatabase,
  input: { tenantId: string; patientId: string; appointmentId?: string; phone: string },
  env: NodeJS.ProcessEnv = process.env,
  now = new Date()
): MintedPatientLink | null {
  const secret = patientLinkSecret(env);
  const tenantId = String(input.tenantId || "").trim();
  const patientId = String(input.patientId || "").trim();
  if (!secret || !tenantId || !patientId) return null;
  ensurePatientVisitTables(db);
  const id = crypto.randomBytes(32).toString("base64url");
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + patientLinkTtlSeconds(env) * 1000).toISOString();
  db.prepare(
    `INSERT INTO patient_visit_links (id, tenant_id, patient_id, appointment_id, purpose, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, tenantId, patientId, String(input.appointmentId || "").trim(), PATIENT_LINK_PURPOSE, expiresAt, createdAt);

  const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const otpExpires = new Date(now.getTime() + OTP_TTL_SEC * 1000).toISOString();
  db.prepare(
    `INSERT INTO otp_verifications (id, phone, email, otp, purpose, payload, created_at, expires_at, failed_attempts)
     VALUES (?, ?, '', ?, 'patient_visit_link', ?, ?, ?, 0)`
  ).run(
    `otp-visit-${crypto.randomBytes(8).toString("hex")}`,
    String(input.phone || ""),
    otpHash(secret, otp, id),
    JSON.stringify({ linkId: id }),
    createdAt,
    otpExpires
  );
  return { id, expiresAt, otp, path: patientLinkPath(id) };
}

export function readPatientVisitLink(
  db: SqlDatabase,
  id: string,
  now = new Date()
): { row: PatientVisitLinkRow; expired: boolean } | null {
  const linkId = String(id || "").trim();
  if (!linkId || linkId.length < 20 || linkId.length > 128) return null;
  ensurePatientVisitTables(db);
  const row = db
    .prepare(
      `SELECT id, tenant_id, patient_id, appointment_id, purpose, expires_at, created_at
       FROM patient_visit_links WHERE id = ?`
    )
    .get(linkId) as PatientVisitLinkRow | undefined;
  if (!row || row.purpose !== PATIENT_LINK_PURPOSE) return null;
  const exp = Date.parse(row.expires_at);
  return { row, expired: !Number.isFinite(exp) || exp <= now.getTime() };
}

export type OtpCheck = "ok" | "rejected" | "expired" | "locked";

export function verifyPatientVisitOtp(
  db: SqlDatabase,
  linkId: string,
  code: string,
  env: NodeJS.ProcessEnv = process.env,
  now = new Date()
): OtpCheck {
  const secret = patientLinkSecret(env);
  const normalized = String(code || "").replace(/\D/g, "");
  if (!secret || normalized.length !== 6) return "rejected";
  const payload = JSON.stringify({ linkId });
  const row = db
    .prepare(
      `SELECT id, otp, expires_at, verified_at, failed_attempts
       FROM otp_verifications
       WHERE purpose = 'patient_visit_link' AND payload = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(payload) as
    | { id: string; otp: string; expires_at: string; verified_at?: string | null; failed_attempts?: number }
    | undefined;
  if (!row) return "rejected";
  if (Number(row.failed_attempts || 0) >= MAX_OTP_ATTEMPTS) return "locked";
  const exp = Date.parse(row.expires_at);
  if (!Number.isFinite(exp) || exp <= now.getTime()) return "expired";
  const expected = otpHash(secret, normalized, linkId);
  if (!safeEqual(expected, String(row.otp || ""))) {
    try {
      db.prepare("UPDATE otp_verifications SET failed_attempts = COALESCE(failed_attempts, 0) + 1 WHERE id = ?").run(row.id);
    } catch {
      /* column missing on a partial schema */
    }
    return "rejected";
  }
  db.prepare("UPDATE otp_verifications SET verified_at = ? WHERE id = ?").run(now.toISOString(), row.id);
  return "ok";
}

export function issueVisitUnlock(linkId: string, env: NodeJS.ProcessEnv = process.env, now = new Date()): string {
  const secret = patientLinkSecret(env);
  const exp = Math.floor(now.getTime() / 1000) + UNLOCK_TTL_SEC;
  const mac = hmac(secret, `${linkId}|${exp}`);
  return `${exp}.${mac}`;
}

export function visitUnlockValid(linkId: string, cookieValue: string, env: NodeJS.ProcessEnv = process.env, now = new Date()): boolean {
  const secret = patientLinkSecret(env);
  const [expRaw, mac] = String(cookieValue || "").split(".");
  const exp = Number(expRaw);
  if (!secret || !mac || !Number.isFinite(exp) || exp * 1000 <= now.getTime()) return false;
  return safeEqual(hmac(secret, `${linkId}|${exp}`), mac);
}

export function readUnlockCookie(header: string | undefined, name = "pv"): string {
  const parts = String(header || "").split(";").map((part) => part.trim());
  for (const part of parts) {
    if (part.startsWith(`${name}=`)) return decodeURIComponent(part.slice(name.length + 1));
  }
  return "";
}

export function claimVisitNotice(db: SqlDatabase, tenantId: string, appointmentId: string, kind: string, now = new Date()): boolean {
  const key = String(appointmentId || "").trim();
  if (!key) return false;
  ensurePatientVisitTables(db);
  try {
    db.prepare(
      `INSERT INTO patient_visit_notices (id, tenant_id, appointment_id, kind, sent_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(`ntc-${crypto.randomBytes(8).toString("hex")}`, tenantId, key, kind, now.toISOString());
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(message)) return false;
    throw err;
  }
}

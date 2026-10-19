/**
 * Shared opaque patient-link tokens.
 * Platform's domain sweep imports this module as-is.
 * The raw token is returned once from mint. Only its SHA-256 hash is stored.
 * This module does not read or return clinical data. Patient verification
 * (an OTP to the registered number) belongs on the landing page.
 */

import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const PATIENT_LINK_DEFAULT_TTL_HOURS = 72;
/** Printed QR codes. Security allows 7 days here; WhatsApp links stay at 72h. */
export const PATIENT_LINK_PRINT_TTL_HOURS = 24 * 7;
export const PATIENT_LINK_PUBLIC_BASE_URL = "https://www.mylumera.in";
export const PATIENT_LINK_DEFAULT_MAX_USES = 5;

export type PatientLinkPurpose = "rx" | "receipt" | "portal" | "hep";

export type MintPatientLinkTokenOpts = {
  tenantId: string;
  patientId: string;
  purpose: PatientLinkPurpose;
  resourceId: string;
  ttlHours?: number;
  maxUses?: number;
  createdBy?: string;
};

export type MintedPatientLink = {
  token: string;
  url: string;
  expiresAt: Date;
};

export type ResolvedPatientLink = {
  ok: true;
  tenantId: string;
  patientId: string;
  purpose: PatientLinkPurpose;
  resourceId: string;
  expiresAt: Date;
};

export type RejectedPatientLink = {
  ok: false;
  reason: "not_found" | "expired" | "revoked" | "exhausted" | "wrong_purpose";
};

const PURPOSES: readonly PatientLinkPurpose[] = ["rx", "receipt", "portal", "hep"];

/** Public path segment. Receipt links are /pay/v/<token>. */
const PURPOSE_PATH: Record<PatientLinkPurpose, string> = {
  rx: "rx",
  receipt: "pay",
  portal: "portal",
  hep: "hep",
};

type LinkRow = {
  token_hash: string;
  tenant_id: string;
  patient_id: string;
  purpose: string;
  resource_id: string;
  expires_at: string;
  max_uses: number;
  use_count: number;
  revoked_at: string | null;
};

export function ensurePatientLinkTokenSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS patient_link_tokens (
      token_hash TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      max_uses INTEGER NOT NULL,
      use_count INTEGER NOT NULL DEFAULT 0,
      revoked_at TEXT,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_patient_link_tokens_subject
      ON patient_link_tokens (tenant_id, resource_id, purpose);
  `);
}

function isPurpose(value: string): value is PatientLinkPurpose {
  return (PURPOSES as readonly string[]).includes(value);
}

function hashToken(token: string): Buffer {
  return crypto.createHash("sha256").update(token, "utf8").digest();
}

function hashHex(token: string): string {
  return hashToken(token).toString("hex");
}

function hashesMatch(storedHex: string, presented: Buffer): boolean {
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHex, "hex");
  } catch {
    return false;
  }
  if (stored.length !== presented.length) return false;
  return crypto.timingSafeEqual(stored, presented);
}

async function database(): Promise<DatabaseSync> {
  const { getDb } = await import("./db.ts");
  return getDb();
}

function publicUrl(purpose: PatientLinkPurpose, token: string): string {
  const base = PATIENT_LINK_PUBLIC_BASE_URL.replace(/\/$/, "");
  return `${base}/${PURPOSE_PATH[purpose]}/v/${token}`;
}

export async function mintPatientLinkToken(opts: MintPatientLinkTokenOpts): Promise<MintedPatientLink> {
  const tenantId = String(opts.tenantId || "").trim();
  const patientId = String(opts.patientId || "").trim();
  const resourceId = String(opts.resourceId || "").trim();
  const purpose = opts.purpose;
  if (!tenantId || !patientId || !resourceId || !isPurpose(purpose)) {
    throw new Error("tenantId, patientId, purpose, and resourceId are required");
  }
  const ttlHours = opts.ttlHours == null ? PATIENT_LINK_DEFAULT_TTL_HOURS : Number(opts.ttlHours);
  if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
    throw new Error("ttlHours must be a positive number");
  }
  const maxUses = opts.maxUses == null ? PATIENT_LINK_DEFAULT_MAX_USES : Math.floor(Number(opts.maxUses));
  if (!Number.isFinite(maxUses) || maxUses < 1) {
    throw new Error("maxUses must be at least 1");
  }
  const db = await database();
  ensurePatientLinkTokenSchema(db);
  const token = crypto.randomBytes(32).toString("base64url");
  if (Buffer.from(token, "base64url").length < 16) {
    throw new Error("token entropy below 128 bits");
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  db.prepare(
    `INSERT INTO patient_link_tokens (
       token_hash, tenant_id, patient_id, purpose, resource_id, expires_at, max_uses, use_count, revoked_at, created_by, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`
  ).run(
    hashHex(token),
    tenantId,
    patientId,
    purpose,
    resourceId,
    expiresAt.toISOString(),
    maxUses,
    String(opts.createdBy || "").trim(),
    now.toISOString()
  );
  return { token, url: publicUrl(purpose, token), expiresAt };
}

export async function resolvePatientLinkToken(
  token: string,
  opts?: { purpose?: PatientLinkPurpose; consume?: boolean }
): Promise<ResolvedPatientLink | RejectedPatientLink> {
  const presented = String(token || "").trim();
  if (!presented) return { ok: false, reason: "not_found" };
  const digest = hashToken(presented);
  const db = await database();
  ensurePatientLinkTokenSchema(db);
  const row = db.prepare(`SELECT * FROM patient_link_tokens WHERE token_hash = ?`).get(digest.toString("hex")) as
    | LinkRow
    | undefined;
  if (!row || !hashesMatch(row.token_hash, digest)) return { ok: false, reason: "not_found" };
  if (opts?.purpose && row.purpose !== opts.purpose) return { ok: false, reason: "wrong_purpose" };
  if (!isPurpose(row.purpose)) return { ok: false, reason: "not_found" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  const expiresAt = new Date(row.expires_at);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (Number(row.use_count) >= Number(row.max_uses)) return { ok: false, reason: "exhausted" };
  if (opts?.consume) {
    const updated = db
      .prepare(
        `UPDATE patient_link_tokens
         SET use_count = use_count + 1
         WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? AND use_count < max_uses`
      )
      .run(row.token_hash, new Date().toISOString());
    if (Number(updated.changes || 0) < 1) return { ok: false, reason: "exhausted" };
  }
  return {
    ok: true,
    tenantId: row.tenant_id,
    patientId: row.patient_id,
    purpose: row.purpose,
    resourceId: row.resource_id,
    expiresAt,
  };
}

export async function revokePatientLinkToken(token: string): Promise<boolean> {
  const presented = String(token || "").trim();
  if (!presented) return false;
  const digest = hashToken(presented);
  const db = await database();
  ensurePatientLinkTokenSchema(db);
  const row = db.prepare(`SELECT token_hash, revoked_at FROM patient_link_tokens WHERE token_hash = ?`).get(digest.toString("hex")) as
    | { token_hash: string; revoked_at: string | null }
    | undefined;
  if (!row || !hashesMatch(row.token_hash, digest)) return false;
  if (!row.revoked_at) {
    db.prepare(`UPDATE patient_link_tokens SET revoked_at = ? WHERE token_hash = ?`).run(new Date().toISOString(), row.token_hash);
  }
  return true;
}

export async function revokePatientLinkTokensFor(opts: {
  tenantId: string;
  resourceId: string;
  purpose?: PatientLinkPurpose;
}): Promise<number> {
  const tenantId = String(opts.tenantId || "").trim();
  const resourceId = String(opts.resourceId || "").trim();
  if (!tenantId || !resourceId) return 0;
  const db = await database();
  ensurePatientLinkTokenSchema(db);
  const purpose = opts.purpose && isPurpose(opts.purpose) ? opts.purpose : "";
  const result = db
    .prepare(
      `UPDATE patient_link_tokens
       SET revoked_at = ?
       WHERE tenant_id = ? AND resource_id = ? AND revoked_at IS NULL AND (? = '' OR purpose = ?)`
    )
    .run(new Date().toISOString(), tenantId, resourceId, purpose, purpose);
  return Number(result.changes || 0);
}

/**
 * Per-patient, per-clinic WhatsApp opt-in.
 * Business-initiated templates require a current opt-in. STOP clears it.
 */

import type { DatabaseSync } from "node:sqlite";

export const WHATSAPP_OPT_IN_REQUIRED = "WHATSAPP_OPT_IN_REQUIRED";
export const WHATSAPP_OPT_IN_REQUIRED_ERROR =
  "WHATSAPP_OPT_IN_REQUIRED: This patient has not opted in to WhatsApp messages from this clinic.";

const TEMPLATE_KINDS = new Set([
  "appointment_reminder",
  "book_confirmation",
  "payment_receipt",
  "prescription_ready",
]);

export function ensureWhatsAppOptInSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_patient_opt_ins (
      tenant_id TEXT NOT NULL,
      phone_digits TEXT NOT NULL,
      patient_id TEXT NOT NULL DEFAULT '',
      opted_in INTEGER NOT NULL,
      source TEXT NOT NULL,
      actor_id TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, phone_digits)
    )
  `);
}

export function phoneDigits(phone: string): string {
  return String(phone || "").replace(/\D/g, "");
}

export function recordWhatsAppOptIn(
  db: DatabaseSync,
  opts: {
    tenantId: string;
    phone: string;
    patientId?: string;
    optedIn: boolean;
    source: string;
    actorId?: string;
    now?: string;
  }
): void {
  ensureWhatsAppOptInSchema(db);
  const tenantId = String(opts.tenantId || "").trim();
  const digits = phoneDigits(opts.phone);
  if (!tenantId || digits.length < 8) return;
  db.prepare(
    `INSERT INTO whatsapp_patient_opt_ins (tenant_id, phone_digits, patient_id, opted_in, source, actor_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, phone_digits) DO UPDATE SET
       patient_id = excluded.patient_id,
       opted_in = excluded.opted_in,
       source = excluded.source,
       actor_id = excluded.actor_id,
       updated_at = excluded.updated_at`
  ).run(
    tenantId,
    digits,
    String(opts.patientId || "").trim(),
    opts.optedIn ? 1 : 0,
    String(opts.source || "unspecified").slice(0, 80),
    String(opts.actorId || "").trim(),
    opts.now || new Date().toISOString()
  );
}

export function isWhatsAppOptOutMessage(text: string): boolean {
  const value = String(text || "").trim().toLowerCase();
  return value === "stop" || value === "unsubscribe" || value === "opt out" || value === "opt-out";
}

type OptRow = { opted_in?: number };

function optRow(db: DatabaseSync, tenantId: string, phone: string): OptRow | undefined {
  ensureWhatsAppOptInSchema(db);
  const digits = phoneDigits(phone);
  if (!tenantId || !digits) return undefined;
  return db
    .prepare(`SELECT opted_in FROM whatsapp_patient_opt_ins WHERE tenant_id = ? AND phone_digits = ?`)
    .get(tenantId, digits) as OptRow | undefined;
}

export function patientOptedOut(db: DatabaseSync, tenantId: string, phone: string): boolean {
  const row = optRow(db, tenantId, phone);
  return Boolean(row) && Number(row?.opted_in) !== 1;
}

export function patientOptedIn(db: DatabaseSync, tenantId: string, phone: string): boolean {
  const row = optRow(db, tenantId, phone);
  return Number(row?.opted_in) === 1;
}

/**
 * Template sends need opt-in. In-window free-text reminders do too.
 * Any send stops after STOP. OTP and staff free-text are untouched except STOP.
 */
export function whatsAppOptInBlock(opts: {
  db?: DatabaseSync | null;
  tenantId?: string;
  to: string;
  kind: string;
  templateSend: boolean;
}): string | null {
  const db = opts.db;
  const tenantId = String(opts.tenantId || "").trim();
  if (!db || !tenantId || opts.kind === "otp") return null;
  if (patientOptedOut(db, tenantId, opts.to)) return WHATSAPP_OPT_IN_REQUIRED_ERROR;
  const businessInitiated =
    opts.kind === "appointment_reminder" || (opts.templateSend && TEMPLATE_KINDS.has(opts.kind));
  if (businessInitiated && !patientOptedIn(db, tenantId, opts.to)) {
    return WHATSAPP_OPT_IN_REQUIRED_ERROR;
  }
  return null;
}

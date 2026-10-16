import type { Request } from "express";
import {
  patientTenant,
  patientVisibleClinicPhone,
  type PatientTenantExtras,
} from "./client-serializers.ts";
import { getDb } from "./db.ts";
import type { SqlDatabase } from "./sql-engine.ts";

const PATIENT_ID_BACKFILL_KEY = "users.patient_id.backfill.v1";
const sessionPatientCache = new WeakMap<Request, string | null>();

export function requestIsPatient(req: Request): boolean {
  return req.user?.role === "patient";
}

function contactDigits(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

function phonesMatch(left: string, right: string): boolean {
  if (left.length < 8 || right.length < 8) return false;
  if (left === right) return true;
  const a = left.length >= 10 ? left.slice(-10) : left;
  const b = right.length >= 10 ? right.slice(-10) : right;
  return a.length >= 8 && a === b;
}

type ContactRow = { id?: string; phone?: string; email?: string };

/**
 * Exactly one chart in this clinic. Phone wins. Zero or several matches
 * return null so a login cannot choose a neighbour.
 */
export function matchUniquePatientId(tenantId: string, phone: unknown, email: unknown): string | null {
  const id = String(tenantId || "").trim();
  if (!id) return null;
  const rows = getDb()
    .prepare("SELECT id, phone, email FROM patients WHERE tenant_id = ?")
    .all(id) as ContactRow[];
  const digits = contactDigits(phone);
  const byPhone = digits ? rows.filter((row) => phonesMatch(digits, contactDigits(row.phone))) : [];
  if (byPhone.length === 1) return String(byPhone[0].id || "") || null;
  if (byPhone.length > 1) return null;
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  const byEmail = rows.filter((row) => String(row.email || "").trim().toLowerCase() === normalized);
  if (byEmail.length === 1) return String(byEmail[0].id || "") || null;
  return null;
}

function boundPatientId(value: unknown): string {
  return String(value || "").trim();
}

/**
 * Bind a patient login to one chart. An existing patient_id is kept.
 * A chart already bound to another login in the clinic is left unset.
 */
export function bindUnboundPatientUser(userId: string): string | null {
  const id = String(userId || "").trim();
  if (!id) return null;
  const user = getDb()
    .prepare("SELECT id, tenant_id, role, phone, email, patient_id FROM users WHERE id = ?")
    .get(id) as
    | { id: string; tenant_id?: string; role?: string; phone?: string; email?: string; patient_id?: string }
    | undefined;
  if (!user || user.role !== "patient") return null;
  const current = boundPatientId(user.patient_id);
  if (current) return current;
  const tenantId = String(user.tenant_id || "").trim();
  if (!tenantId) return null;
  const match = matchUniquePatientId(tenantId, user.phone, user.email);
  if (!match) return null;
  const taken = getDb()
    .prepare("SELECT id FROM users WHERE tenant_id = ? AND patient_id = ? AND id <> ?")
    .get(tenantId, match, id) as { id?: string } | undefined;
  if (taken?.id) return null;
  const updated = getDb()
    .prepare(
      `UPDATE users SET patient_id = ?
       WHERE id = ? AND role = 'patient' AND (patient_id IS NULL OR TRIM(patient_id) = '')`
    )
    .run(match, id);
  return Number(updated.changes) === 1 ? match : null;
}

/** Fill empty patient_id values. Does not move a login that is already bound. */
export function backfillUnboundPatientUsers(database: SqlDatabase = getDb()): number {
  const rows = database
    .prepare(
      `SELECT id FROM users
       WHERE role = 'patient' AND (patient_id IS NULL OR TRIM(patient_id) = '')`
    )
    .all() as { id?: string }[];
  let bound = 0;
  for (const row of rows) {
    if (bindUnboundPatientUser(String(row.id || ""))) bound += 1;
  }
  return bound;
}

/** One-time backfill. Later startups leave unbound logins unbound. */
export function backfillUserPatientIdsOnce(database: SqlDatabase = getDb()): void {
  const done = database.prepare("SELECT key FROM cms_settings WHERE key = ?").get(PATIENT_ID_BACKFILL_KEY) as
    | { key?: string }
    | undefined;
  if (done?.key) return;
  backfillUnboundPatientUsers(database);
  database
    .prepare("INSERT INTO cms_settings (key, value) VALUES (?, '1')")
    .run(PATIENT_ID_BACKFILL_KEY);
}

/**
 * Chart id stored on the login. Phone and email are not consulted.
 * Null when the column is empty or the chart is not in this clinic.
 * Cached for the request so a list does not resolve it per row.
 */
export function sessionPatientId(req: Request): string | null {
  if (!requestIsPatient(req)) return null;
  const cached = sessionPatientCache.get(req);
  if (cached !== undefined) return cached;
  const tenantId = String(req.user?.tenantId || "").trim();
  const userId = String(req.user?.id || "").trim();
  let resolved: string | null = null;
  if (tenantId && userId) {
    const row = getDb()
      .prepare(
        `SELECT u.patient_id AS patient_id
         FROM users u
         INNER JOIN patients p ON p.id = u.patient_id AND p.tenant_id = u.tenant_id
         WHERE u.id = ? AND u.tenant_id = ? AND u.role = 'patient'`
      )
      .get(userId, tenantId) as { patient_id?: string } | undefined;
    const id = boundPatientId(row?.patient_id);
    resolved = id || null;
  }
  sessionPatientCache.set(req, resolved);
  return resolved;
}

function filled(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Patient-scope clinic card. Reads the tenant row on the server and returns
 * only `patientTenant` keys. Does not write audit rows.
 */
export function loadPatientTenant(tenantId: string, extras: PatientTenantExtras = {}) {
  const id = String(tenantId || "").trim();
  if (!id) return null;
  const row = getDb().prepare("SELECT * FROM tenants WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  const next: PatientTenantExtras = { ...extras };
  if (!filled(next.openingHours)) {
    const doctor = getDb()
      .prepare(
        `SELECT d.opd_timing AS opd_timing
         FROM doctors d
         INNER JOIN users u ON u.id = d.user_id
         WHERE u.tenant_id = ? AND u.role != 'patient' AND TRIM(COALESCE(d.opd_timing, '')) != ''
         ORDER BY d.name ASC
         LIMIT 1`
      )
      .get(id) as { opd_timing?: string } | undefined;
    if (doctor?.opd_timing) next.openingHours = doctor.opd_timing;
  }
  if (!filled(next.openingHours)) {
    const branch = getDb()
      .prepare(
        `SELECT opd_hours FROM branches
         WHERE tenant_id = ? AND TRIM(COALESCE(opd_hours, '')) != ''
         ORDER BY name ASC
         LIMIT 1`
      )
      .get(id) as { opd_hours?: string } | undefined;
    if (branch?.opd_hours) next.openingHours = branch.opd_hours;
  }
  return patientTenant(row, next);
}

export function loadPatientClinicPhone(tenantId: string, stamped: unknown): string | null {
  const id = String(tenantId || "").trim();
  if (!id) return null;
  const row = getDb().prepare("SELECT * FROM tenants WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return patientVisibleClinicPhone(stamped, row);
}

/** Letterhead fields that match the patient allowlist. GSTIN and owner contacts stay off. */
export function patientLetterhead(tenant: Record<string, unknown> | null) {
  return {
    clinicName: tenant?.name ?? null,
    address: tenant?.address ?? null,
    phone: tenant?.phone ?? null,
    email: tenant?.email ?? null,
    whatsappNumber: tenant?.whatsapp_number ?? null,
    upiId: tenant?.upi_id ?? null,
  };
}

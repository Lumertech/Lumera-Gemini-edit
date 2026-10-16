import type { Request, Response } from "express";
import {
  patientTenant,
  patientVisibleClinicPhone,
  type PatientTenantExtras,
} from "./client-serializers.ts";
import { getDb } from "./db.ts";

export function requestIsPatient(req: Request): boolean {
  return req.user?.role === "patient";
}

/** 403 when the session is a patient. Staff roles fall through unchanged. */
export function rejectPatientRole(req: Request, res: Response): boolean {
  if (!requestIsPatient(req)) return false;
  res.status(403).json({ error: "Insufficient permissions" });
  return true;
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

/**
 * The patient chart row for this login, matched inside the session clinic.
 * Phone wins over email. More than one match returns null so the caller
 * cannot pick a neighbour's record.
 */
export function sessionPatientId(req: Request): string | null {
  if (!requestIsPatient(req)) return null;
  const tenantId = String(req.user?.tenantId || "").trim();
  const userId = String(req.user?.id || "").trim();
  if (!tenantId || !userId) return null;
  const user = getDb()
    .prepare("SELECT phone, email FROM users WHERE id = ? AND tenant_id = ?")
    .get(userId, tenantId) as { phone?: string; email?: string } | undefined;
  if (!user) return null;
  const rows = getDb()
    .prepare("SELECT id, phone, email FROM patients WHERE tenant_id = ?")
    .all(tenantId) as { id?: string; phone?: string; email?: string }[];
  const phone = contactDigits(user.phone);
  const byPhone = phone
    ? rows.filter((row) => phonesMatch(phone, contactDigits(row.phone)))
    : [];
  if (byPhone.length === 1) return String(byPhone[0].id || "") || null;
  if (byPhone.length > 1) return null;
  const email = String(user.email || "").trim().toLowerCase();
  if (!email) return null;
  const byEmail = rows.filter((row) => String(row.email || "").trim().toLowerCase() === email);
  if (byEmail.length === 1) return String(byEmail[0].id || "") || null;
  return null;
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

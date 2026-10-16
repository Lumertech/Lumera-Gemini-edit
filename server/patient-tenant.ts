import type { Request } from "express";
import {
  patientTenant,
  patientVisibleClinicPhone,
  type PatientTenantExtras,
} from "./client-serializers.ts";
import { getDb } from "./db.ts";

export function requestIsPatient(req: Request): boolean {
  return req.user?.role === "patient";
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
  if (!filled(next.doctorName) || !filled(next.doctorRegNumber) || !filled(next.openingHours)) {
    const doctor = getDb()
      .prepare(
        `SELECT d.name AS name, d.reg_number AS reg_number, d.opd_timing AS opd_timing
         FROM doctors d
         INNER JOIN users u ON u.id = d.user_id
         WHERE u.tenant_id = ? AND u.role != 'patient'
         ORDER BY d.name ASC
         LIMIT 1`
      )
      .get(id) as { name?: string; reg_number?: string; opd_timing?: string } | undefined;
    if (!filled(next.doctorName) && doctor?.name) next.doctorName = doctor.name;
    if (!filled(next.doctorRegNumber) && doctor?.reg_number) next.doctorRegNumber = doctor.reg_number;
    if (!filled(next.openingHours) && doctor?.opd_timing) next.openingHours = doctor.opd_timing;
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

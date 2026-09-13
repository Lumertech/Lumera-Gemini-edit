import { DEMO_TENANT_ID, getDb } from "./db.ts";
import { isProduction } from "./runtime.ts";
import {
  getWhatsAppNumberByPhoneNumberId,
  getWhatsAppNumberByWabaId,
  listPractitionerAffiliations,
} from "./whatsapp-numbers.ts";

function normalizePhoneDigits(phone: string): string {
  let digits = String(phone || "").replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  return digits;
}

function phonesMatch(a: string, b: string): boolean {
  const left = normalizePhoneDigits(a);
  const right = normalizePhoneDigits(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.slice(-10) === right.slice(-10) && Math.min(left.length, right.length) >= 10;
}

function tenantExists(tenantId: string): boolean {
  if (!tenantId) return false;
  try {
    return Boolean(getDb().prepare("SELECT id FROM tenants WHERE id = ?").get(tenantId));
  } catch {
    return false;
  }
}

export type WhatsAppClinicChoice = { tenantId: string; tenantName: string; doctorId: string };

export type WhatsAppTenantResolution =
  | { status: "resolved"; tenantId: string }
  | { status: "unresolved" }
  | {
      status: "ambiguous_clinic";
      code: "AMBIGUOUS_CLINIC_SELECTION";
      practitionerId: string;
      clinics: WhatsAppClinicChoice[];
    };

function resolveDoctorOwnedNumber(opts: {
  phoneNumberId?: string;
  wabaId?: string;
  patientPhone?: string;
}): WhatsAppTenantResolution | null {
  const phoneNumberId = String(opts.phoneNumberId || "").trim();
  const wabaId = String(opts.wabaId || "").trim();
  const row = phoneNumberId
    ? getWhatsAppNumberByPhoneNumberId(phoneNumberId)
    : wabaId
      ? getWhatsAppNumberByWabaId(wabaId)
      : undefined;
  if (!row || row.owner_type !== "doctor") return null;

  const affiliations = listPractitionerAffiliations(row.owner_id);
  if (affiliations.length === 0) return { status: "unresolved" };
  if (affiliations.length === 1) {
    return { status: "resolved", tenantId: affiliations[0].tenantId };
  }

  const phone = String(opts.patientPhone || "").trim();
  if (phone) {
    const matchedTenants = new Set<string>();
    for (const affiliation of affiliations) {
      const patient = findPatientByPhoneInTenant(affiliation.tenantId, phone);
      if (!patient) continue;
      const history = getDb()
        .prepare(
          `SELECT id FROM appointments
           WHERE tenant_id = ? AND doctor_id = ? AND (patient_id = ? OR patient_phone = ?)
           LIMIT 1`
        )
        .get(affiliation.tenantId, affiliation.doctorId, patient.id, phone) as { id?: string } | undefined;
      const patientOnly = !history
        ? getDb()
            .prepare("SELECT id FROM patients WHERE tenant_id = ? AND id = ? LIMIT 1")
            .get(affiliation.tenantId, patient.id)
        : undefined;
      if (history || patientOnly) matchedTenants.add(affiliation.tenantId);
    }
    if (matchedTenants.size === 1) {
      return { status: "resolved", tenantId: [...matchedTenants][0] };
    }
  }

  return {
    status: "ambiguous_clinic",
    code: "AMBIGUOUS_CLINIC_SELECTION",
    practitionerId: row.owner_id,
    clinics: affiliations.map((row) => ({
      tenantId: row.tenantId,
      tenantName: row.tenantName,
      doctorId: row.doctorId,
    })),
  };
}

export function resolveWhatsAppTenant(opts: {
  tenantId?: string;
  sessionTenantId?: string;
  phoneNumberId?: string;
  wabaId?: string;
  patientPhone?: string;
}): WhatsAppTenantResolution {
  const explicit = String(opts.tenantId || "").trim();
  if (explicit && tenantExists(explicit)) return { status: "resolved", tenantId: explicit };

  const session = String(opts.sessionTenantId || "").trim();
  if (session && tenantExists(session)) return { status: "resolved", tenantId: session };

  const doctorOwned = resolveDoctorOwnedNumber({
    phoneNumberId: opts.phoneNumberId,
    wabaId: opts.wabaId,
    patientPhone: opts.patientPhone,
  });
  if (doctorOwned) return doctorOwned;

  const phoneNumberId = String(opts.phoneNumberId || "").trim();
  if (phoneNumberId) {
    try {
      const owned = getWhatsAppNumberByPhoneNumberId(phoneNumberId);
      if (owned?.owner_type === "tenant" && owned.owner_id) {
        return { status: "resolved", tenantId: owned.owner_id };
      }
      const row = getDb()
        .prepare("SELECT id FROM tenants WHERE phone_number_id = ?")
        .get(phoneNumberId) as { id?: string } | undefined;
      if (row?.id) return { status: "resolved", tenantId: String(row.id) };
    } catch {
      /* ignore */
    }
  }

  const wabaId = String(opts.wabaId || "").trim();
  if (wabaId) {
    try {
      const owned = getWhatsAppNumberByWabaId(wabaId);
      if (owned?.owner_type === "tenant" && owned.owner_id) {
        return { status: "resolved", tenantId: owned.owner_id };
      }
      const row = getDb()
        .prepare("SELECT id FROM tenants WHERE waba_id = ?")
        .get(wabaId) as { id?: string } | undefined;
      if (row?.id) return { status: "resolved", tenantId: String(row.id) };
    } catch {
      /* ignore */
    }
  }

  const phone = String(opts.patientPhone || "").trim();
  if (phone) {
    const matches = findPatientsByPhone(phone);
    const tenantIds = [...new Set(matches.map((row) => String(row.tenant_id || "").trim()).filter(Boolean))];
    if (tenantIds.length === 1) return { status: "resolved", tenantId: tenantIds[0] };
  }

  if (!isProduction() && tenantExists(DEMO_TENANT_ID)) return { status: "resolved", tenantId: DEMO_TENANT_ID };
  return { status: "unresolved" };
}

export function resolveWhatsAppTenantId(opts: {
  tenantId?: string;
  sessionTenantId?: string;
  phoneNumberId?: string;
  wabaId?: string;
  patientPhone?: string;
}): string | null {
  const resolved = resolveWhatsAppTenant(opts);
  return resolved.status === "resolved" ? resolved.tenantId : null;
}

function findPatientsByPhone(phone: string): Record<string, unknown>[] {
  try {
    const rows = getDb().prepare("SELECT * FROM patients").all() as Record<string, unknown>[];
    return rows.filter((row) => phonesMatch(String(row.phone || ""), phone));
  } catch {
    return [];
  }
}

export function findPatientByPhoneInTenant(tenantId: string, phone: string): Record<string, unknown> | undefined {
  const rows = getDb()
    .prepare("SELECT * FROM patients WHERE tenant_id = ?")
    .all(tenantId) as Record<string, unknown>[];
  return rows.find((row) => phonesMatch(String(row.phone || ""), phone));
}

export function findDoctor(opts: { tenantId: string; doctorId?: string; doctorName?: string }) {
  const db = getDb();
  const tenantId = String(opts.tenantId || "").trim();
  const doctorId = String(opts.doctorId || "").trim();
  if (doctorId) {
    const byId = db
      .prepare(
        `SELECT d.* FROM doctors d
         JOIN users u ON u.id = d.user_id
         WHERE d.id = ? AND u.tenant_id = ?`
      )
      .get(doctorId, tenantId) as Record<string, unknown> | undefined;
    if (byId) return byId;
  }

  const doctorName = String(opts.doctorName || "").trim().toLowerCase();
  if (doctorName) {
    const named = db
      .prepare(
        `SELECT d.* FROM doctors d
         JOIN users u ON u.id = d.user_id
         WHERE u.tenant_id = ? AND lower(d.name) LIKE ?
         ORDER BY d.name ASC LIMIT 1`
      )
      .get(tenantId, `%${doctorName}%`) as Record<string, unknown> | undefined;
    if (named) return named;
  }

  return db
    .prepare(
      `SELECT d.* FROM doctors d
       JOIN users u ON u.id = d.user_id
       WHERE u.tenant_id = ? AND d.active = 1
       ORDER BY d.name ASC LIMIT 1`
    )
    .get(tenantId) as Record<string, unknown> | undefined;
}

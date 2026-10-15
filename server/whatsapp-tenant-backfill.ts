import type { SqlDatabase } from "./sql-engine.ts";

/** Rows that cannot be mapped to a clinic. Not a clinic session, and never NULL. */
export const WHATSAPP_QUARANTINE_TENANT_ID = "tenant-wa-unassigned";

/**
 * Fill empty WhatsApp tenant_id values only.
 * Order: receiving phone_number_id / WABA → tenant mapping, then the patient.
 * Rows that still cannot be resolved are stamped with the quarantine tenant.
 * Never rewrites a row that already belongs to a clinic, and never updates tenant records
 * other than inserting the quarantine tenant when it is missing.
 */

function blank(value: unknown): boolean {
  const id = String(value ?? "").trim();
  return id === "" || id === WHATSAPP_QUARANTINE_TENANT_ID;
}

function ensureQuarantineTenant(database: SqlDatabase) {
  try {
    const existing = database.prepare("SELECT id FROM tenants WHERE id = ?").get(WHATSAPP_QUARANTINE_TENANT_ID) as
      | { id?: string }
      | undefined;
    if (existing?.id) return;
  } catch {
    return;
  }
  const now = new Date().toISOString();
  try {
    database
      .prepare(
        `INSERT INTO tenants (
           id, name, specialty, country, timezone, phone, trial_ends_at,
           ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at
         ) VALUES (?, 'Unassigned WhatsApp', 'General Medicine', 'India', 'UTC', '', ?, 0, 0, 0, '', ?, ?)`
      )
      .run(WHATSAPP_QUARANTINE_TENANT_ID, now, now, now);
  } catch {
    try {
      database
        .prepare("INSERT INTO tenants (id, name) VALUES (?, 'Unassigned WhatsApp')")
        .run(WHATSAPP_QUARANTINE_TENANT_ID);
    } catch {
      /* conversation rows still store the quarantine id when the tenants shape differs */
    }
  }
}

function last10(phone: unknown): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

type ConvRow = {
  id: string;
  patient_id?: string | null;
  patient_phone?: string | null;
  tenant_id?: string | null;
  phone_number_id?: string | null;
  waba_id?: string | null;
};

function loadConversations(database: SqlDatabase): ConvRow[] {
  try {
    return database
      .prepare(
        "SELECT id, patient_id, patient_phone, tenant_id, phone_number_id, waba_id FROM whatsapp_conversations"
      )
      .all() as ConvRow[];
  } catch {
    try {
      return database
        .prepare("SELECT id, patient_id, patient_phone, tenant_id FROM whatsapp_conversations")
        .all() as ConvRow[];
    } catch {
      return [];
    }
  }
}

function putUnique(map: Map<string, string>, key: unknown, tenantId: unknown) {
  const id = String(key ?? "").trim();
  const tenant = String(tenantId ?? "").trim();
  if (!id || !tenant) return;
  const prev = map.get(id);
  if (prev === undefined) map.set(id, tenant);
  else if (prev !== tenant) map.set(id, "");
}

function doctorOwnerTenant(database: SqlDatabase, practitionerId: string): string {
  if (!practitionerId) return "";
  try {
    const rows = database
      .prepare(
        `SELECT DISTINCT u.tenant_id AS tenant_id
         FROM doctors d
         JOIN users u ON u.id = d.user_id
         WHERE d.practitioner_id = ? AND TRIM(COALESCE(u.tenant_id, '')) != ''`
      )
      .all(practitionerId) as Array<{ tenant_id?: string }>;
    if (rows.length === 1) return String(rows[0]?.tenant_id || "").trim();
  } catch {
    /* doctors.practitioner_id is optional until the WABA schema exists */
  }
  return "";
}

function buildLineMaps(database: SqlDatabase): { phoneNumber: Map<string, string>; waba: Map<string, string> } {
  const phoneNumber = new Map<string, string>();
  const waba = new Map<string, string>();
  try {
    const numbers = database
      .prepare("SELECT phone_number_id, waba_id, owner_type, owner_id FROM whatsapp_numbers")
      .all() as Array<{ phone_number_id?: string; waba_id?: string; owner_type?: string; owner_id?: string }>;
    for (const row of numbers) {
      const ownerType = String(row.owner_type || "");
      const ownerId = String(row.owner_id || "").trim();
      const tenantId = ownerType === "tenant" ? ownerId : ownerType === "doctor" ? doctorOwnerTenant(database, ownerId) : "";
      putUnique(phoneNumber, row.phone_number_id, tenantId);
      putUnique(waba, row.waba_id, tenantId);
    }
  } catch {
    /* whatsapp_numbers is created by the WABA schema, not the clinic bootstrap */
  }
  try {
    const tenants = database
      .prepare("SELECT id, phone_number_id, waba_id FROM tenants")
      .all() as Array<{ id?: string; phone_number_id?: string; waba_id?: string }>;
    for (const row of tenants) {
      putUnique(phoneNumber, row.phone_number_id, row.id);
      putUnique(waba, row.waba_id, row.id);
    }
  } catch {
    /* tenants columns are added in the same migrate pass */
  }
  return { phoneNumber, waba };
}

export function backfillWhatsAppTenantIds(database: SqlDatabase): void {
  ensureQuarantineTenant(database);
  const conversations = loadConversations(database);
  if (!conversations.length) {
    backfillMessages(database, new Map());
    return;
  }

  let patients: Array<{ id?: string; tenant_id?: string; phone?: string }> = [];
  try {
    patients = database.prepare("SELECT id, tenant_id, phone FROM patients").all() as typeof patients;
  } catch {
    patients = [];
  }

  const tenantByPatientId = new Map<string, string>();
  const tenantsByPhone = new Map<string, Set<string>>();
  for (const patient of patients) {
    const tenantId = String(patient.tenant_id || "").trim();
    const patientId = String(patient.id || "").trim();
    if (!tenantId) continue;
    if (patientId) tenantByPatientId.set(patientId, tenantId);
    const key = last10(patient.phone);
    if (!key) continue;
    const set = tenantsByPhone.get(key) || new Set<string>();
    set.add(tenantId);
    tenantsByPhone.set(key, set);
  }

  const lines = buildLineMaps(database);
  const convTenant = new Map<string, string>();
  const assign = database.prepare(
    `UPDATE whatsapp_conversations SET tenant_id = ?
     WHERE id = ? AND (tenant_id IS NULL OR TRIM(tenant_id) = '' OR tenant_id = ?)`
  );

  for (const row of conversations) {
    const existing = String(row.tenant_id || "").trim();
    if (existing && existing !== WHATSAPP_QUARANTINE_TENANT_ID) {
      convTenant.set(String(row.id), existing);
      continue;
    }
    const fromLine = lines.phoneNumber.get(String(row.phone_number_id || "").trim()) || "";
    const fromWaba = lines.waba.get(String(row.waba_id || "").trim()) || "";
    const fromPatient = tenantByPatientId.get(String(row.patient_id || "").trim()) || "";
    const phoneTenants = tenantsByPhone.get(last10(row.patient_phone));
    const fromPhone = phoneTenants && phoneTenants.size === 1 ? [...phoneTenants][0] : "";
    const resolved = fromLine || fromWaba || fromPatient || fromPhone || WHATSAPP_QUARANTINE_TENANT_ID;
    if (existing !== resolved) assign.run(resolved, row.id, WHATSAPP_QUARANTINE_TENANT_ID);
    convTenant.set(String(row.id), resolved);
  }

  backfillMessages(database, convTenant);
}

function backfillMessages(database: SqlDatabase, convTenant: Map<string, string>) {
  let messages: Array<{ id?: string; conversation_id?: string; tenant_id?: string }> = [];
  try {
    messages = database
      .prepare("SELECT id, conversation_id, tenant_id FROM whatsapp_messages")
      .all() as typeof messages;
  } catch {
    return;
  }
  if (!convTenant.size) {
    try {
      const rows = database
        .prepare("SELECT id, tenant_id FROM whatsapp_conversations")
        .all() as Array<{ id?: string; tenant_id?: string }>;
      for (const row of rows) {
        const tenantId = String(row.tenant_id || "").trim();
        if (tenantId) convTenant.set(String(row.id), tenantId);
      }
    } catch {
      return;
    }
  }
  const assign = database.prepare(
    `UPDATE whatsapp_messages SET tenant_id = ?
     WHERE id = ? AND (tenant_id IS NULL OR TRIM(tenant_id) = '' OR tenant_id = ?)`
  );
  for (const row of messages) {
    if (!blank(row.tenant_id)) continue;
    const tenantId = convTenant.get(String(row.conversation_id || "")) || WHATSAPP_QUARANTINE_TENANT_ID;
    assign.run(tenantId, row.id, WHATSAPP_QUARANTINE_TENANT_ID);
  }
}

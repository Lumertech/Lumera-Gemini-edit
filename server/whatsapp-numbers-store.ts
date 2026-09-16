import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db.ts";
import { sandboxSimulatorsEnabled } from "./runtime.ts";

/**
 * Two-tier WABA ownership.
 *
 * Token storage: plaintext SQLite column on `whatsapp_number_secrets`, referenced
 * by `whatsapp_numbers.meta_token_ref`. This matches the existing tenant pattern
 * (`tenants.meta_access_token` is a SQLite TEXT column, not Secret Manager).
 * Tokens are intentionally NOT stored on `whatsapp_numbers` itself.
 *
 * `tenants.waba_id` / `phone_number_id` / `meta_waba_name` / `meta_token_expires_at`
 * / `meta_access_token` stay as derived, write-through copies for tenant-owned
 * numbers so existing readers (meta.ts list, graph-whatsapp.ts) keep working.
 */

export type WhatsAppOwnerType = "tenant" | "doctor";
export type WhatsAppNumberStatus = "pending" | "connected" | "disconnected";
export type WhatsAppConnectedVia = "master_admin" | "embedded_signup";

export type WhatsAppNumberRow = {
  id: string;
  owner_type: WhatsAppOwnerType;
  owner_id: string;
  waba_id: string;
  phone_number_id: string;
  business_id: string;
  meta_waba_name: string;
  status: WhatsAppNumberStatus;
  connected_via: WhatsAppConnectedVia | "";
  meta_token_ref: string;
  meta_token_expires_at: string;
  phone_status: string;
  code_verification_status: string;
  display_name_status: string;
  business_verification_status: string;
  quality_rating: string;
  created_at: string;
  updated_at: string;
};

export type PractitionerRow = {
  id: string;
  name: string;
  phone: string;
  created_at: string;
};

export class WhatsAppNumberError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;
  constructor(status: number, message: string, code = "WABA_ERROR", extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export type WabaActor =
  | { kind: "platform_admin" }
  | { kind: "clinic"; tenantId: string }
  | { kind: "doctor"; practitionerId: string };

export function ensureWhatsAppOwnershipSchema(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS practitioners (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_numbers (
      id TEXT PRIMARY KEY,
      owner_type TEXT NOT NULL CHECK(owner_type IN ('tenant','doctor')),
      owner_id TEXT NOT NULL,
      waba_id TEXT NOT NULL DEFAULT '',
      phone_number_id TEXT NOT NULL DEFAULT '',
      business_id TEXT NOT NULL DEFAULT '',
      meta_waba_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','connected','disconnected')),
      connected_via TEXT CHECK(connected_via IN ('master_admin','embedded_signup') OR connected_via IS NULL OR connected_via = ''),
      meta_token_ref TEXT DEFAULT '',
      meta_token_expires_at TEXT DEFAULT '',
      phone_status TEXT NOT NULL DEFAULT '',
      code_verification_status TEXT NOT NULL DEFAULT '',
      display_name_status TEXT NOT NULL DEFAULT '',
      business_verification_status TEXT NOT NULL DEFAULT '',
      quality_rating TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (owner_type, owner_id)
    );

    CREATE TABLE IF NOT EXISTS whatsapp_number_secrets (
      id TEXT PRIMARY KEY,
      whatsapp_number_id TEXT NOT NULL UNIQUE,
      meta_access_token TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  try {
    database.exec("ALTER TABLE doctors ADD COLUMN practitioner_id TEXT DEFAULT ''");
  } catch {
    /* already present */
  }

  try {
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_numbers_phone_id
      ON whatsapp_numbers(phone_number_id)
      WHERE phone_number_id IS NOT NULL AND phone_number_id != ''
    `);
  } catch {
    /* index exists or older SQLite without partial indexes */
  }
  try {
    database.exec("CREATE INDEX IF NOT EXISTS idx_doctors_practitioner ON doctors(practitioner_id)");
  } catch {}
  try {
    database.exec("CREATE INDEX IF NOT EXISTS idx_practitioners_phone ON practitioners(phone)");
  } catch {}

  const extraColumns: Array<[string, string, string]> = [
    ["whatsapp_numbers", "business_id", "TEXT NOT NULL DEFAULT ''"],
    ["whatsapp_numbers", "phone_status", "TEXT NOT NULL DEFAULT ''"],
    ["whatsapp_numbers", "code_verification_status", "TEXT NOT NULL DEFAULT ''"],
    ["whatsapp_numbers", "display_name_status", "TEXT NOT NULL DEFAULT ''"],
    ["whatsapp_numbers", "business_verification_status", "TEXT NOT NULL DEFAULT ''"],
    ["whatsapp_numbers", "quality_rating", "TEXT NOT NULL DEFAULT ''"],
    ["tenants", "meta_business_id", "TEXT DEFAULT ''"],
    ["tenants", "meta_phone_status", "TEXT DEFAULT ''"],
    ["tenants", "meta_code_verification_status", "TEXT DEFAULT ''"],
    ["tenants", "meta_display_name_status", "TEXT DEFAULT ''"],
    ["tenants", "meta_business_verification_status", "TEXT DEFAULT ''"],
  ];
  for (const [table, column, ddl] of extraColumns) {
    try {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    } catch {
      /* already present */
    }
  }
}

export function normalizePractitionerPhone(phone: string): string {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export function practitionerPhonesMatch(a: string, b: string): boolean {
  const left = normalizePractitionerPhone(a);
  const right = normalizePractitionerPhone(b);
  if (!left || !right) return false;
  return left === right;
}

export function migrateTenantWabasToWhatsAppNumbers(database: DatabaseSync) {
  const now = new Date().toISOString();
  let rows: Array<{
    id: string;
    waba_id?: string;
    phone_number_id?: string;
    meta_waba_name?: string;
    meta_token_expires_at?: string;
    meta_access_token?: string;
    meta_onboarding_status?: string;
    name?: string;
  }> = [];
  try {
    rows = database
      .prepare(
        `SELECT id, name, waba_id, phone_number_id, meta_waba_name, meta_token_expires_at, meta_access_token, meta_onboarding_status
         FROM tenants`
      )
      .all() as typeof rows;
  } catch {
    return;
  }

  for (const tenant of rows) {
    const wabaId = String(tenant.waba_id || "").trim();
    if (!wabaId) continue;
    const existing = database
      .prepare("SELECT id FROM whatsapp_numbers WHERE owner_type = 'tenant' AND owner_id = ?")
      .get(tenant.id) as { id?: string } | undefined;
    if (existing?.id) {
      syncTenantWabaColumns(database, tenant.id);
      continue;
    }
    const numberId = `wan-${tenant.id}`;
    const secretId = `wsec-${tenant.id}`;
    const phoneNumberId = String(tenant.phone_number_id || "").trim();
    const status: WhatsAppNumberStatus =
      String(tenant.meta_onboarding_status || "") === "disconnected" ? "disconnected" : "connected";
    try {
      database
        .prepare(
          `INSERT INTO whatsapp_numbers
            (id, owner_type, owner_id, waba_id, phone_number_id, meta_waba_name, status, connected_via, meta_token_ref, meta_token_expires_at, created_at, updated_at)
           VALUES (?, 'tenant', ?, ?, ?, ?, ?, 'master_admin', ?, ?, ?, ?)`
        )
        .run(
          numberId,
          tenant.id,
          wabaId,
          phoneNumberId,
          String(tenant.meta_waba_name || tenant.name || ""),
          status,
          secretId,
          String(tenant.meta_token_expires_at || ""),
          now,
          now
        );
      database
        .prepare(
          `INSERT INTO whatsapp_number_secrets (id, whatsapp_number_id, meta_access_token, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(secretId, numberId, String(tenant.meta_access_token || ""), now, now);
    } catch {
      /* unique conflict — already migrated */
    }
  }
}

export function getTenantWabaNumber(tenantId: string, database = getDb()): WhatsAppNumberRow | undefined {
  ensureWhatsAppOwnershipSchema(database);
  if (!tenantId) return undefined;
  try {
    return database
      .prepare("SELECT * FROM whatsapp_numbers WHERE owner_type = 'tenant' AND owner_id = ?")
      .get(tenantId) as WhatsAppNumberRow | undefined;
  } catch {
    return undefined;
  }
}

export function getDoctorWabaNumber(practitionerId: string, database: DatabaseSync = getDb()): WhatsAppNumberRow | undefined {
  if (!practitionerId) return undefined;
  try {
    return database
      .prepare("SELECT * FROM whatsapp_numbers WHERE owner_type = 'doctor' AND owner_id = ?")
      .get(practitionerId) as WhatsAppNumberRow | undefined;
  } catch {
    return undefined;
  }
}

export function getWhatsAppNumberByPhoneNumberId(
  phoneNumberId: string,
  database: DatabaseSync = getDb()
): WhatsAppNumberRow | undefined {
  ensureWhatsAppOwnershipSchema(database);
  if (!phoneNumberId) return undefined;
  try {
    return database
      .prepare("SELECT * FROM whatsapp_numbers WHERE phone_number_id = ?")
      .get(phoneNumberId) as WhatsAppNumberRow | undefined;
  } catch {
    return undefined;
  }
}

export function getWhatsAppNumberByWabaId(wabaId: string, database: DatabaseSync = getDb()): WhatsAppNumberRow | undefined {
  if (!wabaId) return undefined;
  try {
    return database
      .prepare("SELECT * FROM whatsapp_numbers WHERE waba_id = ?")
      .get(wabaId) as WhatsAppNumberRow | undefined;
  } catch {
    return undefined;
  }
}

export function getWhatsAppNumberSecret(metaTokenRef: string, database: DatabaseSync = getDb()): string {
  if (!metaTokenRef) return "";
  try {
    const row = database
      .prepare("SELECT meta_access_token FROM whatsapp_number_secrets WHERE id = ?")
      .get(metaTokenRef) as { meta_access_token?: string } | undefined;
    return String(row?.meta_access_token || "");
  } catch {
    return "";
  }
}

export function syncTenantWabaColumns(database: DatabaseSync, tenantId: string) {
  const row = getTenantWabaNumber(tenantId, database);
  const token = row?.meta_token_ref ? getWhatsAppNumberSecret(row.meta_token_ref, database) : "";
  const now = new Date().toISOString();
  try {
    if (!row || row.status === "disconnected") {
      database
        .prepare(
          `UPDATE tenants
           SET waba_id = '',
               phone_number_id = '',
               meta_access_token = '',
               meta_token_expires_at = COALESCE(meta_token_expires_at, ''),
               meta_waba_name = COALESCE(meta_waba_name, ''),
               meta_onboarding_status = 'disconnected',
               meta_business_id = '',
               meta_phone_status = '',
               meta_code_verification_status = '',
               meta_display_name_status = '',
               meta_business_verification_status = '',
               updated_at = ?
           WHERE id = ?`
        )
        .run(now, tenantId);
      return;
    }
    database
      .prepare(
        `UPDATE tenants
         SET waba_id = ?,
             phone_number_id = ?,
             meta_access_token = ?,
             meta_token_expires_at = ?,
             meta_waba_name = ?,
             meta_onboarding_status = ?,
             meta_business_id = ?,
             meta_phone_status = ?,
             meta_code_verification_status = ?,
             meta_display_name_status = ?,
             meta_business_verification_status = ?,
             meta_quality_rating = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        row.waba_id || "",
        row.phone_number_id || "",
        token,
        row.meta_token_expires_at || "",
        row.meta_waba_name || "",
        row.status === "connected" ? "connected" : row.status,
        row.business_id || "",
        row.phone_status || "",
        row.code_verification_status || "",
        row.display_name_status || "",
        row.business_verification_status || "",
        row.quality_rating || "",
        now,
        tenantId
      );
  } catch {
    /* tenants table missing in isolated tests */
  }
}

export function storeToken(database: DatabaseSync, numberId: string, tokenRef: string, token: string) {
  const now = new Date().toISOString();
  const existing = database
    .prepare("SELECT id FROM whatsapp_number_secrets WHERE id = ? OR whatsapp_number_id = ?")
    .get(tokenRef, numberId) as { id?: string } | undefined;
  if (existing?.id) {
    database
      .prepare("UPDATE whatsapp_number_secrets SET meta_access_token = ?, updated_at = ? WHERE id = ?")
      .run(token, now, existing.id);
    return existing.id;
  }
  database
    .prepare(
      `INSERT INTO whatsapp_number_secrets (id, whatsapp_number_id, meta_access_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(tokenRef, numberId, token, now, now);
  return tokenRef;
}

export function findPractitionerByPhone(phone: string, database: DatabaseSync = getDb()): PractitionerRow | undefined {
  const needle = normalizePractitionerPhone(phone);
  if (!needle) return undefined;
  try {
    const exact = database.prepare("SELECT * FROM practitioners WHERE phone = ?").get(needle) as PractitionerRow | undefined;
    if (exact) return exact;
    const rows = database.prepare("SELECT * FROM practitioners").all() as PractitionerRow[];
    return rows.find((row) => practitionerPhonesMatch(row.phone, phone));
  } catch {
    return undefined;
  }
}

export function findOrCreatePractitioner(opts: {
  name?: string;
  phone?: string;
  database?: DatabaseSync;
}): PractitionerRow {
  const database = opts.database || getDb();
  ensureWhatsAppOwnershipSchema(database);
  const now = new Date().toISOString();
  const phoneRaw = String(opts.phone || "").trim();
  const normalized = normalizePractitionerPhone(phoneRaw);
  const existing = normalized ? findPractitionerByPhone(phoneRaw || normalized, database) : undefined;
  if (existing) {
    const nextName = String(opts.name || "").trim();
    if (nextName && !existing.name) {
      database.prepare("UPDATE practitioners SET name = ? WHERE id = ?").run(nextName, existing.id);
      return { ...existing, name: nextName };
    }
    return existing;
  }
  const id = `prac-${crypto.randomUUID()}`;
  const storedPhone = normalized || `unspecified:${id}`;
  database
    .prepare("INSERT INTO practitioners (id, name, phone, created_at) VALUES (?, ?, ?, ?)")
    .run(id, String(opts.name || "").trim(), storedPhone, now);
  return database.prepare("SELECT * FROM practitioners WHERE id = ?").get(id) as PractitionerRow;
}

export function linkDoctorToPractitioner(doctorId: string, practitionerId: string, database: DatabaseSync = getDb()) {
  if (!doctorId || !practitionerId) return;
  database.prepare("UPDATE doctors SET practitioner_id = ? WHERE id = ?").run(practitionerId, doctorId);
}

export function ensureDoctorPractitionerLink(opts: {
  doctorId: string;
  name?: string;
  phone?: string;
  database?: DatabaseSync;
}): PractitionerRow {
  const database = opts.database || getDb();
  const doctor = database
    .prepare("SELECT id, name, phone, practitioner_id FROM doctors WHERE id = ?")
    .get(opts.doctorId) as { id?: string; name?: string; phone?: string; practitioner_id?: string } | undefined;
  const existingId = String(doctor?.practitioner_id || "").trim();
  if (existingId) {
    const row = database.prepare("SELECT * FROM practitioners WHERE id = ?").get(existingId) as PractitionerRow | undefined;
    if (row) return row;
  }
  const practitioner = findOrCreatePractitioner({
    name: opts.name || doctor?.name || "",
    phone: opts.phone || doctor?.phone || "",
    database,
  });
  linkDoctorToPractitioner(opts.doctorId, practitioner.id, database);
  return practitioner;
}

export function getPractitionerIdForUser(userId: string, database: DatabaseSync = getDb()): string {
  if (!userId) return "";
  const row = database
    .prepare("SELECT practitioner_id FROM doctors WHERE user_id = ?")
    .get(userId) as { practitioner_id?: string } | undefined;
  return String(row?.practitioner_id || "").trim();
}

/** Link (or create) a practitioners row for a doctor user so existing accounts can connect a personal WABA. */
export function ensurePractitionerForUser(userId: string, database: DatabaseSync = getDb()): string {
  if (!userId) return "";
  ensureWhatsAppOwnershipSchema(database);
  const existing = getPractitionerIdForUser(userId, database);
  if (existing) return existing;
  const doctor = database
    .prepare("SELECT id, name, phone FROM doctors WHERE user_id = ?")
    .get(userId) as { id?: string; name?: string; phone?: string } | undefined;
  if (!doctor?.id) {
    const user = database
      .prepare("SELECT id, name, phone, role FROM users WHERE id = ?")
      .get(userId) as { id?: string; name?: string; phone?: string; role?: string } | undefined;
    if (user?.role !== "doctor") return "";
    return "";
  }
  return ensureDoctorPractitionerLink({
    doctorId: doctor.id,
    name: doctor.name,
    phone: doctor.phone,
    database,
  }).id;
}

export function listPractitionerAffiliations(
  practitionerId: string,
  database: DatabaseSync = getDb()
): Array<{ tenantId: string; tenantName: string; doctorId: string; userId: string }> {
  if (!practitionerId) return [];
  const rows = database
    .prepare(
      `SELECT d.id AS doctor_id, d.user_id AS user_id, u.tenant_id AS tenant_id, COALESCE(t.name, '') AS tenant_name
       FROM doctors d
       JOIN users u ON u.id = d.user_id
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE d.practitioner_id = ? AND COALESCE(u.tenant_id, '') != ''`
    )
    .all(practitionerId) as Array<{ doctor_id: string; user_id: string; tenant_id: string; tenant_name: string }>;
  const seen = new Set<string>();
  const out: Array<{ tenantId: string; tenantName: string; doctorId: string; userId: string }> = [];
  for (const row of rows) {
    const tenantId = String(row.tenant_id || "").trim();
    if (!tenantId || seen.has(tenantId)) continue;
    seen.add(tenantId);
    out.push({
      tenantId,
      tenantName: String(row.tenant_name || tenantId),
      doctorId: String(row.doctor_id),
      userId: String(row.user_id || ""),
    });
  }
  return out;
}

export function clinicActor(tenantId: string): WabaActor {
  return { kind: "clinic", tenantId };
}

export function doctorActor(practitionerId: string): WabaActor {
  return { kind: "doctor", practitionerId };
}

export function platformAdminActor(): WabaActor {
  return { kind: "platform_admin" };
}

export function assertCanWriteWhatsAppNumber(actor: WabaActor, ownerType: WhatsAppOwnerType, ownerId: string) {
  if (actor.kind === "platform_admin") return;
  if (actor.kind === "clinic") {
    if (ownerType !== "tenant" || ownerId !== actor.tenantId) {
      throw new WhatsAppNumberError(
        403,
        "Clinic users can only manage the WhatsApp number owned by their own tenant.",
        "OWNER_SCOPE"
      );
    }
    return;
  }
  if (ownerType !== "doctor" || ownerId !== actor.practitionerId) {
    throw new WhatsAppNumberError(
      403,
      "Doctors can only manage the personal WhatsApp number linked to their practitioner identity.",
      "OWNER_SCOPE"
    );
  }
}

export function assertCanReadWhatsAppNumber(actor: WabaActor, row: WhatsAppNumberRow) {
  assertCanWriteWhatsAppNumber(actor, row.owner_type, row.owner_id);
}

export function sandboxTokenPlaceholder() {
  return sandboxSimulatorsEnabled() ? "EAAJ...SANDBOX_DEV_ONLY_not_a_live_token" : "";
}

export function sandboxExpiryPlaceholder() {
  return sandboxSimulatorsEnabled() ? "SANDBOX / DEV-ONLY — not a Graph-validated system user token" : "unknown";
}

export type UpsertWhatsAppNumberInput = {
  id?: string;
  ownerType: WhatsAppOwnerType;
  ownerId: string;
  wabaId?: string;
  phoneNumberId?: string;
  businessId?: string;
  metaWabaName?: string;
  metaAccessToken?: string;
  status?: WhatsAppNumberStatus;
  connectedVia?: WhatsAppConnectedVia;
  metaTokenExpiresAt?: string;
  phoneStatus?: string;
  codeVerificationStatus?: string;
  displayNameStatus?: string;
  businessVerificationStatus?: string;
  qualityRating?: string;
  allowCreate?: boolean;
};

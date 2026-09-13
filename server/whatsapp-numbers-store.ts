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
  meta_waba_name: string;
  status: WhatsAppNumberStatus;
  connected_via: WhatsAppConnectedVia | "";
  meta_token_ref: string;
  meta_token_expires_at: string;
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
      meta_waba_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','connected','disconnected')),
      connected_via TEXT CHECK(connected_via IN ('master_admin','embedded_signup') OR connected_via IS NULL OR connected_via = ''),
      meta_token_ref TEXT DEFAULT '',
      meta_token_expires_at TEXT DEFAULT '',
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

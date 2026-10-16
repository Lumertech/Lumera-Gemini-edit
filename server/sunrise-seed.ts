import { demoLoginEnabled, isUnsetOrPlaceholder } from "./runtime.ts";
import type { SqlDatabase, SqlRunResult } from "./sql-engine.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { SUNRISE_TENANT_ID } from "./tenant-slug.ts";

/**
 * Sunrise Family Clinic video logins. Not part of DEMO_ACCOUNTS.
 * Passwords come from the process environment through the same placeholder
 * rules as `readSecret` (empty and replace-with-* values are ignored).
 * There is no hardcoded fallback.
 * `ensureSunriseClinic` runs only while `demoLoginEnabled()` is true.
 */
export const SUNRISE_LOGIN_EMAILS = ["ananya.sunrise@lumera.me", "reception.sunrise@lumera.me"] as const;

export const SUNRISE_TENANT_NAME = "Sunrise Family Clinic";
const SUNRISE_SLUG = "sunrise-family-clinic";
const SUNRISE_CLINIC_PHONE = "+91 20 0000 5437";

const SHARED_PASSWORD_ENV = ["SUNRISE_PASSWORD", "SUNRISE_DEMO_PASSWORD"] as const;

export interface SunriseAccount {
  id: string;
  email: (typeof SUNRISE_LOGIN_EMAILS)[number];
  role: "doctor" | "receptionist";
  name: string;
  phone: string;
  specialty: string;
  passwordEnv: readonly string[];
}

export const SUNRISE_ACCOUNTS: readonly SunriseAccount[] = [
  {
    id: "user-sunrise-ananya",
    email: "ananya.sunrise@lumera.me",
    role: "doctor",
    name: "Dr. Ananya Sunrise",
    phone: "+91 90000 54301",
    specialty: "gp",
    passwordEnv: ["SUNRISE_DOCTOR_PASSWORD", "SUNRISE_ANANYA_PASSWORD"],
  },
  {
    id: "user-sunrise-reception",
    email: "reception.sunrise@lumera.me",
    role: "receptionist",
    name: "Sunrise Reception",
    phone: "+91 90000 54302",
    specialty: "",
    passwordEnv: ["SUNRISE_RECEPTION_PASSWORD", "SUNRISE_RECEPTIONIST_PASSWORD"],
  },
];

type UserRow = {
  id: string;
  email?: string | null;
  tenant_id?: string | null;
  role?: string | null;
  password_hash?: string | null;
  clinic_name?: string | null;
};

/** Same acceptance rules as `readSecret`, against an explicit env object. */
export function readSunriseSecret(env: NodeJS.ProcessEnv, ...names: string[]): string {
  for (const name of names) {
    const value = String(env[name] ?? "").trim();
    if (!isUnsetOrPlaceholder(value)) return value;
  }
  return "";
}

export function sunriseAccountPassword(account: SunriseAccount, env: NodeJS.ProcessEnv = process.env): string {
  return readSunriseSecret(env, ...account.passwordEnv) || readSunriseSecret(env, ...SHARED_PASSWORD_ENV);
}

function changes(result: SqlRunResult | undefined): number {
  return Number(result?.changes ?? 0);
}

function passwordMatches(password: string, stored: unknown): boolean {
  const hash = String(stored ?? "");
  if (!hash.includes(":")) return false;
  try {
    return verifyPassword(password, hash);
  } catch {
    return false;
  }
}

function insertSunriseTenant(database: SqlDatabase, now: string) {
  const trialEnds = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const attempts: Array<{ sql: string; params: unknown[] }> = [
    {
      sql: `INSERT INTO tenants (
             id, name, specialty, country, timezone, phone, trial_ends_at,
             ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id,
             created_at, updated_at, practice_type, lifecycle_status, slug, city
           )
           SELECT ?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', ?, ?, 500, 0, 1, '', ?, ?, 'individual', 'active', ?, 'Pune'
           WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = ?)`,
      params: [SUNRISE_TENANT_ID, SUNRISE_TENANT_NAME, SUNRISE_CLINIC_PHONE, trialEnds, now, now, SUNRISE_SLUG, SUNRISE_TENANT_ID],
    },
    {
      sql: `INSERT INTO tenants (
             id, name, specialty, country, timezone, phone, trial_ends_at,
             ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at
           )
           SELECT ?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', ?, ?, 500, 0, 1, '', ?, ?
           WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = ?)`,
      params: [SUNRISE_TENANT_ID, SUNRISE_TENANT_NAME, SUNRISE_CLINIC_PHONE, trialEnds, now, now, SUNRISE_TENANT_ID],
    },
  ];
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      database.prepare(attempt.sql).run(...attempt.params);
      const row = database.prepare("SELECT id FROM tenants WHERE id = ?").get(SUNRISE_TENANT_ID) as { id?: string } | undefined;
      if (row?.id) return;
    } catch (err) {
      lastError = err;
      const row = database.prepare("SELECT id FROM tenants WHERE id = ?").get(SUNRISE_TENANT_ID) as { id?: string } | undefined;
      if (row?.id) return;
    }
  }
  const message = lastError instanceof Error ? lastError.message : "insert failed";
  throw new Error(`Sunrise tenant ${SUNRISE_TENANT_ID} was not created (${message})`);
}

function findUser(database: SqlDatabase, email: string): UserRow | undefined {
  const exact = database.prepare("SELECT id, email, tenant_id, role, password_hash, clinic_name FROM users WHERE email = ?").get(email) as
    | UserRow
    | undefined;
  if (exact?.id) return exact;
  return database
    .prepare("SELECT id, email, tenant_id, role, password_hash, clinic_name FROM users WHERE lower(email) = ?")
    .get(email) as UserRow | undefined;
}

function freeUserId(database: SqlDatabase, preferred: string, email: string): string {
  const owner = database.prepare("SELECT email FROM users WHERE id = ?").get(preferred) as { email?: string } | undefined;
  if (!owner?.email || String(owner.email).trim().toLowerCase() === email) return preferred;
  const alt = `${preferred}-clinic`;
  const altOwner = database.prepare("SELECT email FROM users WHERE id = ?").get(alt) as { email?: string } | undefined;
  if (!altOwner?.email || String(altOwner.email).trim().toLowerCase() === email) return alt;
  throw new Error(`Sunrise login id ${preferred} is already used by a different account`);
}

function insertSunriseUser(database: SqlDatabase, account: SunriseAccount, userId: string, passwordHash: string, now: string) {
  const attempts: Array<{ sql: string; params: unknown[] }> = [
    {
      sql: `INSERT INTO users (
             id, tenant_id, email, password_hash, name, role, status, phone, clinic_name,
             onboarding_completed, practice_type, specialty, pack_id, last_login, created_at
           )
           SELECT ?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, 'individual', ?, ?, NULL, ?
           WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = ? OR id = ?)`,
      params: [
        userId,
        SUNRISE_TENANT_ID,
        account.email,
        passwordHash,
        account.name,
        account.role,
        account.phone,
        SUNRISE_TENANT_NAME,
        account.specialty,
        account.specialty,
        now,
        account.email,
        userId,
      ],
    },
    {
      sql: `INSERT INTO users (
             id, tenant_id, email, password_hash, name, role, status, phone, clinic_name,
             onboarding_completed, practice_type, specialty, last_login, created_at
           )
           SELECT ?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, 'individual', ?, NULL, ?
           WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = ? OR id = ?)`,
      params: [
        userId,
        SUNRISE_TENANT_ID,
        account.email,
        passwordHash,
        account.name,
        account.role,
        account.phone,
        SUNRISE_TENANT_NAME,
        account.specialty,
        now,
        account.email,
        userId,
      ],
    },
  ];
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const result = database.prepare(attempt.sql).run(...attempt.params);
      if (findUser(database, account.email)?.id) return;
      if (changes(result) > 0) return;
    } catch (err) {
      lastError = err;
      if (findUser(database, account.email)?.id) return;
    }
  }
  const message = lastError instanceof Error ? lastError.message : "insert failed";
  throw new Error(`Sunrise login ${account.email} was not created (${message})`);
}

function placeExistingUser(database: SqlDatabase, account: SunriseAccount, row: UserRow) {
  const canonicalTaken = database.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(account.email, row.id) as
    | { id?: string }
    | undefined;
  const email = !canonicalTaken?.id ? account.email : String(row.email || account.email);
  const clinicName = String(row.clinic_name || "");
  const nextClinic = clinicName.trim() ? clinicName : SUNRISE_TENANT_NAME;
  const tenantId = String(row.tenant_id || "");
  const role = String(row.role || "");
  if (tenantId === SUNRISE_TENANT_ID && role === account.role && String(row.email || "") === email && nextClinic === clinicName) {
    return;
  }
  database
    .prepare(
      `UPDATE users
       SET tenant_id = ?,
           role = ?,
           email = ?,
           clinic_name = CASE WHEN clinic_name IS NULL OR clinic_name = '' THEN ? ELSE clinic_name END
       WHERE id = ?`
    )
    .run(SUNRISE_TENANT_ID, account.role, email, SUNRISE_TENANT_NAME, row.id);
}

/**
 * Idempotent Sunrise clinic repair for the sandbox demo.
 * No-op unless `DEMO_LOGIN_ENABLED` is on, including production with demo login off:
 * it does not insert the tenant, move these emails, or write password hashes.
 * When the flag is on, creates tenant-543feff7 only when it is missing and does not
 * rewrite an existing tenant row. Places the two video logins on that tenant.
 * Sets a password only from SUNRISE_* env vars, and only when the user is new or
 * the stored hash does not verify against that secret. A verifying hash is left as stored.
 * Leaves every other user, tenant, and the WhatsApp quarantine row alone.
 */
export function ensureSunriseClinic(database: SqlDatabase, env: NodeJS.ProcessEnv = process.env): void {
  if (!demoLoginEnabled(env)) return;
  const now = new Date().toISOString();
  const existingTenant = database.prepare("SELECT id FROM tenants WHERE id = ?").get(SUNRISE_TENANT_ID) as { id?: string } | undefined;
  if (!existingTenant?.id) insertSunriseTenant(database, now);

  const production = String(env.NODE_ENV || "").trim() === "production";
  for (const account of SUNRISE_ACCOUNTS) {
    const password = sunriseAccountPassword(account, env);
    let row = findUser(database, account.email);
    if (!row) {
      if (!password) {
        if (production) {
          const names = [...account.passwordEnv, ...SHARED_PASSWORD_ENV].join(" or ");
          console.warn(`[Lumera] ${account.email} was not created because ${names} is unset.`);
        }
        continue;
      }
      insertSunriseUser(database, account, freeUserId(database, account.id, account.email), hashPassword(password), now);
      continue;
    }
    placeExistingUser(database, account, row);
    if (!password) continue;
    row = findUser(database, account.email) || row;
    // Rehash only when the stored hash does not verify. A match keeps the existing salt.
    if (passwordMatches(password, row.password_hash)) continue;
    database.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), row.id);
  }
}

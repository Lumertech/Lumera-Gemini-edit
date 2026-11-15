import type { SqlDatabase } from "./sql-engine.ts";

/**
 * Immunization chart tables live beside the accounts schema: CREATE TABLE
 * strings here are not part of the drizzle table-name contract in db-migrate.
 * Patient species and breed are added on the existing patients table.
 * The owner is the existing emergency / guardian contact, not a second person record.
 */
export function ensureImmunizationSchema(database: SqlDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS immunization_clinic_settings (
      tenant_id TEXT PRIMARY KEY,
      pediatric_schedule_id TEXT NOT NULL DEFAULT 'pediatric_iap',
      endemic_je INTEGER NOT NULL DEFAULT 0,
      include_optional INTEGER NOT NULL DEFAULT 1,
      edits_json TEXT NOT NULL DEFAULT '[]',
      catalog_version TEXT NOT NULL DEFAULT '',
      updated_by_id TEXT NOT NULL DEFAULT '',
      updated_by_name TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS immunization_dose_records (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      schedule_id TEXT NOT NULL,
      dose_code TEXT NOT NULL,
      occurrence_key TEXT NOT NULL,
      antigen TEXT NOT NULL DEFAULT '',
      dose_label TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      given_on TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT '',
      batch_no TEXT NOT NULL DEFAULT '',
      given_by_name TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      stock_administration_id TEXT NOT NULL DEFAULT '',
      confirmed_by_id TEXT NOT NULL DEFAULT '',
      confirmed_by_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, patient_id, occurrence_key)
    );

    CREATE INDEX IF NOT EXISTS idx_immunization_doses_tenant_patient
      ON immunization_dose_records(tenant_id, patient_id);
  `);
  for (const column of [
    "species TEXT NOT NULL DEFAULT ''",
    "breed TEXT NOT NULL DEFAULT ''",
  ]) {
    try {
      database.exec(`ALTER TABLE patients ADD COLUMN ${column}`);
    } catch {
      /* column already present */
    }
  }
}

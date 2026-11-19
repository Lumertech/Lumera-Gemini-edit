import type { SqlDatabase } from "./sql-engine.ts";

/**
 * Visit notes live beside the immunization tables. The CREATE TABLE string
 * stays out of db-migrate so it is not part of the drizzle table-name contract.
 */
export function ensureClinicalNotesSchema(database: SqlDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS clinical_notes (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      appointment_id TEXT NOT NULL DEFAULT '',
      author_id TEXT NOT NULL DEFAULT '',
      author_name TEXT NOT NULL DEFAULT '',
      author_role TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_clinical_notes_tenant_patient ON clinical_notes(tenant_id, patient_id)"
  );
}

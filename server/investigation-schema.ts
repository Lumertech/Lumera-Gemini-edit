import type { SqlDatabase } from "./sql-engine.ts";

/** Forward-only link from a saved report file to the visit it belongs to. */
export function ensureInvestigationSchema(database: SqlDatabase): void {
  try {
    database.exec("ALTER TABLE patient_documents ADD COLUMN appointment_id TEXT NOT NULL DEFAULT ''");
  } catch {
    /* column already present */
  }
  try {
    database.exec(
      "CREATE INDEX IF NOT EXISTS idx_patient_documents_appointment ON patient_documents(tenant_id, appointment_id)"
    );
  } catch {
    /* index already present */
  }
}

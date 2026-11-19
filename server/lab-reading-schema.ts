import type { SqlDatabase } from "./sql-engine.ts";

/** Forward-only columns for a doctor-confirmed reading of an uploaded report. */
export function ensureLabReadingSchema(database: SqlDatabase): void {
  const columns = [
    "document_id TEXT NOT NULL DEFAULT ''",
    "appointment_id TEXT NOT NULL DEFAULT ''",
    "status TEXT NOT NULL DEFAULT 'confirmed'",
    "draft_results TEXT NOT NULL DEFAULT '[]'",
    "confirmed_by_id TEXT NOT NULL DEFAULT ''",
    "confirmed_at TEXT NOT NULL DEFAULT ''",
  ];
  for (const column of columns) {
    try {
      database.exec(`ALTER TABLE lab_reports ADD COLUMN ${column}`);
    } catch {
      /* column already present */
    }
  }
}

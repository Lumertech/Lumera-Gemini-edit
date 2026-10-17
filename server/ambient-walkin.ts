import type { SqlDatabase } from "./sql-engine.ts";

/** Hidden scribe visit. Queue, tokens, reminders, and patient booking flows skip this source. */
export const AMBIENT_WALKIN_SOURCE = "ambient_walkin";

/**
 * Statuses that still count as an open visit.
 * Empty and null do not. "Triage / Vitals" is the schema's checked-in state.
 * "In Progress" is the kiosk's calling state. Comparison is case-insensitive.
 */
export const OPEN_VISIT_STATUSES = [
  "waiting",
  "open",
  "in consultation",
  "scheduled",
  "confirmed",
  "checked-in",
  "checked in",
  "triage / vitals",
  "in progress",
] as const;

const OPEN_VISIT_STATUS_SET = new Set<string>(OPEN_VISIT_STATUSES);

export function visitStatusIsOpen(status: unknown): boolean {
  if (status == null) return false;
  const value = String(status).trim().toLowerCase();
  if (!value) return false;
  return OPEN_VISIT_STATUS_SET.has(value);
}

/** Same allowlist as visitStatusIsOpen. Column is a fixed identifier, not user input. */
export function openVisitStatusSql(column = "status"): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(column)) {
    throw new Error("Invalid status column");
  }
  const list = OPEN_VISIT_STATUSES.map((status) => `'${status}'`).join(", ");
  return `lower(trim(COALESCE(${column}, ''))) IN (${list})`;
}

/**
 * One hidden walk-in per clinic, patient, doctor, and clinic day.
 * Drops older duplicates first so the index can be created on a database that already has rows.
 */
export function ensureAmbientWalkInUniqueIndex(database: SqlDatabase): void {
  const groups = database
    .prepare(
      `SELECT tenant_id, patient_id, doctor_id, date
       FROM appointments
       WHERE source = ?
       GROUP BY tenant_id, patient_id, doctor_id, date
       HAVING COUNT(*) > 1`
    )
    .all(AMBIENT_WALKIN_SOURCE) as Array<{
    tenant_id: string;
    patient_id: string;
    doctor_id: string;
    date: string;
  }>;
  const ids = database.prepare(
    `SELECT id FROM appointments
     WHERE source = ? AND tenant_id = ? AND patient_id = ? AND doctor_id = ? AND date = ?
     ORDER BY created_at DESC, id DESC`
  );
  const remove = database.prepare("DELETE FROM appointments WHERE id = ?");
  for (const group of groups) {
    const rows = ids.all(
      AMBIENT_WALKIN_SOURCE,
      group.tenant_id,
      group.patient_id,
      group.doctor_id,
      group.date
    ) as Array<{ id: string }>;
    for (const extra of rows.slice(1)) remove.run(extra.id);
  }
  database.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_ambient_walkin
     ON appointments (tenant_id, patient_id, doctor_id, date)
     WHERE source = 'ambient_walkin'`
  );
}

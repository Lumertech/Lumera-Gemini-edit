import type { SqlDatabase } from "./sql-engine.ts";

/** Hidden scribe visit. Queue, tokens, reminders, and patient booking flows skip this source. */
export const AMBIENT_WALKIN_SOURCE = "ambient_walkin";

/** Older duplicate of a hidden walk-in. Closed in place so the consent audit still has its appointment. */
export const AMBIENT_WALKIN_DUP_SOURCE = "ambient_walkin_dup";

export const HIDDEN_AMBIENT_SOURCES = [AMBIENT_WALKIN_SOURCE, AMBIENT_WALKIN_DUP_SOURCE] as const;

/** SQLite extended result code for a UNIQUE constraint. */
export const SQLITE_CONSTRAINT_UNIQUE = 2067;

/** Postgres unique_violation. */
export const POSTGRES_UNIQUE_VIOLATION = "23505";

export function isHiddenAmbientSource(source: unknown): boolean {
  const value = String(source ?? "");
  return (HIDDEN_AMBIENT_SOURCES as readonly string[]).includes(value);
}

/** Two bound parameters: ambient_walkin, then ambient_walkin_dup. Column is a fixed identifier. */
export function hiddenAmbientSourceSql(column = "source"): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(column)) {
    throw new Error("Invalid source column");
  }
  return `COALESCE(${column}, '') NOT IN (?, ?)`;
}

export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const coded = err as { code?: unknown; errcode?: unknown };
  if (coded.code === POSTGRES_UNIQUE_VIOLATION || coded.code === "SQLITE_CONSTRAINT_UNIQUE") return true;
  return coded.errcode === SQLITE_CONSTRAINT_UNIQUE;
}

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
 * One open hidden walk-in per clinic, patient, doctor, and clinic day.
 * Older copies stay in the table: status Completed and source ambient_walkin_dup.
 * The partial unique index is created only after those copies are closed.
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
  const closeExtra = database.prepare(
    "UPDATE appointments SET status = 'Completed', source = ? WHERE id = ?"
  );
  for (const group of groups) {
    const rows = ids.all(
      AMBIENT_WALKIN_SOURCE,
      group.tenant_id,
      group.patient_id,
      group.doctor_id,
      group.date
    ) as Array<{ id: string }>;
    for (const extra of rows.slice(1)) closeExtra.run(AMBIENT_WALKIN_DUP_SOURCE, extra.id);
  }
  database.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_ambient_walkin
     ON appointments (tenant_id, patient_id, doctor_id, date)
     WHERE source = 'ambient_walkin'`
  );
}

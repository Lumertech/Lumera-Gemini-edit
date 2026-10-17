import { randomUUID } from "node:crypto";
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

/** Audit action for a duplicate hidden walk-in closed in place. Ids only; no clinical text. */
export const AMBIENT_WALKIN_CLOSED_DUP_ACTION = "ambient_walkin_duplicate_closed";

export function isHiddenVisitSource(source: unknown): boolean {
  const value = String(source ?? "");
  return (HIDDEN_AMBIENT_SOURCES as readonly string[]).includes(value);
}

/** Two bound parameters: ambient_walkin, then ambient_walkin_dup. Column is a fixed identifier. */
export function hiddenVisitSourceSql(column = "source"): string {
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

const SQL_TEXT = /^[A-Za-z0-9:_./+-]{1,120}$/;

function sqlText(value: string): string {
  if (!SQL_TEXT.test(value)) throw new Error("Refusing to close a walk-in with an unsafe id");
  return `'${value}'`;
}

/** Open hidden walk-ins only. A completed visit from earlier today must not block a new one. */
function openAmbientWalkInIndexSql(): string {
  const statuses = OPEN_VISIT_STATUSES.map((status) => `'${status.replace(/'/g, "''")}'`).join(", ");
  return `CREATE UNIQUE INDEX idx_appointments_ambient_walkin
    ON appointments (tenant_id, patient_id, doctor_id, date)
    WHERE source = '${AMBIENT_WALKIN_SOURCE}'
      AND lower(trim(COALESCE(status, ''))) IN (${statuses})`;
}

function closureAuditSql(appointmentId: string, tenantId: string): string {
  return `INSERT INTO audit_logs (
      id, timestamp, user_id, user_name, action, details,
      tenant_id, patient_id, actor_role, entity_type, entity_id
    ) VALUES (
      ${sqlText(randomUUID())},
      ${sqlText(new Date().toISOString())},
      NULL,
      'System',
      ${sqlText(AMBIENT_WALKIN_CLOSED_DUP_ACTION)},
      '',
      ${sqlText(tenantId)},
      '',
      '',
      'appointment',
      ${sqlText(appointmentId)}
    )`;
}

/**
 * One transaction on SQLite (explicit BEGIN) and on Postgres (one multi-statement exec,
 * which the shim commits or rolls back together). Statements are literals: the shim's
 * per-query pool path cannot hold a transaction across prepare().
 */
function execTransactional(database: SqlDatabase, statements: string[]): void {
  const body = statements.map((statement) => statement.trim().replace(/;+\s*$/, "")).filter(Boolean).join(";\n");
  if (!body) return;
  if (database.dialect === "postgres") {
    database.exec(body);
    return;
  }
  try {
    database.exec(`BEGIN IMMEDIATE;\n${body};\nCOMMIT;`);
  } catch (err) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* the failed statement already left the transaction aborted */
    }
    throw err;
  }
}

/**
 * One open hidden walk-in per clinic, patient, doctor, and clinic day.
 * Older copies stay in the table: status Completed and source ambient_walkin_dup.
 * Each closure writes one audit row (ids and action only). The partial unique index
 * then covers open statuses only, so a visit already closed today can be followed by another.
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
    `SELECT id, tenant_id FROM appointments
     WHERE source = ? AND tenant_id = ? AND patient_id = ? AND doctor_id = ? AND date = ?
     ORDER BY created_at DESC, id DESC`
  );
  const statements: string[] = [];
  for (const group of groups) {
    const rows = ids.all(
      AMBIENT_WALKIN_SOURCE,
      group.tenant_id,
      group.patient_id,
      group.doctor_id,
      group.date
    ) as Array<{ id: string; tenant_id: string }>;
    for (const extra of rows.slice(1)) {
      statements.push(
        `UPDATE appointments SET status = 'Completed', source = ${sqlText(AMBIENT_WALKIN_DUP_SOURCE)} WHERE id = ${sqlText(extra.id)}`
      );
      statements.push(closureAuditSql(extra.id, extra.tenant_id));
    }
  }
  statements.push("DROP INDEX IF EXISTS idx_appointments_ambient_walkin");
  statements.push(openAmbientWalkInIndexSql());
  execTransactional(database, statements);
}

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

function quotedSqlText(value: string): string | null {
  if (!SQL_TEXT.test(value)) return null;
  return `'${value}'`;
}

/** True when an existing index already matches the open-walk-in predicate. */
export function openWalkInIndexDefinitionMatches(sql: string): boolean {
  const normalized = sql.toLowerCase();
  if (!/\bunique\b/.test(normalized)) return false;
  if (!/source\s*=\s*'ambient_walkin'(?!_)/.test(normalized)) return false;
  if (!normalized.includes("tenant_id") || !normalized.includes("patient_id") || !normalized.includes("doctor_id")) {
    return false;
  }
  if (!/\bdate\b/.test(normalized)) return false;
  return OPEN_VISIT_STATUSES.every((status) => normalized.includes(status));
}

/** Open hidden walk-ins only. A completed visit from earlier today must not block a new one. */
function openAmbientWalkInIndexSql(): string {
  const statuses = OPEN_VISIT_STATUSES.map((status) => `'${status.replace(/'/g, "''")}'`).join(", ");
  return `CREATE UNIQUE INDEX idx_appointments_ambient_walkin
    ON appointments (tenant_id, patient_id, doctor_id, date)
    WHERE source = '${AMBIENT_WALKIN_SOURCE}'
      AND lower(trim(COALESCE(status, ''))) IN (${statuses})`;
}

function postgresCloseAndAuditSql(appointmentId: string, tenantId: string): string | null {
  const id = quotedSqlText(appointmentId);
  const tenant = quotedSqlText(tenantId);
  const dupSource = quotedSqlText(AMBIENT_WALKIN_DUP_SOURCE);
  const walkIn = quotedSqlText(AMBIENT_WALKIN_SOURCE);
  const action = quotedSqlText(AMBIENT_WALKIN_CLOSED_DUP_ACTION);
  const auditId = quotedSqlText(randomUUID());
  const timestamp = quotedSqlText(new Date().toISOString());
  if (!id || !tenant || !dupSource || !walkIn || !action || !auditId || !timestamp) return null;
  return `WITH closed AS (
      UPDATE appointments
      SET status = 'Completed', source = ${dupSource}
      WHERE id = ${id} AND source = ${walkIn}
      RETURNING id
    )
    INSERT INTO audit_logs (
      id, timestamp, user_id, user_name, action, details,
      tenant_id, patient_id, actor_role, entity_type, entity_id
    )
    SELECT ${auditId}, ${timestamp}, NULL, 'System', ${action}, '', ${tenant}, '', '', 'appointment', closed.id
    FROM closed`;
}

function existingAmbientWalkInIndexSql(database: SqlDatabase): string {
  if (database.dialect === "postgres") {
    const row = database
      .prepare(
        `SELECT pg_get_indexdef(c.oid) AS sql
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind = 'i'
           AND c.relname = 'idx_appointments_ambient_walkin'
           AND n.nspname = current_schema()`
      )
      .get() as { sql?: string } | undefined;
    return String(row?.sql || "");
  }
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_appointments_ambient_walkin'")
    .get() as { sql?: string } | undefined;
  return String(row?.sql || "");
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

type WalkInKey = { tenant_id: string; patient_id: string; doctor_id: string; date: string };
type WalkInId = { id: string; tenant_id: string };

function logSkippedWalkInGroup(): void {
  console.error("ambient walk-in duplicate close skipped a group with an unsafe id");
}

/**
 * One open hidden walk-in per clinic, patient, doctor, and clinic day.
 * A walk-in already closed earlier that day is a real visit, so only open rows are grouped.
 * Older open copies stay in the table: status Completed and source ambient_walkin_dup.
 * The audit row is written only when that update changes a row. The partial unique index
 * is left in place when it already covers open statuses.
 */
export function ensureAmbientWalkInUniqueIndex(database: SqlDatabase): void {
  const open = openVisitStatusSql("status");
  const groups = database
    .prepare(
      `SELECT tenant_id, patient_id, doctor_id, date
       FROM appointments
       WHERE source = ? AND ${open}
       GROUP BY tenant_id, patient_id, doctor_id, date
       HAVING COUNT(*) > 1`
    )
    .all(AMBIENT_WALKIN_SOURCE) as WalkInKey[];
  const ids = database.prepare(
    `SELECT id, tenant_id FROM appointments
     WHERE source = ? AND tenant_id = ? AND patient_id = ? AND doctor_id = ? AND date = ?
       AND ${open}
     ORDER BY created_at DESC, id DESC`
  );
  const closures: WalkInId[] = [];
  for (const group of groups) {
    const rows = ids.all(
      AMBIENT_WALKIN_SOURCE,
      group.tenant_id,
      group.patient_id,
      group.doctor_id,
      group.date
    ) as WalkInId[];
    const extras = rows.slice(1);
    if (extras.some((row) => !SQL_TEXT.test(row.id) || !SQL_TEXT.test(String(row.tenant_id || "")))) {
      logSkippedWalkInGroup();
      continue;
    }
    closures.push(...extras);
  }

  const rebuildIndex = !openWalkInIndexDefinitionMatches(existingAmbientWalkInIndexSql(database));
  if (!closures.length && !rebuildIndex) return;

  if (database.dialect === "postgres") {
    const statements: string[] = [];
    for (const extra of closures) {
      const statement = postgresCloseAndAuditSql(extra.id, extra.tenant_id);
      if (!statement) {
        logSkippedWalkInGroup();
        continue;
      }
      statements.push(statement);
    }
    if (rebuildIndex) {
      statements.push("DROP INDEX IF EXISTS idx_appointments_ambient_walkin");
      statements.push(openAmbientWalkInIndexSql());
    }
    execTransactional(database, statements);
    return;
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    const update = database.prepare(
      "UPDATE appointments SET status = 'Completed', source = ? WHERE id = ? AND source = ?"
    );
    const audit = database.prepare(
      `INSERT INTO audit_logs (
        id, timestamp, user_id, user_name, action, details,
        tenant_id, patient_id, actor_role, entity_type, entity_id
      ) VALUES (?, ?, ?, 'System', ?, '', ?, '', '', 'appointment', ?)`
    );
    for (const extra of closures) {
      const result = update.run(AMBIENT_WALKIN_DUP_SOURCE, extra.id, AMBIENT_WALKIN_SOURCE);
      if (Number(result.changes || 0) < 1) continue;
      audit.run(randomUUID(), new Date().toISOString(), null, AMBIENT_WALKIN_CLOSED_DUP_ACTION, extra.tenant_id, extra.id);
    }
    if (rebuildIndex) {
      database.exec("DROP INDEX IF EXISTS idx_appointments_ambient_walkin");
      database.exec(openAmbientWalkInIndexSql());
    }
    database.exec("COMMIT");
  } catch (err) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* the failed statement already left the transaction aborted */
    }
    throw err;
  }
}

import type { SqlDatabase } from "./sql-engine.ts";

/**
 * prescription_drafts was keyed by patient_id, so a new visit reused the last
 * draft and two doctors overwrote each other. The key is
 * (tenant_id, patient_id, appointment_id), with appointment_id '' when the
 * note is not attached to a visit.
 *
 * Fresh boots already create that key in BOOTSTRAP_DDL. This upgrades an
 * older table. Postgres never touches sqlite_master or PRAGMA. A second boot
 * sees the composite key and returns.
 */

const DRAFT_PK = ["tenant_id", "patient_id", "appointment_id"];

function sqlIdent(name: string): string {
  return `"${String(name).replace(/"/g, "\"\"")}"`;
}

function sameKey(columns: string[]): boolean {
  return columns.length === DRAFT_PK.length && columns.every((column, index) => column === DRAFT_PK[index]);
}

const POSTGRES_TABLE_SQL = `
  SELECT table_name AS name
  FROM information_schema.tables
  WHERE table_schema = current_schema()
    AND table_name = 'prescription_drafts'
    AND table_type = 'BASE TABLE'
`;

const POSTGRES_APPOINTMENT_COLUMN_SQL = `
  SELECT column_name AS name
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'prescription_drafts'
    AND column_name = 'appointment_id'
`;

const POSTGRES_PK_COLUMNS_SQL = `
  SELECT a.attname AS name
  FROM pg_index i
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN LATERAL unnest(i.indkey::smallint[]) WITH ORDINALITY AS k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
  WHERE i.indisprimary
    AND n.nspname = current_schema()
    AND t.relname = 'prescription_drafts'
    AND k.attnum > 0
  ORDER BY k.ord
`;

const POSTGRES_PK_CONSTRAINT_SQL = `
  SELECT c.conname AS name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = current_schema()
    AND t.relname = 'prescription_drafts'
    AND c.contype = 'p'
`;

function migratePrescriptionDraftKeyPostgres(database: SqlDatabase): void {
  const table = database.prepare(POSTGRES_TABLE_SQL).get() as { name?: string } | undefined;
  if (!table?.name) return;

  const column = database.prepare(POSTGRES_APPOINTMENT_COLUMN_SQL).get() as { name?: string } | undefined;
  if (!column?.name) {
    database.exec("ALTER TABLE prescription_drafts ADD COLUMN appointment_id TEXT NOT NULL DEFAULT ''");
  }

  const pkRows = database.prepare(POSTGRES_PK_COLUMNS_SQL).all() as Array<{ name?: string }>;
  const pk = pkRows.map((row) => String(row?.name || "").trim()).filter(Boolean);
  if (sameKey(pk)) return;

  const constraints = database.prepare(POSTGRES_PK_CONSTRAINT_SQL).all() as Array<{ name?: string }>;
  for (const row of constraints) {
    const name = String(row?.name || "").trim();
    if (!name) continue;
    database.exec(`ALTER TABLE prescription_drafts DROP CONSTRAINT ${sqlIdent(name)}`);
  }
  database.exec("ALTER TABLE prescription_drafts ADD PRIMARY KEY (tenant_id, patient_id, appointment_id)");
}

type SqliteColumn = { name: string; pk: number };

function migratePrescriptionDraftKeySqlite(database: SqlDatabase): void {
  const table = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'prescription_drafts'")
    .get() as { name?: string } | undefined;
  if (!table?.name) return;

  const columns = database.prepare("PRAGMA table_info(prescription_drafts)").all() as SqliteColumn[];
  if (!columns.length) return;
  const pk = columns
    .filter((column) => Number(column.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((column) => column.name);
  if (sameKey(pk)) return;

  const hasAppointment = columns.some((column) => column.name === "appointment_id");
  const appointmentExpr = hasAppointment ? "COALESCE(appointment_id, '')" : "''";

  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("BEGIN");
  try {
    database.exec(
      `CREATE TABLE prescription_drafts__visit (
        tenant_id TEXT NOT NULL,
        patient_id TEXT NOT NULL,
        appointment_id TEXT NOT NULL DEFAULT '',
        doctor_id TEXT NOT NULL,
        draft_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, patient_id, appointment_id)
      )`
    );
    database.exec(
      `INSERT INTO prescription_drafts__visit (tenant_id, patient_id, appointment_id, doctor_id, draft_json, updated_at)
       SELECT tenant_id, patient_id, ${appointmentExpr}, doctor_id, draft_json, updated_at
       FROM prescription_drafts`
    );
    database.exec("DROP TABLE prescription_drafts");
    database.exec("ALTER TABLE prescription_drafts__visit RENAME TO prescription_drafts");
    database.exec("COMMIT");
  } catch (err) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

export function migratePrescriptionDraftKey(database: SqlDatabase): void {
  if (database.dialect === "postgres") {
    migratePrescriptionDraftKeyPostgres(database);
    return;
  }
  migratePrescriptionDraftKeySqlite(database);
}

import type { SqlDatabase } from "./sql-engine.ts";
import { resolveSqlEngineKind, type SqlEngineKind } from "./sql-open.ts";

function sqlIdent(name: string): string {
  return `"${String(name).replace(/"/g, "\"\"")}"`;
}

/** Dashboard WhatsApp rows need a tenant_id for isolation filters. */
export function addWhatsAppTenantColumns(database: SqlDatabase) {
  try {
    database.exec("ALTER TABLE whatsapp_conversations ADD COLUMN tenant_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE whatsapp_messages ADD COLUMN tenant_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE whatsapp_outbound_events ADD COLUMN tenant_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("CREATE INDEX IF NOT EXISTS idx_wa_conv_tenant ON whatsapp_conversations(tenant_id)");
  } catch {}
}

/**
 * Drop the legacy UNIQUE(phone) constraint and replace it with
 * UNIQUE(tenant_id, phone). SQLite autoindexes cannot always be DROPped, so
 * existing databases rebuild the table.
 *
 * MERGE NOTE (PR #80 schema-a.ts): unique(tenant_id, phone), not phone.unique().
 *
 * Postgres (Cloud SQL) must not query sqlite_master / PRAGMA. Tip 00053 crashed
 * initDatabase with 42P01 relation "sqlite_master" does not exist.
 */
export function migratePatientsPhoneUnique(
  database: SqlDatabase,
  engine: SqlEngineKind = resolveSqlEngineKind()
) {
  if (engine === "postgres") {
    migratePatientsPhoneUniquePostgres(database);
    return;
  }
  migratePatientsPhoneUniqueSqlite(database);
}

const PATIENTS_TABLE_POSTGRES_SQL = `
  SELECT table_name AS name
  FROM information_schema.tables
  WHERE table_schema = current_schema()
    AND table_name = 'patients'
    AND table_type = 'BASE TABLE'
`;

/** Inline UNIQUE(phone) lands in pg_constraint (typically patients_phone_key). */
const PHONE_UNIQUE_CONSTRAINTS_SQL = `
  SELECT c.conname AS name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN LATERAL (
    SELECT array_agg(a.attname::text ORDER BY u.ord) AS col_names
    FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = u.attnum
  ) key_cols ON true
  WHERE n.nspname = current_schema()
    AND t.relname = 'patients'
    AND c.contype = 'u'
    AND key_cols.col_names = ARRAY['phone']::text[]
`;

/** Unique indexes on phone alone that are not the primary key. */
const PHONE_UNIQUE_INDEXES_SQL = `
  SELECT i.relname AS name
  FROM pg_index ix
  JOIN pg_class t ON t.oid = ix.indrelid
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN LATERAL (
    SELECT array_agg(a.attname::text ORDER BY k.ord) AS col_names
    FROM unnest(ix.indkey::smallint[]) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE k.attnum > 0
  ) key_cols ON true
  WHERE n.nspname = current_schema()
    AND t.relname = 'patients'
    AND ix.indisunique
    AND NOT ix.indisprimary
    AND ix.indnatts = 1
    AND key_cols.col_names = ARRAY['phone']::text[]
`;

function catalogNames(database: SqlDatabase, sql: string): string[] {
  const rows = database.prepare(sql).all() as Array<{ name?: unknown }>;
  const names: string[] = [];
  for (const row of rows) {
    const name = String(row?.name ?? "").trim();
    if (name) names.push(name);
  }
  return names;
}

function migratePatientsPhoneUniquePostgres(database: SqlDatabase) {
  const table = database.prepare(PATIENTS_TABLE_POSTGRES_SQL).get() as { name?: string } | undefined;
  if (!table?.name) return;

  for (const name of catalogNames(database, PHONE_UNIQUE_CONSTRAINTS_SQL)) {
    database.exec(`ALTER TABLE patients DROP CONSTRAINT IF EXISTS ${sqlIdent(name)}`);
  }

  for (const name of catalogNames(database, PHONE_UNIQUE_INDEXES_SQL)) {
    const ident = sqlIdent(name);
    try {
      database.exec(`DROP INDEX IF EXISTS ${ident}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/constraint/i.test(message)) throw err;
      database.exec(`ALTER TABLE patients DROP CONSTRAINT IF EXISTS ${ident}`);
    }
  }

  try {
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_tenant_phone ON patients(tenant_id, phone)");
  } catch {
    /* duplicate (tenant, phone) rows must be resolved before the unique index can apply */
  }
}

function migratePatientsPhoneUniqueSqlite(database: SqlDatabase) {
  const table = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'patients'")
    .get() as { name: string } | undefined;
  if (!table) return;

  let phoneOnlyUnique = false;
  try {
    const indexes = database.prepare("PRAGMA index_list(patients)").all() as Array<{ name: string; unique: number }>;
    for (const idx of indexes) {
      if (!idx.unique) continue;
      const info = database.prepare(`PRAGMA index_info(${sqlIdent(idx.name)})`).all() as Array<{ name: string }>;
      const cols = info.map((c) => c.name);
      if (cols.length === 1 && cols[0] === "phone") {
        phoneOnlyUnique = true;
        try {
          database.exec(`DROP INDEX IF EXISTS ${sqlIdent(idx.name)}`);
          phoneOnlyUnique = false;
        } catch {
          phoneOnlyUnique = true;
        }
      }
    }
  } catch {
    /* pragma unsupported */
  }

  if (phoneOnlyUnique) {
    rebuildPatientsTableWithoutPhoneUnique(database);
  }

  try {
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_tenant_phone ON patients(tenant_id, phone)");
  } catch {
    /* duplicate (tenant, phone) rows must be resolved before the unique index can apply */
  }
}

function rebuildPatientsTableWithoutPhoneUnique(database: SqlDatabase) {
  const cols = database.prepare("PRAGMA table_info(patients)").all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
    pk: number;
  }>;
  if (!cols.length) return;

  const colDefs = cols.map((c) => {
    const type = c.type || "TEXT";
    let def = `${sqlIdent(c.name)} ${type}`;
    if (c.pk) {
      def += " PRIMARY KEY";
    } else {
      if (c.notnull) def += " NOT NULL";
      if (c.dflt_value !== null && c.dflt_value !== undefined) def += ` DEFAULT ${c.dflt_value}`;
      if (c.name === "uhid") def += " UNIQUE";
    }
    return def;
  });
  const names = cols.map((c) => sqlIdent(c.name)).join(", ");

  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("BEGIN");
  try {
    database.exec(`CREATE TABLE patients__phone_scope (${colDefs.join(", ")})`);
    database.exec(`INSERT INTO patients__phone_scope (${names}) SELECT ${names} FROM patients`);
    database.exec("DROP TABLE patients");
    database.exec("ALTER TABLE patients__phone_scope RENAME TO patients");
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
  try {
    database.exec("CREATE INDEX IF NOT EXISTS idx_patients_tenant ON patients(tenant_id)");
  } catch {}
  try {
    database.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_tenant_abha ON patients(tenant_id, abha_number) WHERE abha_number IS NOT NULL AND TRIM(abha_number) != ''"
    );
  } catch {}
}

export function applyTenantPhoneSecurityMigrations(
  database: SqlDatabase,
  engine: SqlEngineKind = resolveSqlEngineKind()
) {
  addWhatsAppTenantColumns(database);
  migratePatientsPhoneUnique(database, engine);
  const demoTenantId = "tenant-lumera-main";
  try {
    database.exec(
      `UPDATE whatsapp_conversations SET tenant_id = '${demoTenantId}' WHERE tenant_id IS NULL OR tenant_id = ''`
    );
    database.exec(
      `UPDATE whatsapp_messages SET tenant_id = '${demoTenantId}' WHERE tenant_id IS NULL OR tenant_id = ''`
    );
    database.exec(
      `UPDATE whatsapp_outbound_events SET tenant_id = '${demoTenantId}' WHERE tenant_id IS NULL OR tenant_id = ''`
    );
  } catch {
    /* columns missing until ALTER above */
  }
}

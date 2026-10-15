import type { SqlDatabase } from "./sql-engine.ts";
import { resolveSqlEngineKind, type SqlEngineKind } from "./sql-open.ts";
import { backfillWhatsAppTenantIds, WHATSAPP_QUARANTINE_TENANT_ID } from "./whatsapp-tenant-backfill.ts";

function sqlIdent(name: string): string {
  return `"${String(name).replace(/"/g, "\"\"")}"`;
}

/** SQLite says "duplicate column name". Postgres uses SQLSTATE 42701. */
function isDuplicateColumnError(err: unknown): boolean {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code || "") : "";
  if (code === "42701") return true;
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /duplicate column/i.test(message);
}

/** Dashboard WhatsApp rows need a tenant_id for isolation filters. */
export function addWhatsAppTenantColumns(database: SqlDatabase) {
  try {
    database.exec("ALTER TABLE whatsapp_conversations ADD COLUMN tenant_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE whatsapp_conversations ADD COLUMN phone_number_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE whatsapp_conversations ADD COLUMN waba_id TEXT DEFAULT ''");
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
  try {
    database.exec("CREATE INDEX IF NOT EXISTS idx_wa_msg_tenant ON whatsapp_messages(tenant_id)");
  } catch {}
  try {
    database.exec("ALTER TABLE whatsapp_conversations ADD COLUMN last_inbound_at TEXT");
  } catch (err) {
    if (!isDuplicateColumnError(err)) throw err;
  }
  try {
    database.exec("CREATE INDEX IF NOT EXISTS idx_wa_evt_tenant ON whatsapp_outbound_events(tenant_id)");
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

const WA_CONV_PHONE_UNIQUE_POSTGRES_SQL = `
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
    AND t.relname = 'whatsapp_conversations'
    AND c.contype = 'u'
    AND key_cols.col_names = ARRAY['patient_phone']::text[]
`;

/**
 * Conversation identity is (tenant_id, patient_phone). Drop a legacy UNIQUE(patient_phone)
 * so two clinics can keep separate threads for the same handset.
 */
export function migrateWhatsAppConversationKey(
  database: SqlDatabase,
  engine: SqlEngineKind = resolveSqlEngineKind()
) {
  if (engine === "postgres") {
    try {
      for (const name of catalogNames(database, WA_CONV_PHONE_UNIQUE_POSTGRES_SQL)) {
        database.exec(`ALTER TABLE whatsapp_conversations DROP CONSTRAINT IF EXISTS ${sqlIdent(name)}`);
      }
    } catch {
      /* conversations table is created later on a partial bootstrap */
    }
  } else {
    try {
      const indexes = database.prepare("PRAGMA index_list(whatsapp_conversations)").all() as Array<{
        name: string;
        unique: number;
      }>;
      let phoneOnlyUnique = false;
      for (const idx of indexes) {
        if (!idx.unique) continue;
        const info = database.prepare(`PRAGMA index_info(${sqlIdent(idx.name)})`).all() as Array<{ name: string }>;
        const cols = info.map((c) => c.name);
        if (cols.length === 1 && cols[0] === "patient_phone") {
          phoneOnlyUnique = true;
          try {
            database.exec(`DROP INDEX IF EXISTS ${sqlIdent(idx.name)}`);
            phoneOnlyUnique = false;
          } catch {
            phoneOnlyUnique = true;
          }
        }
      }
      if (phoneOnlyUnique) rebuildWhatsAppConversationsWithoutPhoneUnique(database);
    } catch {
      /* table not created yet */
    }
  }
  try {
    database.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_conv_tenant_phone ON whatsapp_conversations(tenant_id, patient_phone)"
    );
  } catch {
    /* duplicate (tenant, phone) rows must be resolved before the unique index can apply */
  }
}

function rebuildWhatsAppConversationsWithoutPhoneUnique(database: SqlDatabase) {
  const cols = database.prepare("PRAGMA table_info(whatsapp_conversations)").all() as Array<{
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
    if (c.pk) def += " PRIMARY KEY";
    else {
      if (c.notnull) def += " NOT NULL";
      if (c.dflt_value !== null && c.dflt_value !== undefined) def += ` DEFAULT ${c.dflt_value}`;
    }
    return def;
  });
  const names = cols.map((c) => sqlIdent(c.name)).join(", ");
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("BEGIN");
  try {
    database.exec(`CREATE TABLE whatsapp_conversations__tenant_phone (${colDefs.join(", ")})`);
    database.exec(
      `INSERT INTO whatsapp_conversations__tenant_phone (${names}) SELECT ${names} FROM whatsapp_conversations`
    );
    database.exec("DROP TABLE whatsapp_conversations");
    database.exec("ALTER TABLE whatsapp_conversations__tenant_phone RENAME TO whatsapp_conversations");
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
    database.exec("CREATE INDEX IF NOT EXISTS idx_wa_conv_tenant ON whatsapp_conversations(tenant_id)");
  } catch {}
}

/** Postgres columns are NOT NULL after the quarantine backfill. Fresh sqlite CREATE already is. */
export function enforceWhatsAppTenantNotNull(
  database: SqlDatabase,
  engine: SqlEngineKind = resolveSqlEngineKind()
) {
  if (engine !== "postgres") return;
  const fallback = WHATSAPP_QUARANTINE_TENANT_ID.replace(/'/g, "");
  const statements = [
    `ALTER TABLE whatsapp_conversations ALTER COLUMN tenant_id SET DEFAULT '${fallback}'`,
    `ALTER TABLE whatsapp_conversations ALTER COLUMN tenant_id SET NOT NULL`,
    `ALTER TABLE whatsapp_messages ALTER COLUMN tenant_id SET DEFAULT '${fallback}'`,
    `ALTER TABLE whatsapp_messages ALTER COLUMN tenant_id SET NOT NULL`,
    `ALTER TABLE whatsapp_outbound_events ALTER COLUMN tenant_id SET DEFAULT '${fallback}'`,
    `ALTER TABLE whatsapp_outbound_events ALTER COLUMN tenant_id SET NOT NULL`,
  ];
  for (const statement of statements) {
    try {
      database.exec(statement);
    } catch {
      /* table or column is created later on a partial bootstrap */
    }
  }
}

export function applyTenantPhoneSecurityMigrations(
  database: SqlDatabase,
  engine: SqlEngineKind = resolveSqlEngineKind()
) {
  addWhatsAppTenantColumns(database);
  migratePatientsPhoneUnique(database, engine);
  // Unresolved WhatsApp rows go to the quarantine tenant. Do not dump them onto the Meta App Review tenant.
  backfillWhatsAppTenantIds(database);
  migrateWhatsAppConversationKey(database, engine);
  enforceWhatsAppTenantNotNull(database, engine);
}

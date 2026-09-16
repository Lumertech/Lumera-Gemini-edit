import type { DatabaseSync } from "node:sqlite";

function sqlIdent(name: string): string {
  return `"${String(name).replace(/"/g, "\"\"")}"`;
}

/** Dashboard WhatsApp rows need a tenant_id for isolation filters. */
export function addWhatsAppTenantColumns(database: DatabaseSync) {
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
 */
export function migratePatientsPhoneUnique(database: DatabaseSync) {
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

function rebuildPatientsTableWithoutPhoneUnique(database: DatabaseSync) {
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

export function applyTenantPhoneSecurityMigrations(database: DatabaseSync) {
  addWhatsAppTenantColumns(database);
  migratePatientsPhoneUnique(database);
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

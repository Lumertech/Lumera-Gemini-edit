/**
 * OPD tokens are a per-(tenant, queue date, doctor) sequence.
 * The queue date is appointments.date (YYYY-MM-DD in the tenant timezone).
 * A token may repeat on another day or for another doctor. It must not
 * overwrite a different row.
 */
import type { SqlDatabase } from "./sql-engine.ts";
import { HIDDEN_AMBIENT_SOURCES } from "./ambient-walkin.ts";

const TOKEN_INDEX = "idx_appointments_tenant_queue_doctor_token";

export interface TokenDuplicate {
  tenant_id: string;
  date: string;
  doctor_id: string;
  token_number: number;
  n: number;
}

/** Hidden ambient rows share token 0 and must not move the visible sequence when `source` exists. */
function visibleTokenClause(database: SqlDatabase): { sql: string; params: readonly string[] } {
  if (!appointmentsHaveSource(database)) return { sql: "", params: [] };
  return { sql: " AND COALESCE(source, '') NOT IN (?, ?)", params: HIDDEN_AMBIENT_SOURCES };
}

export function nextTokenNumber(
  database: SqlDatabase,
  tenantId: string,
  queueDate: string,
  doctorId: string
): number {
  const hidden = visibleTokenClause(database);
  const row = database
    .prepare(
      `SELECT COALESCE(MAX(token_number), 0) AS max_token
       FROM appointments
       WHERE tenant_id = ? AND date = ? AND doctor_id = ?${hidden.sql}`
    )
    .get(tenantId, queueDate, doctorId, ...hidden.params) as { max_token?: number } | undefined;
  return Number(row?.max_token || 0) + 1;
}

export function tokenInUse(
  database: SqlDatabase,
  tenantId: string,
  queueDate: string,
  doctorId: string,
  tokenNumber: number,
  exceptId = ""
): boolean {
  const hidden = visibleTokenClause(database);
  const row = database
    .prepare(
      `SELECT id FROM appointments
       WHERE tenant_id = ? AND date = ? AND doctor_id = ? AND token_number = ? AND id != ?${hidden.sql}
       LIMIT 1`
    )
    .get(tenantId, queueDate, doctorId, tokenNumber, exceptId, ...hidden.params) as { id?: string } | undefined;
  return Boolean(row?.id);
}

/** Staff-chosen tokens. Anything else (missing, fractional, 0, above the cap) is allocated. */
export const MAX_STAFF_TOKEN = 99999;

export function staffTokenRequest(requested: unknown): number | undefined {
  const ask = Number(requested);
  if (!Number.isInteger(ask) || ask < 1 || ask > MAX_STAFF_TOKEN) return undefined;
  return ask;
}

/** Use the requested token when it is a free staff token in this bucket. Otherwise the next free number. */
export function allocateTokenNumber(
  database: SqlDatabase,
  tenantId: string,
  queueDate: string,
  doctorId: string,
  requested?: number,
  exceptId = ""
): number {
  const doctor = String(doctorId || "");
  const ask = staffTokenRequest(requested);
  if (ask !== undefined && !tokenInUse(database, tenantId, queueDate, doctor, ask, exceptId)) {
    return ask;
  }
  let token = nextTokenNumber(database, tenantId, queueDate, doctor);
  while (tokenInUse(database, tenantId, queueDate, doctor, token, exceptId)) token += 1;
  return token;
}

export function tokenClashError(): Error {
  return Object.assign(new Error("That token is already in use for this queue"), { status: 409 });
}

/**
 * Write the allocated token. One unique-index clash retries with a fresh number.
 * A second clash is a generic 409. The database error text is not returned.
 */
export function writeAllocatedToken(
  write: (token: number) => void,
  allocate: (requested?: number) => number,
  requested?: number
): number {
  let token = allocate(requested);
  try {
    write(token);
    return token;
  } catch (err) {
    if (!isTokenUniqueViolation(err)) throw err;
  }
  token = allocate(undefined);
  try {
    write(token);
    return token;
  } catch (err) {
    if (isTokenUniqueViolation(err)) throw tokenClashError();
    throw err;
  }
}

export function isTokenUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  return /unique|duplicate key/i.test(message) && /token_number|idx_appointments_tenant_queue_doctor_token/i.test(message);
}

/** Groups that already share a token inside one tenant, queue date, and doctor. Rows are not changed. */
export function appointmentTokenDuplicates(database: SqlDatabase): TokenDuplicate[] {
  try {
    const rows = database
      .prepare(
        `SELECT tenant_id, date, doctor_id, token_number, COUNT(*) AS n
         FROM appointments
         GROUP BY tenant_id, date, doctor_id, token_number
         HAVING COUNT(*) > 1`
      )
      .all() as TokenDuplicate[];
    return rows.map((row) => ({
      tenant_id: String(row.tenant_id || ""),
      date: String(row.date || ""),
      doctor_id: String(row.doctor_id || ""),
      token_number: Number(row.token_number || 0),
      n: Number(row.n || 0),
    }));
  } catch {
    return [];
  }
}

function appointmentsHaveSource(database: SqlDatabase): boolean {
  try {
    if (database.dialect === "postgres") {
      const row = database
        .prepare(
          `SELECT 1 AS ok FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'appointments' AND column_name = 'source'`
        )
        .get() as { ok?: number } | undefined;
      return Boolean(row?.ok);
    }
    const row = database
      .prepare(`SELECT 1 AS ok FROM pragma_table_info('appointments') WHERE name = 'source'`)
      .get() as { ok?: number } | undefined;
    return Boolean(row?.ok);
  } catch {
    return false;
  }
}

/** Duplicates that would block the queue index. Hidden ambient token 0 rows are allowed to repeat. */
function queueTokenDuplicates(database: SqlDatabase): TokenDuplicate[] {
  if (!appointmentsHaveSource(database)) return appointmentTokenDuplicates(database);
  try {
    const rows = database
      .prepare(
        `SELECT tenant_id, date, doctor_id, token_number, COUNT(*) AS n
         FROM appointments
         WHERE COALESCE(source, '') NOT IN (?, ?)
         GROUP BY tenant_id, date, doctor_id, token_number
         HAVING COUNT(*) > 1`
      )
      .all(...HIDDEN_AMBIENT_SOURCES) as TokenDuplicate[];
    return rows.map((row) => ({
      tenant_id: String(row.tenant_id || ""),
      date: String(row.date || ""),
      doctor_id: String(row.doctor_id || ""),
      token_number: Number(row.token_number || 0),
      n: Number(row.n || 0),
    }));
  } catch {
    return appointmentTokenDuplicates(database);
  }
}

function existingTokenIndexSql(database: SqlDatabase): string {
  try {
    if (database.dialect === "postgres") {
      const row = database
        .prepare(
          `SELECT pg_get_indexdef(c.oid) AS sql
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relkind = 'i' AND c.relname = ? AND n.nspname = current_schema()`
        )
        .get(TOKEN_INDEX) as { sql?: string } | undefined;
      return String(row?.sql || "");
    }
    const row = database
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`)
      .get(TOKEN_INDEX) as { sql?: string } | undefined;
    return String(row?.sql || "");
  } catch {
    return "";
  }
}

/**
 * Unique index on (tenant, queue date, doctor, token) when no visible duplicates exist.
 * Hidden ambient visits share token 0 and stay outside the index. Existing duplicate
 * rows are reported and left in place. The index is skipped so this migration cannot
 * delete or rewrite them.
 */
export function ensureAppointmentTokenIndex(database: SqlDatabase): {
  created: boolean;
  duplicates: TokenDuplicate[];
} {
  const duplicates = queueTokenDuplicates(database);
  if (duplicates.length > 0) {
    const skippedTenants = [...new Set(duplicates.map((row) => row.tenant_id).filter(Boolean))];
    const sample = duplicates
      .slice(0, 20)
      .map((row) => `${row.tenant_id} ${row.date} doctor=${row.doctor_id || "—"} token=${row.token_number} ×${row.n}`)
      .join("; ");
    console.warn(
      `[Lumera] unique appointment token index skipped for tenant(s): ${skippedTenants.join(", ") || "—"}. ${duplicates.length} duplicate group(s). Rows were not modified. ${sample}`
    );
    return { created: false, duplicates };
  }
  const partial = appointmentsHaveSource(database);
  const existing = existingTokenIndexSql(database);
  const partialReady = /ambient_walkin/.test(existing);
  if (existing && (!partial || partialReady)) {
    return { created: false, duplicates: [] };
  }
  if (existing) {
    database.exec(`DROP INDEX IF EXISTS ${TOKEN_INDEX}`);
  }
  const predicate = partial
    ? ` WHERE COALESCE(source, '') NOT IN ('ambient_walkin', 'ambient_walkin_dup')`
    : "";
  database.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${TOKEN_INDEX}
     ON appointments(tenant_id, date, doctor_id, token_number)${predicate}`
  );
  return { created: true, duplicates: [] };
}

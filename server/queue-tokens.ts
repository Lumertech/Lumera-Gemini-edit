/**
 * OPD tokens are a per-(tenant, queue date, doctor) sequence.
 * The queue date is appointments.date (YYYY-MM-DD in the tenant timezone).
 * A token may repeat on another day or for another doctor. It must not
 * overwrite a different row.
 */
import type { SqlDatabase } from "./sql-engine.ts";

export interface TokenDuplicate {
  tenant_id: string;
  date: string;
  doctor_id: string;
  token_number: number;
  n: number;
}

export function nextTokenNumber(
  database: SqlDatabase,
  tenantId: string,
  queueDate: string,
  doctorId: string
): number {
  const row = database
    .prepare(
      `SELECT COALESCE(MAX(token_number), 0) AS max_token
       FROM appointments
       WHERE tenant_id = ? AND date = ? AND doctor_id = ?`
    )
    .get(tenantId, queueDate, doctorId) as { max_token?: number } | undefined;
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
  const row = database
    .prepare(
      `SELECT id FROM appointments
       WHERE tenant_id = ? AND date = ? AND doctor_id = ? AND token_number = ? AND id != ?
       LIMIT 1`
    )
    .get(tenantId, queueDate, doctorId, tokenNumber, exceptId) as { id?: string } | undefined;
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

/**
 * Unique index on (tenant, queue date, doctor, token) when no duplicates exist.
 * Existing duplicate rows are reported and left in place. The index is skipped
 * so this migration cannot delete or rewrite them.
 */
export function ensureAppointmentTokenIndex(database: SqlDatabase): {
  created: boolean;
  duplicates: TokenDuplicate[];
} {
  const duplicates = appointmentTokenDuplicates(database);
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
  database.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_tenant_queue_doctor_token
     ON appointments(tenant_id, date, doctor_id, token_number)`
  );
  return { created: true, duplicates: [] };
}

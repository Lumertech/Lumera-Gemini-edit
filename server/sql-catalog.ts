import type { SqlDatabase } from "./sql-engine.ts";

/**
 * Table existence for boot and seed code.
 * Postgres has no sqlite_master. Querying it aborts initDatabase with
 * 42P01 relation "sqlite_master" does not exist.
 */
export function tableExists(database: SqlDatabase, name: string): boolean {
  if (database.dialect === "postgres") {
    const row = database.prepare(`SELECT (to_regclass(?) IS NOT NULL) AS ok`).get(name) as
      | { ok?: boolean | number | string | null }
      | undefined;
    return row?.ok === true || row?.ok === 1 || row?.ok === "t" || row?.ok === "true";
  }
  const row = database.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) as
    | { ok?: number }
    | undefined;
  return Boolean(row);
}

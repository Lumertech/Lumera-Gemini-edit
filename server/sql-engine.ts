/**
 * Structural subset of node:sqlite DatabaseSync used by Lumera call sites.
 * SQLite DatabaseSync and the Postgres shim both satisfy this.
 */
export interface SqlRunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

export interface SqlStatement {
  run(...params: unknown[]): SqlRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  exec(sql: string): void;
}

/**
 * Refuse the local sqlite file on Cloud Run / bundled production server.
 * Tests that set NODE_ENV=production still use sqlite when DATABASE_URL is
 * unset — they do not set K_SERVICE and they do not run dist/server.cjs.
 */
export function sqliteFallbackForbidden(env: NodeJS.ProcessEnv = process.env, argv1 = process.argv[1]): boolean {
  if (String(env.K_SERVICE || "").trim() || String(env.K_REVISION || "").trim()) return true;
  if (/(^|[\\/])server\.cjs$/.test(String(argv1 || ""))) return true;
  return false;
}

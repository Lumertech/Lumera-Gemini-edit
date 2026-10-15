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
  /** Present on the Postgres shim. SQLite connections omit it. */
  dialect?: "postgres";
}

/**
 * Refuse the local sqlite file when a durable engine is required.
 *
 * True when:
 * - NODE_ENV=production (Cloud Run / `npm start`)
 * - Cloud Run injects K_SERVICE / K_REVISION
 * - the process is the bundled dist/server.cjs
 *
 * Callers must still prefer DATABASE_URL / pg-shim when a URL is set.
 * Tests that only flip NODE_ENV after initDatabase() keep their existing
 * connection; they must not call initDatabase() again without DATABASE_URL.
 */
export function sqliteFallbackForbidden(env: NodeJS.ProcessEnv = process.env, argv1 = process.argv[1]): boolean {
  if (String(env.NODE_ENV || "").trim() === "production") return true;
  if (String(env.K_SERVICE || "").trim() || String(env.K_REVISION || "").trim()) return true;
  if (/(^|[\\/])server\.cjs$/.test(String(argv1 || ""))) return true;
  return false;
}

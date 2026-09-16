import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";
import { isUnsetOrPlaceholder } from "./env-value.ts";
import { databaseUrlFromEnv } from "./url.ts";

declare global {
  var _postgresPool: Pool | undefined;
  var _postgresPoolLastError: Error | undefined;
}

export { databaseUrlFromEnv, cloudSqlUnixSocketUrl } from "./url.ts";
export * from "./schema.ts";

/** Local / test drizzle path. Production uses DATABASE_URL_REQUIRED_MESSAGE. */
export const LOCAL_POOL_ENV_REQUIRED_MESSAGE =
  "DATABASE_URL (or INSTANCE_CONNECTION_NAME + SQL_USER + SQL_PASSWORD + SQL_DB_NAME) is required to create a Postgres pool. Leave it unset to use sqlite via getDb()/initDatabase() locally. Placeholders (replace-with-*, change-me) do not count.";

export const PRODUCTION_POOL_ENV_REQUIRED_MESSAGE =
  "DATABASE_URL is required in production (Cloud Run is stateless; node:sqlite files are discarded on deploy/scale). Set DATABASE_URL to the Cloud SQL unix-socket URI (postgres://user:pass@/dbname?host=/cloudsql/PROJECT:asia-south1:INSTANCE) or INSTANCE_CONNECTION_NAME + SQL_USER + SQL_PASSWORD + SQL_DB_NAME, plus Cloud Run --add-cloudsql-instances. This process exits before listen(0.0.0.0, PORT); Cloud Run will report a PORT timeout even though bind is not the bug.";

function productionLike(env: NodeJS.ProcessEnv): boolean {
  return (
    String(env.NODE_ENV || "").trim() === "production" ||
    Boolean(String(env.K_SERVICE || "").trim() || String(env.K_REVISION || "").trim())
  );
}

export function getPostgresPoolLastError(): Error | undefined {
  return global._postgresPoolLastError;
}

/** Tests only — ends the cached pool so the next createPool() re-reads env. */
export function resetPostgresPoolForTests(): void {
  const pool = global._postgresPool;
  global._postgresPool = undefined;
  global._postgresPoolLastError = undefined;
  if (pool) {
    void pool.end().catch(() => {
      /* ignore test teardown */
    });
  }
}

export const createPool = (env: NodeJS.ProcessEnv = process.env): Pool => {
  if (!global._postgresPool) {
    const connectionString = databaseUrlFromEnv(env);
    if (!connectionString || isUnsetOrPlaceholder(connectionString)) {
      throw new Error(
        productionLike(env) ? PRODUCTION_POOL_ENV_REQUIRED_MESSAGE : LOCAL_POOL_ENV_REQUIRED_MESSAGE
      );
    }
    global._postgresPoolLastError = undefined;
    global._postgresPool = new Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 15000,
    });
    global._postgresPool.on("error", (err) => {
      global._postgresPoolLastError = err;
      console.error("[Lumera] Unexpected error on idle SQL pool client (not swallowed):", err);
    });
  }
  return global._postgresPool;
};

export function getDrizzle(env: NodeJS.ProcessEnv = process.env) {
  return drizzle(createPool(env), { schema });
}

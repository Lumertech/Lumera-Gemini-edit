import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";
import { databaseUrlFromEnv } from "./url.ts";

declare global {
  var _postgresPool: Pool | undefined;
}

export { databaseUrlFromEnv, cloudSqlUnixSocketUrl } from "./url.ts";
export * from "./schema.ts";

export const createPool = (env: NodeJS.ProcessEnv = process.env): Pool => {
  if (!global._postgresPool) {
    const connectionString = databaseUrlFromEnv(env);
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL (or INSTANCE_CONNECTION_NAME + SQL_USER + SQL_PASSWORD + SQL_DB_NAME) is required to create a Postgres pool."
      );
    }
    global._postgresPool = new Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 15000,
    });
    global._postgresPool.on("error", (err) => {
      console.error("Unexpected error on idle SQL pool client:", err);
    });
  }
  return global._postgresPool;
};

export function getDrizzle(env: NodeJS.ProcessEnv = process.env) {
  return drizzle(createPool(env), { schema });
}

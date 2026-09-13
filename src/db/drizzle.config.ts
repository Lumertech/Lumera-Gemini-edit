import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";
import { databaseUrlFromEnv } from "./url.ts";

dotenv.config();

const url = databaseUrlFromEnv();

/**
 * Generate does not need a live database. migrate/push do — pass DATABASE_URL
 * (Cloud SQL unix socket or local Postgres). Do not throw at config-load so
 * `drizzle-kit generate` works in CI without Cloud SQL.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: url
    ? { url }
    : {
        host: process.env.SQL_HOST || "127.0.0.1",
        port: Number(process.env.SQL_PORT || 5432),
        user: process.env.SQL_ADMIN_USER || process.env.SQL_USER || "postgres",
        password: process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD || "postgres",
        database: process.env.SQL_DB_NAME || "lumera",
        ssl: false,
      },
  verbose: true,
});

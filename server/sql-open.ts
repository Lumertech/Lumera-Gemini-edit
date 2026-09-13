import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { databaseUrlFromEnv } from "../src/db/url.ts";
import { createPgShim } from "./pg-shim.ts";
import { DATABASE_URL_REQUIRED_MESSAGE, isUnsetOrPlaceholder } from "./runtime.ts";
import { sqliteFallbackForbidden, type SqlDatabase } from "./sql-engine.ts";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "lumera.db");

export type SqlEngineKind = "postgres" | "sqlite";

/**
 * Pick postgres (pg-shim) vs sqlite without opening a connection.
 * sqlite is allowed only when DATABASE_URL is unset and sqliteFallbackForbidden() is false.
 */
export function resolveSqlEngineKind(
  env: NodeJS.ProcessEnv = process.env,
  argv1 = process.argv[1]
): SqlEngineKind {
  const url = databaseUrlFromEnv(env);
  if (url && !isUnsetOrPlaceholder(url)) return "postgres";
  if (sqliteFallbackForbidden(env, argv1)) {
    throw new Error(DATABASE_URL_REQUIRED_MESSAGE);
  }
  return "sqlite";
}

/** Open the selected engine. Does not run migrate/seed — initDatabase() does that. */
export function openConfiguredDatabase(
  env: NodeJS.ProcessEnv = process.env,
  argv1 = process.argv[1]
): SqlDatabase {
  const kind = resolveSqlEngineKind(env, argv1);
  if (kind === "postgres") {
    const url = databaseUrlFromEnv(env);
    if (!url || isUnsetOrPlaceholder(url)) {
      throw new Error(DATABASE_URL_REQUIRED_MESSAGE);
    }
    return createPgShim(url);
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const sqlite = new DatabaseSync(DB_PATH);
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  return sqlite;
}

/**
 * Drop-in for `node:sqlite` DatabaseSync used by the Cloud Run bundle.
 *
 * esbuild aliases `node:sqlite` → this file so any leftover
 * `new DatabaseSync(path)` in the bundle still talks to Cloud SQL when
 * DATABASE_URL is set. getDb()/initDatabase() in server/db.ts now select
 * the pg-shim directly (this class is the second line of defense).
 *
 * tsx tests import node:sqlite directly (no alias) and keep using a local
 * file when DATABASE_URL is unset. Production / Cloud Run refuse sqlite.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { databaseUrlFromEnv } from "../src/db/url.ts";
import { moduleAnchorUrl } from "./module-anchor.ts";
import { createPgShim } from "./pg-shim.ts";
import { DATABASE_URL_REQUIRED_MESSAGE, isUnsetOrPlaceholder } from "./runtime.ts";
import { sqliteFallbackForbidden, type SqlDatabase, type SqlStatement } from "./sql-engine.ts";

// import.meta.url is undefined in dist/server.cjs (esbuild CJS). Passing it
// straight through crashes boot with filename Received undefined.
const require = createRequire(moduleAnchorUrl(import.meta.url));
const { DatabaseSync: SqliteDatabase } = require("node:sqlite") as {
  DatabaseSync: new (filename: string) => SqlDatabase;
};

export class DatabaseSync implements SqlDatabase {
  private readonly inner: SqlDatabase;

  constructor(filename: string) {
    const url = databaseUrlFromEnv();
    if (url && !isUnsetOrPlaceholder(url)) {
      this.inner = createPgShim(url);
      return;
    }
    if (sqliteFallbackForbidden()) {
      throw new Error(DATABASE_URL_REQUIRED_MESSAGE);
    }
    fs.mkdirSync(path.dirname(filename) || ".", { recursive: true });
    const sqlite = new SqliteDatabase(filename);
    sqlite.exec("PRAGMA journal_mode = WAL");
    sqlite.exec("PRAGMA foreign_keys = ON");
    this.inner = sqlite;
  }

  prepare(sql: string): SqlStatement {
    return this.inner.prepare(sql);
  }

  exec(sql: string): void {
    this.inner.exec(sql);
  }
}

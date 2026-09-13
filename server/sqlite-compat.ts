/**
 * Drop-in for `node:sqlite` DatabaseSync used by the Cloud Run bundle.
 *
 * esbuild aliases `node:sqlite` → this file so `new DatabaseSync(path)` in
 * server/db.ts talks to Cloud SQL when DATABASE_URL is set. The real sqlite
 * module is loaded via createRequire so the alias cannot recurse.
 *
 * tsx tests import node:sqlite directly (no alias) and keep using a local
 * file. Production fail-fast for a missing DATABASE_URL is in runtime.ts
 * (before listen). This class is the second line of defense: Cloud Run /
 * dist/server.cjs refuse a local sqlite file even if initDatabase is called.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { databaseUrlFromEnv } from "../src/db/url.ts";
import { createPgShim } from "./pg-shim.ts";
import { DATABASE_URL_REQUIRED_MESSAGE } from "./runtime.ts";
import { sqliteFallbackForbidden, type SqlDatabase, type SqlStatement } from "./sql-engine.ts";

const require = createRequire(import.meta.url);
const { DatabaseSync: SqliteDatabase } = require("node:sqlite") as {
  DatabaseSync: new (filename: string) => SqlDatabase;
};

export class DatabaseSync implements SqlDatabase {
  private readonly inner: SqlDatabase;

  constructor(filename: string) {
    const url = databaseUrlFromEnv();
    if (url) {
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

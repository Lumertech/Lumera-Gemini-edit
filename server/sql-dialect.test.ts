import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  convertPlaceholders,
  isSqlitePragma,
  rewriteSqliteIdioms,
  splitSqlStatements,
  toPostgresSql,
} from "./sql-dialect.ts";

const USAGE_WALLET_BOOT_COMMENT =
  "-- usage_wallet_billing_20260913: usage_markup_config (Super-Admin-editable; not a code constant)";

describe("SQLite → Postgres SQL dialect (Epic 0 shim)", () => {
  it("converts ? placeholders to $1,$2 without touching quoted question marks", () => {
    assert.equal(
      convertPlaceholders("SELECT * FROM users WHERE email = ? AND id = ?"),
      "SELECT * FROM users WHERE email = $1 AND id = $2"
    );
    assert.equal(
      convertPlaceholders("SELECT '?' AS q, x FROM t WHERE a = ?"),
      "SELECT '?' AS q, x FROM t WHERE a = $1"
    );
    assert.equal(
      convertPlaceholders("SELECT * FROM t WHERE name LIKE ? OR name = '?'"),
      "SELECT * FROM t WHERE name LIKE $1 OR name = '?'"
    );
  });

  it("rewrites INSERT OR IGNORE / INSERT OR REPLACE", () => {
    const ignore = rewriteSqliteIdioms(
      "INSERT OR IGNORE INTO subscriptions (id, user_id, status) VALUES (?, ?, ?)"
    );
    assert.match(ignore, /^INSERT INTO subscriptions/i);
    assert.match(ignore, /ON CONFLICT DO NOTHING/i);
    assert.equal(ignore.includes("OR IGNORE"), false);

    const replace = rewriteSqliteIdioms(
      "INSERT OR REPLACE INTO doctors (id, user_id, name) VALUES (?, ?, ?)"
    );
    assert.match(replace, /^INSERT INTO doctors/i);
    assert.match(replace, /ON CONFLICT \(id\) DO UPDATE SET user_id = EXCLUDED.user_id, name = EXCLUDED.name/i);
  });

  it("normalizes ON CONFLICT(code) spacing for Postgres", () => {
    const sql = rewriteSqliteIdioms(
      `INSERT INTO plans (code, display_name) VALUES (?, ?)
       ON CONFLICT(code) DO UPDATE SET display_name = excluded.display_name`
    );
    assert.match(sql, /ON CONFLICT \(code\)/);
  });

  it("toPostgresSql combines rewrite + placeholders", () => {
    assert.equal(
      toPostgresSql("SELECT * FROM tenants WHERE id = ?"),
      "SELECT * FROM tenants WHERE id = $1"
    );
    const upsert = toPostgresSql(
      "INSERT OR REPLACE INTO users (id, email) VALUES (?, ?)"
    );
    assert.match(upsert, /\$1/);
    assert.match(upsert, /\$2/);
    assert.match(upsert, /ON CONFLICT \(id\)/);
  });

  it("splits multi-statement exec SQL and skips PRAGMA", () => {
    const parts = splitSqlStatements(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS t (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS u (id TEXT PRIMARY KEY);
    `);
    assert.equal(parts.length, 3);
    assert.equal(isSqlitePragma(parts[0]), true);
    assert.equal(isSqlitePragma(parts[1]), false);
  });

  it("does not split semicolons inside quotes", () => {
    const parts = splitSqlStatements(`INSERT INTO t (note) VALUES ('a; not b'); SELECT 1`);
    assert.equal(parts.length, 2);
    assert.match(parts[0], /'a; not b'/);
  });

  it("keeps semicolons inside -- and block comments with the following statement", () => {
    const line = splitSqlStatements(`
      ${USAGE_WALLET_BOOT_COMMENT}
      CREATE TABLE IF NOT EXISTS usage_markup_config (id TEXT PRIMARY KEY);
    `);
    assert.equal(line.length, 1);
    assert.match(line[0], /CREATE TABLE IF NOT EXISTS usage_markup_config/);
    assert.match(line[0], /Super-Admin-editable; not a code constant/);
    assert.equal(/^\s*not\b/i.test(toPostgresSql(line[0])), false);

    const block = splitSqlStatements(`/* keep; not split */ CREATE TABLE t (id INT);`);
    assert.equal(block.length, 1);
    assert.match(block[0], /CREATE TABLE t/);
    assert.equal(/^\s*not\b/i.test(block[0]), false);
  });

  it("translates the usage-wallet boot DDL without a statement starting at not", () => {
    const src = fs.readFileSync(new URL("./usage-wallet.ts", import.meta.url), "utf8");
    assert.match(src, /Super-Admin-editable; not a code constant/);
    const match = src.match(/export function ensureUsageWalletSchema[\s\S]*?database\.exec\(`([\s\S]*?)`\);/);
    assert.ok(match, "ensureUsageWalletSchema exec SQL");
    const parts = splitSqlStatements(match[1]);
    assert.equal(parts.length, 7);
    const markup = parts.find((part) => /CREATE TABLE IF NOT EXISTS usage_markup_config/i.test(part));
    assert.ok(markup, parts.join("\n---\n"));
    assert.match(markup, /not a code constant/);
    for (const part of parts) {
      const translated = toPostgresSql(part);
      assert.equal(/^\s*not\b/i.test(translated), false, translated);
      assert.equal(/\bINSERT\s+OR\s+(IGNORE|REPLACE)\b/i.test(translated), false, translated);
      assert.match(translated, /\b(CREATE|ALTER|INSERT|UPDATE|DELETE|SELECT|WITH|DROP)\b/i);
    }
  });

});

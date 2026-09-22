import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "node:test";
import { isSqlitePragma, toPostgresSql } from "./sql-dialect.ts";
import type { SqlDatabase } from "./sql-engine.ts";
import {
  applyTenantPhoneSecurityMigrations,
  migratePatientsPhoneUnique,
} from "./migrate-patients-phone.ts";
import { resolveSqlEngineKind } from "./sql-open.ts";

type Script = {
  match: RegExp;
  get?: unknown;
  all?: unknown[];
};

function scriptedDatabase(scripts: Script[], options?: { rejectSqliteCatalog?: boolean }) {
  const sqls: string[] = [];
  const db: SqlDatabase = {
    prepare(sql: string) {
      sqls.push(sql);
      if (options?.rejectSqliteCatalog && /sqlite_master|\bPRAGMA\b/i.test(sql)) {
        const err = new Error('relation "sqlite_master" does not exist') as Error & { code?: string };
        err.code = "42P01";
        throw err;
      }
      const hit = scripts.find((s) => s.match.test(sql));
      return {
        run() {
          return { changes: 0, lastInsertRowid: 0 };
        },
        get() {
          return hit?.get;
        },
        all() {
          return hit?.all ?? [];
        },
      };
    },
    exec(sql: string) {
      sqls.push(sql);
      if (options?.rejectSqliteCatalog && /sqlite_master|\bPRAGMA\b/i.test(sql)) {
        const err = new Error('relation "sqlite_master" does not exist') as Error & { code?: string };
        err.code = "42P01";
        throw err;
      }
    },
  };
  return { db, sqls };
}

function assertPostgresSafe(sqls: string[]) {
  for (const sql of sqls) {
    assert.equal(/sqlite_master/i.test(sql), false, sql);
    assert.equal(isSqlitePragma(sql), false, sql);
    const translated = toPostgresSql(sql);
    assert.equal(/sqlite_master/i.test(translated), false, translated);
    assert.equal(isSqlitePragma(translated), false, translated);
  }
}

describe("tenant phone security migrations (Postgres vs sqlite)", () => {
  const envSnapshot = {
    DATABASE_URL: process.env.DATABASE_URL,
    INSTANCE_CONNECTION_NAME: process.env.INSTANCE_CONNECTION_NAME,
    CLOUD_SQL_CONNECTION_NAME: process.env.CLOUD_SQL_CONNECTION_NAME,
    SQL_USER: process.env.SQL_USER,
    SQL_PASSWORD: process.env.SQL_PASSWORD,
    SQL_DB_NAME: process.env.SQL_DB_NAME,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("does not touch sqlite_master when dropping a Postgres phone unique constraint", () => {
    const { db, sqls } = scriptedDatabase(
      [
        { match: /information_schema\.tables/i, get: { name: "patients" } },
        { match: /pg_constraint/i, all: [{ name: "patients_phone_key" }] },
        { match: /pg_index/i, all: [] },
      ],
      { rejectSqliteCatalog: true }
    );

    migratePatientsPhoneUnique(db, "postgres");

    assertPostgresSafe(sqls);
    assert.ok(sqls.some((s) => /information_schema\.tables/i.test(s)));
    assert.ok(sqls.some((s) => /ALTER TABLE patients DROP CONSTRAINT IF EXISTS "patients_phone_key"/i.test(s)));
    assert.ok(
      sqls.some((s) => /CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_tenant_phone ON patients\(tenant_id, phone\)/i.test(s))
    );
  });

  it("drops a phone-only unique index and quotes odd catalog names", () => {
    const { db, sqls } = scriptedDatabase(
      [
        { match: /information_schema\.tables/i, get: { name: "patients" } },
        { match: /pg_constraint/i, all: [] },
        { match: /pg_index/i, all: [{ name: 'phone"idx' }] },
      ],
      { rejectSqliteCatalog: true }
    );

    migratePatientsPhoneUnique(db, "postgres");

    assertPostgresSafe(sqls);
    assert.ok(sqls.some((s) => /DROP INDEX IF EXISTS "phone""idx"/i.test(s)));
    assert.equal(sqls.some((s) => /DROP CONSTRAINT/i.test(s)), false);
  });

  it("falls back to DROP CONSTRAINT when Postgres refuses to drop a constraint-backed index", () => {
    const { db, sqls } = scriptedDatabase(
      [
        { match: /information_schema\.tables/i, get: { name: "patients" } },
        { match: /pg_constraint/i, all: [] },
        { match: /pg_index/i, all: [{ name: "patients_phone_key" }] },
      ],
      { rejectSqliteCatalog: true }
    );
    const originalExec = db.exec.bind(db);
    db.exec = (sql: string) => {
      if (/^DROP INDEX/i.test(sql)) {
        sqls.push(sql);
        throw new Error(
          "cannot drop index patients_phone_key because constraint patients_phone_key on table patients requires it"
        );
      }
      originalExec(sql);
    };

    migratePatientsPhoneUnique(db, "postgres");

    assertPostgresSafe(sqls);
    assert.ok(sqls.some((s) => /DROP INDEX IF EXISTS "patients_phone_key"/i.test(s)));
    assert.ok(sqls.some((s) => /ALTER TABLE patients DROP CONSTRAINT IF EXISTS "patients_phone_key"/i.test(s)));
  });

  it("is a no-op when the patients table is absent on Postgres", () => {
    const { db, sqls } = scriptedDatabase([{ match: /information_schema\.tables/i, get: undefined }], {
      rejectSqliteCatalog: true,
    });

    migratePatientsPhoneUnique(db, "postgres");

    assertPostgresSafe(sqls);
    assert.equal(sqls.length, 1);
    assert.equal(sqls.some((s) => /DROP |CREATE UNIQUE INDEX/i.test(s)), false);
  });

  it("uses pg_catalog when DATABASE_URL selects the postgres engine", () => {
    process.env.DATABASE_URL = "postgres://lumera:lumera@/lumera?host=/cloudsql/gen-lang-client-0108182367:asia-south1:lumera-pg";
    assert.equal(resolveSqlEngineKind(), "postgres");

    const { db, sqls } = scriptedDatabase(
      [
        { match: /information_schema\.tables/i, get: { name: "patients" } },
        { match: /pg_constraint/i, all: [{ name: "patients_phone_key" }] },
        { match: /pg_index/i, all: [] },
      ],
      { rejectSqliteCatalog: true }
    );

    applyTenantPhoneSecurityMigrations(db);

    assertPostgresSafe(sqls);
    assert.ok(sqls.some((s) => /pg_constraint/i.test(s)));
    assert.equal(sqls.some((s) => /sqlite_master/i.test(s)), false);
  });

  it("keeps the sqlite catalog lookup when the engine is sqlite", () => {
    const { db, sqls } = scriptedDatabase([{ match: /sqlite_master/i, get: undefined }]);

    migratePatientsPhoneUnique(db, "sqlite");

    assert.equal(sqls.length, 1);
    assert.match(sqls[0], /sqlite_master/);
    assert.equal(sqls.some((s) => /information_schema|pg_constraint|pg_index/i.test(s)), false);
  });

  it("rebuilds a sqlite patients table that still has UNIQUE(phone)", () => {
    const file = path.join(os.tmpdir(), `lumera-phone-${process.pid}-${Date.now()}.db`);
    const db = new DatabaseSync(file);
    try {
      db.exec(`
        CREATE TABLE patients (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL DEFAULT '',
          uhid TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          phone TEXT NOT NULL UNIQUE
        )
      `);
      db.prepare("INSERT INTO patients (id, tenant_id, uhid, name, phone) VALUES (?, ?, ?, ?, ?)").run(
        "p1",
        "tenant-a",
        "u1",
        "Asha",
        "999"
      );

      migratePatientsPhoneUnique(db, "sqlite");

      const indexes = db.prepare("PRAGMA index_list(patients)").all() as Array<{ name: string; unique: number }>;
      const uniqueNames = indexes.filter((i) => i.unique).map((i) => i.name);
      assert.ok(uniqueNames.includes("idx_patients_tenant_phone"));
      for (const name of uniqueNames) {
        const info = db.prepare(`PRAGMA index_info("${name.replace(/"/g, "\"\"")}")`).all() as Array<{ name: string }>;
        const cols = info.map((c) => c.name);
        assert.equal(cols.length === 1 && cols[0] === "phone", false, name);
      }

      db.prepare("INSERT INTO patients (id, tenant_id, uhid, name, phone) VALUES (?, ?, ?, ?, ?)").run(
        "p2",
        "tenant-b",
        "u2",
        "Bina",
        "999"
      );
      assert.throws(() => {
        db.prepare("INSERT INTO patients (id, tenant_id, uhid, name, phone) VALUES (?, ?, ?, ?, ?)").run(
          "p3",
          "tenant-a",
          "u3",
          "Cara",
          "999"
        );
      });
    } finally {
      db.close();
      fs.rmSync(file, { force: true });
    }
  });
});

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";
import { AMBIENT_WALKIN_DUP_SOURCE, AMBIENT_WALKIN_SOURCE } from "./ambient-walkin.ts";
import { closePgShim, createPgShim } from "./pg-shim.ts";
import { allocateTokenNumber, ensureAppointmentTokenIndex } from "./queue-tokens.ts";
import type { SqlDatabase } from "./sql-engine.ts";

const CI_SERVICE_DATABASE = "lumera_sunrise_test";
const TOKEN_INDEX = "idx_appointments_tenant_queue_doctor_token";

const APPOINTMENTS_DDL = `
  CREATE TABLE appointments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT '',
    token_number INTEGER NOT NULL,
    patient_id TEXT NOT NULL,
    patient_name TEXT NOT NULL,
    patient_phone TEXT NOT NULL,
    uhid TEXT NOT NULL,
    doctor_id TEXT NOT NULL,
    doctor_name TEXT NOT NULL,
    specialty TEXT NOT NULL,
    date TEXT NOT NULL,
    time_slot TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'New Consultation',
    status TEXT NOT NULL DEFAULT 'Waiting',
    source TEXT NOT NULL DEFAULT 'Walk-in',
    consultation_fee INTEGER NOT NULL DEFAULT 0,
    is_paid INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )
`;

function postgresUrl(): string | null {
  const sunrise = String(process.env.SUNRISE_TEST_DATABASE_URL || "").trim();
  if (sunrise) return sunrise;
  const fromEnv = String(process.env.SPREAD_TEST_DATABASE_URL || "").trim();
  if (fromEnv) return fromEnv;
  if (fs.existsSync("/var/run/postgresql/.s.PGSQL.5432")) {
    return "postgres://ubuntu@/lumera_spread_test?host=/var/run/postgresql";
  }
  return null;
}

function postgresDatabaseName(url: string): string {
  const trimmed = String(url || "").trim();
  if (!/^postgres(ql)?:\/\//i.test(trimmed)) return "";
  try {
    const parsed = new URL(trimmed.replace(/^postgres(ql)?:\/\//i, "http://"));
    return decodeURIComponent(parsed.pathname.replace(/^\//, "").split("/")[0] || "");
  } catch {
    return "";
  }
}

function assertScratchDatabaseAllowed(url: string, env: NodeJS.ProcessEnv = process.env): void {
  if (String(env.NODE_ENV || "") === "production") {
    throw new Error("Partial token index test refuses to run when NODE_ENV is production");
  }
  const name = postgresDatabaseName(url);
  if (!name.endsWith("_test") && name !== CI_SERVICE_DATABASE) {
    throw new Error(`Partial token index test refuses database ${name || "(empty)"}; the name must end in _test`);
  }
  const appUrl = String(env.DATABASE_URL || "").trim();
  if (!appUrl) return;
  if (appUrl === url.trim()) {
    throw new Error("Partial token index test refuses to run against DATABASE_URL");
  }
  const appName = postgresDatabaseName(appUrl);
  if (appName && appName === name) {
    throw new Error("Partial token index test refuses to run against DATABASE_URL");
  }
}

function withSearchPath(url: string, schema: string): string {
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
}

function countRows(db: SqlDatabase, sql: string): number {
  const row = db.prepare(sql).get() as { n?: number | string } | undefined;
  return Number(row?.n || 0);
}

function tokenIndexSql(db: SqlDatabase): string {
  if (db.dialect === "postgres") {
    const row = db
      .prepare(
        `SELECT pg_get_indexdef(c.oid) AS sql
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind = 'i' AND c.relname = ? AND n.nspname = current_schema()`
      )
      .get(TOKEN_INDEX) as { sql?: string } | undefined;
    return String(row?.sql || "");
  }
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`)
    .get(TOKEN_INDEX) as { sql?: string } | undefined;
  return String(row?.sql || "");
}

function insertVisit(db: SqlDatabase, id: string, token: number, source: string): void {
  db.prepare(
    `INSERT INTO appointments (
       id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid,
       doctor_id, doctor_name, specialty, date, time_slot, type, status, source,
       consultation_fee, is_paid, created_at
     ) VALUES (?, 'tenant-idx', ?, 'pat-1', 'QA', '+910000000000', 'UHID',
       'doc-1', 'Dr Index', 'General Medicine', '2026-10-19', '10:00', 'New Consultation', 'Waiting', ?,
       0, 0, '2026-10-19T00:00:00.000Z')`
  ).run(id, token, source);
}

function idsOf(db: SqlDatabase): string[] {
  return (db.prepare(`SELECT id FROM appointments ORDER BY id`).all() as Array<{ id: string }>).map((row) =>
    String(row.id)
  );
}

function assertPartial(sql: string): void {
  assert.match(sql, /where/i);
  assert.match(sql, /ambient_walkin/);
  assert.match(sql, /ambient_walkin_dup/);
}

/** Two hidden token-0 rows and one visible row, then a full index rewritten as partial. */
function exercisePartialTokenIndex(db: SqlDatabase): void {
  db.exec(APPOINTMENTS_DDL);
  insertVisit(db, "hidden-a", 0, AMBIENT_WALKIN_SOURCE);
  insertVisit(db, "hidden-b", 0, AMBIENT_WALKIN_DUP_SOURCE);
  insertVisit(db, "visible-a", 1, "Walk-in");
  const before = idsOf(db);
  const created = ensureAppointmentTokenIndex(db);
  assert.equal(created.created, true);
  assert.deepEqual(created.duplicates, []);
  assert.deepEqual(idsOf(db), before);
  assert.equal(countRows(db, `SELECT COUNT(*) AS n FROM appointments WHERE token_number = 0`), 2);
  assert.equal(countRows(db, `SELECT COUNT(*) AS n FROM appointments WHERE source = 'Walk-in'`), 1);
  assertPartial(tokenIndexSql(db));

  insertVisit(db, "hidden-high", 40, AMBIENT_WALKIN_DUP_SOURCE);
  assert.equal(allocateTokenNumber(db, "tenant-idx", "2026-10-19", "doc-1"), 2);
  assert.throws(() => insertVisit(db, "visible-b", 1, "Walk-in"), /unique|duplicate key/i);
  assert.equal(countRows(db, `SELECT COUNT(*) AS n FROM appointments WHERE id = 'visible-a'`), 1);

  db.exec("DROP TABLE IF EXISTS appointments");
  db.exec(APPOINTMENTS_DDL);
  db.exec(
    `CREATE UNIQUE INDEX ${TOKEN_INDEX} ON appointments(tenant_id, date, doctor_id, token_number)`
  );
  insertVisit(db, "hidden-a", 0, AMBIENT_WALKIN_SOURCE);
  insertVisit(db, "visible-a", 1, "Walk-in");
  const fullSql = tokenIndexSql(db);
  assert.equal(fullSql.length > 0, true);
  assert.doesNotMatch(fullSql, /ambient_walkin/);
  const upgraded = ensureAppointmentTokenIndex(db);
  assert.equal(upgraded.created, true);
  assert.deepEqual(upgraded.duplicates, []);
  assertPartial(tokenIndexSql(db));
  assert.deepEqual(idsOf(db), ["hidden-a", "visible-a"]);
  insertVisit(db, "hidden-b", 0, AMBIENT_WALKIN_DUP_SOURCE);
  assert.equal(countRows(db, `SELECT COUNT(*) AS n FROM appointments WHERE token_number = 0`), 2);
  assert.throws(() => insertVisit(db, "visible-b", 1, "Walk-in"), /unique|duplicate key/i);
  assert.deepEqual(idsOf(db), ["hidden-a", "hidden-b", "visible-a"]);
}

describe("partial appointment token index", () => {
  it("keeps two hidden token-0 rows and upgrades a full index on sqlite", () => {
    const db = new DatabaseSync(":memory:");
    exercisePartialTokenIndex(db);
    db.close();
  });

  it("keeps two hidden token-0 rows and upgrades a full index on postgres", { timeout: 120_000 }, async () => {
    const url = postgresUrl();
    if (!url) {
      if (process.env.CI) {
        throw new Error("SUNRISE_TEST_DATABASE_URL is required so CI can run the partial token index test on Postgres");
      }
      return;
    }
    assertScratchDatabaseAllowed(url);
    const schema = `tokidx_${crypto.randomBytes(8).toString("hex")}`;
    assert.match(schema, /^tokidx_[0-9a-f]+$/);
    const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 8000 });
    let shimOpen = false;
    try {
      await pool.query(`CREATE SCHEMA ${schema}`);
      closePgShim();
      shimOpen = true;
      const db = createPgShim(withSearchPath(url, schema));
      const placed = db.prepare(`SELECT current_schema() AS schema`).get() as { schema?: string };
      assert.equal(String(placed?.schema || ""), schema);
      exercisePartialTokenIndex(db);
      const located = await pool.query(
        `SELECT n.nspname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relname = 'appointments' AND n.nspname = $1`,
        [schema]
      );
      assert.equal(located.rowCount, 1);
    } finally {
      if (shimOpen) closePgShim();
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      const dropped = await pool.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [schema]);
      const publicSchema = await pool.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'public'`);
      await pool.end();
      assert.equal(dropped.rowCount, 0);
      assert.equal(publicSchema.rowCount, 1);
    }
  });
});

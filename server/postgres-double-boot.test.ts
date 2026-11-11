import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { Pool } from "pg";

/**
 * Cloud Run boots initDatabase on every instance. Revisions 00092 and 00093
 * died on Postgres: sqlite_master inside hasTable, then a second boot (or a
 * month roll) reinserted dhis-init-tx primary keys. This test uses a real
 * Postgres, not the shim's unit doubles.
 */
function postgresTestUrl(): string | null {
  const fromEnv = String(process.env.SUNRISE_TEST_DATABASE_URL || "").trim();
  if (fromEnv) return fromEnv;
  if (fs.existsSync("/var/run/postgresql/.s.PGSQL.5432")) {
    return "postgres://lumera:ci-only-db@127.0.0.1:5432/lumera_sunrise_test";
  }
  return null;
}

function bootOnce(url: string): { status: number | null; stdout: string; stderr: string } {
  const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const script = path.join(process.cwd(), "server", "postgres-boot-once.ts");
  const result = spawnSync(process.execPath, [tsx, script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: url,
      NODE_ENV: "test",
      JWT_SECRET: process.env.JWT_SECRET || "test-jwt-secret",
    },
    encoding: "utf8",
    timeout: 150_000,
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: `${result.stderr || ""}${result.error ? `\n${result.error.message}` : ""}`,
  };
}

describe("initDatabase on real Postgres", () => {
  it("completes two boots, including a DHIS reseed that reuses primary keys", { timeout: 180_000 }, async () => {
    const url = postgresTestUrl();
    if (!url) {
      if (process.env.GITHUB_ACTIONS === "true") {
        throw new Error("SUNRISE_TEST_DATABASE_URL is required so CI can boot initDatabase on Postgres");
      }
      return;
    }

    const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 8000 });
    try {
      await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
      await pool.query("CREATE SCHEMA public");
    } finally {
      await pool.end();
    }

    const first = bootOnce(url);
    assert.equal(first.status, 0, `first boot failed\nstdout:\n${first.stdout}\nstderr:\n${first.stderr}`);
    assert.match(first.stdout, /postgres boot ok/);
    assert.doesNotMatch(first.stderr, /sqlite_master/i);
    assert.doesNotMatch(first.stderr, /duplicate key/i);
    assert.doesNotMatch(first.stderr, /Error seeding DHIS/i);

    const shift = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 8000 });
    try {
      // Same ids, different month: the count gate looks only at the current
      // month, which is how a later boot hits dhis_transactions_pkey.
      const moved = await shift.query(
        "UPDATE dhis_transactions SET month_year = '1999-01' WHERE id LIKE 'dhis-init-tx-%'"
      );
      assert.ok((moved.rowCount ?? 0) >= 10, `expected seeded DHIS rows, updated ${moved.rowCount}`);
    } finally {
      await shift.end();
    }

    const second = bootOnce(url);
    assert.equal(second.status, 0, `second boot failed\nstdout:\n${second.stdout}\nstderr:\n${second.stderr}`);
    assert.match(second.stdout, /postgres boot ok/);
    assert.doesNotMatch(second.stderr, /sqlite_master/i);
    assert.doesNotMatch(second.stderr, /duplicate key/i);
    assert.doesNotMatch(second.stderr, /Error seeding DHIS/i);

    const check = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 8000 });
    try {
      const ids = await check.query(
        "SELECT COUNT(*)::int AS c FROM dhis_transactions WHERE id LIKE 'dhis-init-tx-%'"
      );
      // ON CONFLICT DO NOTHING keeps the original primary keys. A reseed must not
      // insert a second copy and must not abort the boot.
      assert.equal(ids.rows[0].c, 78);
      const tables = [
        "clinic_vendors",
        "inventory_items",
        "vendor_price_locks",
        "stock_batches",
        "stock_movements",
        "vaccine_administrations",
        "clinic_expenses",
        "invoice_refunds",
        "day_closes",
        "accounts_settings",
      ];
      for (const name of tables) {
        const found = await check.query("SELECT to_regclass($1) AS name", [`public.${name}`]);
        assert.equal(found.rows[0].name, name, `${name} missing after the second boot`);
      }
      const receiptColumns = await check.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'clinic_expenses'
           AND column_name IN ('storage_key', 'storage_backend')
         ORDER BY column_name`
      );
      assert.deepEqual(
        receiptColumns.rows.map((row: { column_name: string }) => row.column_name),
        ["storage_backend", "storage_key"]
      );
    } finally {
      await check.end();
    }
  });
});

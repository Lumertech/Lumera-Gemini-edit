import assert from "node:assert/strict";
import { DataType, newDb } from "pg-mem";
import { describe, it } from "node:test";
import type { DatabaseSync } from "node:sqlite";
import {
  WHATSAPP_WINDOW_CLOSED_ERROR,
  dispatchWhatsAppCloudMessage,
} from "./graph-whatsapp.ts";
import type { SqlDatabase } from "./sql-engine.ts";
import { isSqlitePragma, splitSqlStatements, toPostgresSql } from "./sql-dialect.ts";

/**
 * In-memory Postgres (pg-mem) speaking the same SQL the pg-shim sends.
 * PRAGMA is a hard error, matching Cloud SQL.
 */
function openPostgresAdapter(): SqlDatabase & { sqls: string[] } {
  const mem = newDb();
  mem.public.registerFunction({
    name: "trim",
    args: [DataType.text],
    returns: DataType.text,
    allowNullArguments: true,
    implementation: (value: unknown) => String(value ?? "").trim(),
  });
  mem.public.registerFunction({
    name: "replace",
    args: [DataType.text, DataType.text, DataType.text],
    returns: DataType.text,
    allowNullArguments: true,
    implementation: (value: unknown, from: unknown, to: unknown) =>
      String(value ?? "").split(String(from ?? "")).join(String(to ?? "")),
  });
  const sqls: string[] = [];

  function bind(sql: string, params: unknown[]): string {
    return sql.replace(/\$(\d+)/g, (_, index) => {
      const value = params[Number(index) - 1];
      if (value == null) return "NULL";
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      return `'${String(value).replace(/'/g, "''")}'`;
    });
  }

  function runSql(sql: string, params: unknown[] = []): unknown[] {
    if (isSqlitePragma(sql)) {
      const err = new Error('syntax error at or near "PRAGMA"') as Error & { code?: string };
      err.code = "42601";
      throw err;
    }
    const pgSql = bind(toPostgresSql(sql), params);
    sqls.push(pgSql);
    if (/^\s*(insert|update|delete|create|alter|drop)\b/i.test(pgSql)) {
      mem.public.none(pgSql);
      return [];
    }
    return mem.public.many(pgSql);
  }

  const db: SqlDatabase & { sqls: string[] } = {
    dialect: "postgres",
    sqls,
    exec(sql: string) {
      for (const statement of splitSqlStatements(sql)) runSql(statement);
    },
    prepare(sql: string) {
      return {
        run(...params: unknown[]) {
          runSql(sql, params);
          return { changes: 1, lastInsertRowid: 0 };
        },
        get(...params: unknown[]) {
          return runSql(sql, params)[0];
        },
        all(...params: unknown[]) {
          return runSql(sql, params);
        },
      };
    },
  };
  return db;
}

describe("24h service window on the Postgres adapter", () => {
  it("allows a lapsed clinic manual reply at 23h and rejects it at 25h", async () => {
    const db = openPostgresAdapter();
    db.exec(`
      CREATE TABLE tenants (
        id text PRIMARY KEY,
        active_status integer,
        lifecycle_status text,
        deleted_at text
      );
      CREATE TABLE tenant_subscriptions (
        tenant_id text,
        status text,
        ends_at text,
        billing_source text
      );
      CREATE TABLE whatsapp_conversations (
        id text PRIMARY KEY,
        patient_phone text NOT NULL,
        tenant_id text NOT NULL,
        last_inbound_at text
      );
    `);
    const tenantId = "tenant-pg-window";
    const hour = 60 * 60 * 1000;
    const phone23 = "+91 98123 45023";
    const phone25 = "+91 98123 45025";
    db.prepare(
      "INSERT INTO tenants (id, active_status, lifecycle_status, deleted_at) VALUES (?, 1, 'active', NULL)"
    ).run(tenantId);
    db.prepare(
      "INSERT INTO tenant_subscriptions (tenant_id, status, ends_at, billing_source) VALUES (?, 'past_due', NULL, 'manual')"
    ).run(tenantId);
    db.prepare(
      "INSERT INTO whatsapp_conversations (id, patient_phone, tenant_id, last_inbound_at) VALUES (?, ?, ?, ?)"
    ).run("conv-23", phone23, tenantId, new Date(Date.now() - 23 * hour).toISOString());
    db.prepare(
      "INSERT INTO whatsapp_conversations (id, patient_phone, tenant_id, last_inbound_at) VALUES (?, ?, ?, ?)"
    ).run("conv-25", phone25, tenantId, new Date(Date.now() - 25 * hour).toISOString());

    const postgres = db as unknown as DatabaseSync;
    const at23h = await dispatchWhatsAppCloudMessage({
      to: phone23.replace(/\D/g, ""),
      kind: "text",
      textBody: "manual reply at 23h",
      db: postgres,
      tenantId,
      isManual: true,
    });
    assert.equal(at23h.ok, true);
    if (at23h.ok) assert.equal(at23h.channel, "sandbox");

    const at25h = await dispatchWhatsAppCloudMessage({
      to: phone25.replace(/\D/g, ""),
      kind: "text",
      textBody: "manual reply at 25h",
      db: postgres,
      tenantId,
      isManual: true,
    });
    assert.equal(at25h.ok, false);
    if (!at25h.ok) {
      assert.equal(at25h.status, 403);
      assert.equal(at25h.error, WHATSAPP_WINDOW_CLOSED_ERROR);
    }
    assert.equal(db.sqls.some((sql) => /\bPRAGMA\b/i.test(sql)), false);
    assert.equal(db.sqls.some((sql) => /last_inbound_at/i.test(sql)), true);
  });
});

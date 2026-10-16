import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { migrate } from "./db-migrate.ts";
import { migratePrescriptionDraftKey } from "./migrate-prescription-drafts.ts";
import type { SqlDatabase } from "./sql-engine.ts";

function tempSqlite(): { db: DatabaseSync; close: () => void } {
  const file = path.join(os.tmpdir(), `lumera-draft-pk-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const db = new DatabaseSync(file);
  return {
    db,
    close: () => {
      db.close();
      fs.rmSync(file, { force: true });
    },
  };
}

function pkColumns(db: DatabaseSync): string[] {
  const columns = db.prepare("PRAGMA table_info(prescription_drafts)").all() as Array<{ name: string; pk: number }>;
  return columns
    .filter((column) => Number(column.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((column) => column.name);
}

describe("prescription draft primary key", () => {
  it("rebuilds a patient-only sqlite key and is idempotent", () => {
    const { db, close } = tempSqlite();
    try {
      db.exec(`
        CREATE TABLE prescription_drafts (
          patient_id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          doctor_id TEXT NOT NULL,
          draft_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      db.prepare(
        `INSERT INTO prescription_drafts (patient_id, tenant_id, doctor_id, draft_json, updated_at)
         VALUES ('pat-1', 'tenant-a', 'doc-1', '{"diagnosis":"A"}', '2026-10-16T00:00:00.000Z')`
      ).run();
      migratePrescriptionDraftKey(db);
      assert.deepEqual(pkColumns(db), ["tenant_id", "patient_id", "appointment_id"]);
      const row = db
        .prepare("SELECT tenant_id, patient_id, appointment_id, draft_json FROM prescription_drafts WHERE patient_id = ?")
        .get("pat-1") as { tenant_id: string; appointment_id: string; draft_json: string };
      assert.equal(row.tenant_id, "tenant-a");
      assert.equal(row.appointment_id, "");
      assert.equal(row.draft_json.includes("A"), true);
      db.prepare(
        `INSERT INTO prescription_drafts (tenant_id, patient_id, appointment_id, doctor_id, draft_json, updated_at)
         VALUES ('tenant-a', 'pat-1', 'apt-2', 'doc-2', '{"diagnosis":"B"}', '2026-10-16T01:00:00.000Z')`
      ).run();
      migratePrescriptionDraftKey(db);
      const count = db.prepare("SELECT COUNT(*) AS c FROM prescription_drafts").get() as { c: number };
      assert.equal(Number(count.c), 2);
      assert.deepEqual(pkColumns(db), ["tenant_id", "patient_id", "appointment_id"]);
    } finally {
      close();
    }
  });

  it("keeps the composite key across two full sqlite boots", () => {
    const { db, close } = tempSqlite();
    try {
      migrate(db);
      migrate(db);
      assert.deepEqual(pkColumns(db), ["tenant_id", "patient_id", "appointment_id"]);
    } finally {
      close();
    }
  });

  it("upgrades Postgres without sqlite_master and skips a key that is already composite", () => {
    const sqls: string[] = [];
    const legacy: SqlDatabase = {
      dialect: "postgres",
      prepare(sql: string) {
        sqls.push(sql);
        return {
          run: () => ({ changes: 0, lastInsertRowid: 0 }),
          get: () => {
            if (/information_schema\.tables/i.test(sql)) return { name: "prescription_drafts" };
            if (/column_name = 'appointment_id'/i.test(sql)) return undefined;
            return undefined;
          },
          all: () => {
            if (/indisprimary/i.test(sql)) return [{ name: "patient_id" }];
            if (/contype = 'p'/i.test(sql)) return [{ name: "prescription_drafts_pkey" }];
            return [];
          },
        };
      },
      exec(sql: string) {
        sqls.push(sql);
      },
    };
    migratePrescriptionDraftKey(legacy);
    assert.equal(sqls.some((sql) => /sqlite_master|\bPRAGMA\b/i.test(sql)), false);
    assert.ok(sqls.some((sql) => /ADD COLUMN appointment_id/i.test(sql)));
    assert.ok(sqls.some((sql) => /DROP CONSTRAINT "prescription_drafts_pkey"/i.test(sql)));
    assert.ok(sqls.some((sql) => /ADD PRIMARY KEY \(tenant_id, patient_id, appointment_id\)/i.test(sql)));

    const again: string[] = [];
    const current: SqlDatabase = {
      dialect: "postgres",
      prepare(sql: string) {
        again.push(sql);
        return {
          run: () => ({ changes: 0, lastInsertRowid: 0 }),
          get: () => ({ name: "prescription_drafts" }),
          all: () =>
            /indisprimary/i.test(sql)
              ? [{ name: "tenant_id" }, { name: "patient_id" }, { name: "appointment_id" }]
              : [],
        };
      },
      exec(sql: string) {
        again.push(sql);
      },
    };
    migratePrescriptionDraftKey(current);
    assert.equal(again.some((sql) => /sqlite_master|\bPRAGMA\b|DROP CONSTRAINT|ADD PRIMARY KEY|ADD COLUMN/i.test(sql)), false);
  });
});

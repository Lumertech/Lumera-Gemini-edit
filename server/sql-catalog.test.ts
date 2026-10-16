import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import type { SqlDatabase } from "./sql-engine.ts";
import { tableExists } from "./sql-catalog.ts";

describe("tableExists", () => {
  it("uses sqlite_master on sqlite and ignores missing tables", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE patients (id TEXT PRIMARY KEY)");
    assert.equal(tableExists(db, "patients"), true);
    assert.equal(tableExists(db, "no_such_table"), false);
  });

  it("uses to_regclass on Postgres and never sqlite_master", () => {
    const sqls: string[] = [];
    const database = {
      dialect: "postgres" as const,
      prepare(sql: string) {
        sqls.push(sql);
        return {
          run() {
            return { changes: 0, lastInsertRowid: 0 };
          },
          get(name: unknown) {
            return { ok: name === "patients" };
          },
          all() {
            return [];
          },
        };
      },
      exec() {},
    } satisfies SqlDatabase;
    assert.equal(tableExists(database, "patients"), true);
    assert.equal(tableExists(database, "missing"), false);
    assert.equal(sqls.some((sql) => /sqlite_master|\bPRAGMA\b/i.test(sql)), false);
    assert.match(sqls[0], /to_regclass/i);
  });
});

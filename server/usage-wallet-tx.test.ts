import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SqlDatabase } from "./sql-engine.ts";
import { withSqliteTransaction } from "./usage-wallet.ts";

describe("withSqliteTransaction on the Postgres shim", () => {
  it("does not emit BEGIN IMMEDIATE during boot seed", () => {
    const sqls: string[] = [];
    const db = {
      dialect: "postgres",
      exec(sql: string) {
        sqls.push(sql);
      },
      prepare() {
        throw new Error("prepare should not run");
      },
    } as unknown as SqlDatabase;
    const result = withSqliteTransaction(db as never, () => "seeded");
    assert.equal(result, "seeded");
    assert.deepEqual(sqls, []);
  });

  it("still wraps sqlite connections in BEGIN IMMEDIATE", () => {
    const sqls: string[] = [];
    const db = {
      exec(sql: string) {
        sqls.push(sql);
      },
      prepare() {
        throw new Error("prepare should not run");
      },
      close() {},
    };
    withSqliteTransaction(db as never, () => undefined);
    assert.deepEqual(sqls, ["BEGIN IMMEDIATE", "COMMIT"]);
  });
});

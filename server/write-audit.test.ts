import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDb, initDatabase, writeAudit } from "./db.ts";

describe("writeAudit timestamps", () => {
  it("stores a UTC ISO-8601 timestamp", () => {
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const marker = `utc-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const before = Date.now();
    writeAudit(getDb(), "user-utc-audit", "UTC tester", "UTC timestamp check", marker);
    const after = Date.now();
    const row = getDb().prepare("SELECT timestamp FROM audit_logs WHERE details = ?").get(marker) as {
      timestamp: string;
    };
    assert.match(row.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const parsed = Date.parse(row.timestamp);
    assert.equal(Number.isNaN(parsed), false);
    assert.equal(parsed >= before - 1000 && parsed <= after + 1000, true);
    assert.equal(new Date(row.timestamp).toISOString(), row.timestamp);
  });
});

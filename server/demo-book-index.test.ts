import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { clinicCalendarDate, shiftIsoDate } from "../src/lib/clinicDay.ts";
import { INDIVIDUAL_DEMO_WINDOW, demoBookDateForIndex, spreadDemoBookDates } from "./demo-book-dates.ts";
import { ensureDemoWorkspaceTenants } from "./demo-workspace-tenants.ts";
import { migrate } from "./db-migrate.ts";
import { createPgShim } from "./pg-shim.ts";
import type { SqlDatabase } from "./sql-engine.ts";

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
    consultation_fee INTEGER NOT NULL DEFAULT 600,
    is_paid INTEGER NOT NULL DEFAULT 0,
    vitals TEXT,
    created_at TEXT NOT NULL
  )
`;

function spreadPostgresUrl(): string | null {
  const fromEnv = String(process.env.SPREAD_TEST_DATABASE_URL || "").trim();
  if (fromEnv) return fromEnv;
  if (fs.existsSync("/var/run/postgresql/.s.PGSQL.5432")) {
    return "postgres://ubuntu@/lumera_spread_test?host=/var/run/postgresql";
  }
  return null;
}

function duplicateTokens(db: SqlDatabase): Array<{ n: number }> {
  return (
    db
      .prepare(
        `SELECT tenant_id, date, doctor_id, token_number, COUNT(*) AS n
         FROM appointments
         GROUP BY tenant_id, date, doctor_id, token_number
         HAVING COUNT(*) > 1`
      )
      .all() as Array<{ n: number }>
  );
}

function seedSameTokenAcrossDays(db: SqlDatabase): void {
  const insert = db.prepare(
    `INSERT INTO appointments (
       id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid,
       doctor_id, doctor_name, specialty, date, time_slot, status, created_at
     ) VALUES (?, 'tenant-demo-individual', 1, 'pat-1', 'Rajiv Saxena', '+91 98111 01061', 'LUM-1',
               'doc-1', 'Dr. Vikram Malhotra', 'General Medicine', ?, '10:00 AM', 'Waiting', ?)`
  );
  for (let i = 0; i < 60; i += 1) {
    insert.run(`seed-${String(i).padStart(3, "0")}`, shiftIsoDate("2020-01-01", i), "2020-01-01T00:00:00.000Z");
  }
}

function assertSpreadSurvives(db: SqlDatabase, when: Date, expectedOutside: number): void {
  const before = Number(
    (db.prepare(`SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`).get("tenant-demo-individual") as { n: number }).n
  );
  spreadDemoBookDates(db, when);
  const after = Number(
    (db.prepare(`SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`).get("tenant-demo-individual") as { n: number }).n
  );
  assert.equal(after, before);
  assert.deepEqual(duplicateTokens(db), []);
  const today = clinicCalendarDate(when);
  const onToday = Number(
    (
      db
        .prepare(`SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ? AND date = ?`)
        .get("tenant-demo-individual", today) as { n: number }
    ).n
  );
  assert.equal(onToday, INDIVIDUAL_DEMO_WINDOW.today);
  const outside = demoBookDateForIndex(INDIVIDUAL_DEMO_WINDOW.month, today, INDIVIDUAL_DEMO_WINDOW);
  const piled = db
    .prepare(
      `SELECT COUNT(*) AS n, COUNT(DISTINCT token_number) AS tokens
       FROM appointments
       WHERE tenant_id = ? AND doctor_id = 'doc-1' AND date = ?`
    )
    .get("tenant-demo-individual", outside) as { n: number; tokens: number };
  // Tail rows always share `outside`. In the first week of a month the month-only
  // range is empty, so those seats join the same day. Every one still needs its own token.
  assert.equal(Number(piled.n), expectedOutside);
  assert.ok(Number(piled.n) > 1);
  assert.equal(Number(piled.tokens), Number(piled.n));
}

function walkIndexedBook(db: SqlDatabase): void {
  seedSameTokenAcrossDays(db);
  db.exec(
    `CREATE UNIQUE INDEX idx_appointments_tenant_queue_doctor_token
     ON appointments(tenant_id, date, doctor_id, token_number)`
  );
  const january = new Date("2026-01-31T04:00:00.000Z");
  // 31 Jan still has month days, so only the 13-row tail shares a date.
  // +1 day is 1 Feb (month boundary): the month-only range is empty and 40 rows share one date.
  // +7 is 7 Feb (week starts on the 1st) and +31 is 3 Mar (week starts in February): same pile.
  const expectedOutside: Record<number, number> = { 0: 13, 1: 40, 7: 40, 31: 40 };
  for (const days of [0, 1, 7, 31]) {
    assertSpreadSurvives(db, new Date(january.getTime() + days * 86_400_000), expectedOutside[days]);
  }
  assert.equal(clinicCalendarDate(january), "2026-01-31");
  assert.equal(clinicCalendarDate(new Date(january.getTime() + 86_400_000)), "2026-02-01");
}

describe("indexed demo book spread", () => {
  it("reallocates tokens on the target day for sqlite, including a month boundary", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(APPOINTMENTS_DDL);
    walkIndexedBook(db);
  });

  it("does not throw out of the boot call on an indexed sqlite database", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db);
    assert.doesNotThrow(() => ensureDemoWorkspaceTenants(db));
    assert.deepEqual(duplicateTokens(db), []);
  });

  it("reallocates tokens on the target day for postgres, including a month boundary", { timeout: 120_000 }, () => {
    const url = spreadPostgresUrl();
    if (!url) return;
    const db = createPgShim(url);
    db.exec("DROP TABLE IF EXISTS appointments");
    db.exec(APPOINTMENTS_DDL);
    walkIndexedBook(db);
  });
});

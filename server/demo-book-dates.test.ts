import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { homeMetrics } from "../src/lib/clinicNav.ts";
import { clinicCalendarDate } from "../src/lib/clinicDay.ts";
import { DEMO_BOOK_SIZE, demoBookDateForIndex, isDemoSeedTenantId, spreadDemoBookDates } from "./demo-book-dates.ts";

const NOW = new Date("2026-10-16T04:00:00.000Z");

function memoryDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
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
  `);
  return db;
}

function insertVisit(
  db: DatabaseSync,
  id: string,
  tenantId: string,
  date: string,
  status = "Waiting"
) {
  db.prepare(
    `INSERT INTO appointments (
       id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid,
       doctor_id, doctor_name, specialty, date, time_slot, status, created_at
     ) VALUES (?, ?, 1, 'pat-1', 'Rajiv Saxena', '+91 98111 01061', 'LUM-1',
               'doc-1', 'Dr. Vikram Malhotra', 'General Medicine', ?, '12:18 AM', ?, ?)`
  ).run(id, tenantId, date, status, NOW.toISOString());
}

describe("demo book dates", () => {
  it("recognises only tenant-demo workspaces", () => {
    assert.equal(isDemoSeedTenantId("tenant-demo-individual"), true);
    assert.equal(isDemoSeedTenantId("tenant-demo-physio"), true);
    assert.equal(isDemoSeedTenantId("tenant-lumera-main"), false);
    assert.equal(isDemoSeedTenantId("tenant-543feff7"), false);
    assert.equal(isDemoSeedTenantId("tenant-real-clinic"), false);
    assert.equal(isDemoSeedTenantId(""), false);
  });

  it("spreads demo visits across today, week, and month and leaves other tenants", () => {
    const db = memoryDb();
    for (let i = 0; i < 10; i += 1) insertVisit(db, `live-${i}`, "tenant-demo-individual", "2026-10-16");
    insertVisit(db, "real-1", "tenant-real-clinic", "2024-01-02", "Completed");
    insertVisit(db, "meta-1", "tenant-lumera-main", "2026-09-03", "Waiting");
    insertVisit(db, "sun-1", "tenant-543feff7", "2026-05-01", "Waiting");

    spreadDemoBookDates(db, NOW);

    const today = clinicCalendarDate(NOW);
    const demo = db.prepare(`SELECT id, date, status, time_slot, consultation_fee AS consultationFee, is_paid AS isPaid, type FROM appointments WHERE tenant_id = ?`).all("tenant-demo-individual") as Array<{
      id: string;
      date: string;
      status: string;
      time_slot: string;
      consultationFee: number;
      isPaid: number;
      type: string;
    }>;
    assert.equal(demo.length, DEMO_BOOK_SIZE);
    const metrics = homeMetrics(
      demo.map((row) => ({
        id: row.id,
        date: row.date,
        status: row.status,
        consultationFee: row.consultationFee,
        isPaid: Boolean(row.isPaid),
        type: row.type,
      })),
      NOW
    );
    assert.equal(metrics.today, today);
    assert.equal(metrics.todayAppointments, 6);
    assert.equal(metrics.weekAppointments, 25);
    assert.equal(metrics.monthAppointments, 80);
    assert.equal(demo.some((row) => row.time_slot === "12:18 AM"), false);

    const real = db.prepare(`SELECT date, time_slot FROM appointments WHERE id = 'real-1'`).get() as { date: string; time_slot: string };
    assert.equal(real.date, "2024-01-02");
    assert.equal(real.time_slot, "12:18 AM");
    const meta = db.prepare(`SELECT date FROM appointments WHERE id = 'meta-1'`).get() as { date: string };
    assert.equal(meta.date, "2026-09-03");
    const sunrise = db.prepare(`SELECT date FROM appointments WHERE id = 'sun-1'`).get() as { date: string };
    assert.equal(sunrise.date, "2026-05-01");

    const first = JSON.stringify(db.prepare(`SELECT id, date, time_slot FROM appointments ORDER BY id`).all());
    spreadDemoBookDates(db, NOW);
    const second = JSON.stringify(db.prepare(`SELECT id, date, time_slot FROM appointments ORDER BY id`).all());
    assert.equal(second, first);
    assert.equal(demoBookDateForIndex(0, today), today);
    assert.notEqual(demoBookDateForIndex(DEMO_BOOK_SIZE, today), today);
  });
});

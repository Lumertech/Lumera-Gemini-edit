import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { homeKpiCards, homeMetrics, opdTrend, todayVisitCount } from "../src/lib/clinicNav.ts";
import { clinicCalendarDate } from "../src/lib/clinicDay.ts";
import { DEMO_PHYSIO_PACKAGES, completedSessionsForPatient } from "../src/lib/demoPhysioBook.ts";
import {
  INDIVIDUAL_DEMO_WINDOW,
  PHYSIO_DEMO_WINDOW,
  POLYCLINIC_DEMO_WINDOW,
  demoBookDateForIndex,
  isDemoSeedTenantId,
  spreadDemoBookDates,
} from "./demo-book-dates.ts";

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
    assert.equal(demo.length, INDIVIDUAL_DEMO_WINDOW.month);
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
    assert.equal(metrics.todayAppointments, INDIVIDUAL_DEMO_WINDOW.today);
    assert.equal(metrics.weekAppointments, INDIVIDUAL_DEMO_WINDOW.week);
    assert.equal(metrics.monthAppointments, INDIVIDUAL_DEMO_WINDOW.month);
    assert.equal(metrics.todayAppointments, metrics.waiting + metrics.withDoctor + metrics.done);
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
    assert.notEqual(demoBookDateForIndex(INDIVIDUAL_DEMO_WINDOW.month, today), today);
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM appointments WHERE tenant_id = ?`).get("tenant-demo-physio") as { c: number }).c,
      PHYSIO_DEMO_WINDOW.month
    );
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM appointments WHERE tenant_id = ?`).get("tenant-demo-polyclinic") as { c: number }).c,
      POLYCLINIC_DEMO_WINDOW.month
    );
  });

  it("fills physio and polyclinic demo books without touching other tenants", () => {
    const db = memoryDb();
    db.exec(`
      CREATE TABLE patients (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        uhid TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        age INTEGER NOT NULL,
        gender TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        blood_group TEXT NOT NULL DEFAULT 'O+',
        allergies TEXT NOT NULL DEFAULT '[]',
        chronic_conditions TEXT NOT NULL DEFAULT '[]',
        emergency_contact TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        last_visit TEXT,
        created_at TEXT NOT NULL
      )
    `);
    insertVisit(db, "real-1", "tenant-real-clinic", "2024-01-02", "Completed");
    insertVisit(db, "meta-1", "tenant-lumera-main", "2026-09-03", "Waiting");
    insertVisit(db, "sun-1", "tenant-543feff7", "2026-05-01", "Waiting");

    spreadDemoBookDates(db, NOW);

    const today = clinicCalendarDate(NOW);
    const load = (tenantId: string) =>
      db.prepare(
        `SELECT id, patient_id AS patientId, date, status, time_slot, type, consultation_fee AS consultationFee, is_paid AS isPaid
         FROM appointments WHERE tenant_id = ?`
      ).all(tenantId) as Array<{
        id: string;
        patientId: string;
        date: string;
        status: string;
        time_slot: string;
        type: string;
        consultationFee: number;
        isPaid: number;
      }>;

    for (let i = 0; i < 4; i += 1) insertVisit(db, `ind-${i}`, "tenant-demo-individual", "2026-10-16");
    spreadDemoBookDates(db, NOW);

    const physio = load("tenant-demo-physio");
    const poly = load("tenant-demo-polyclinic");
    const individual = load("tenant-demo-individual");
    assert.equal(physio.length, PHYSIO_DEMO_WINDOW.month);
    assert.equal(poly.length, POLYCLINIC_DEMO_WINDOW.month);
    assert.equal(individual.length, INDIVIDUAL_DEMO_WINDOW.month);
    assert.equal(physio.every((row) => row.type === "Rehab session"), true);
    assert.equal(poly.some((row) => row.type === "Follow-up"), true);

    const totals = new Set<string>();
    const roles = [
      ["doctor", individual, INDIVIDUAL_DEMO_WINDOW],
      ["reception", individual, INDIVIDUAL_DEMO_WINDOW],
      ["clinic-admin", poly, POLYCLINIC_DEMO_WINDOW],
      ["physio", physio, PHYSIO_DEMO_WINDOW],
    ] as const;
    for (const [role, rows, window] of roles) {
      const metrics = homeMetrics(
        rows.map((row) => ({
          id: row.id,
          date: row.date,
          status: row.status,
          consultationFee: row.consultationFee,
          isPaid: Boolean(row.isPaid),
          type: row.type,
        })),
        NOW
      );
      const cards = homeKpiCards(metrics, 4);
      const trend = opdTrend(metrics);
      const value = (items: Array<{ label: string; value: string }>, label: string) =>
        Number(items.find((item) => item.label === label)?.value);
      const waiting = value(cards, "Waiting");
      const done = value(cards, "Done");
      const todayCount = value(trend, "Today");
      const weekCount = value(trend, "Week");
      const monthCount = value(trend, "Month");
      assert.equal(todayCount, waiting + metrics.withDoctor + done, role);
      assert.equal(todayCount, todayVisitCount(metrics), role);
      assert.equal(todayCount, window.today, role);
      assert.equal(weekCount, window.week, role);
      assert.equal(monthCount, window.month, role);
      assert.equal(metrics.withDoctor, 0, role);
      assert.ok(todayCount <= weekCount, role);
      assert.ok(weekCount <= monthCount, role);
      totals.add(`${todayCount}/${weekCount}/${monthCount}`);
      if (role === "physio" || role === "clinic-admin") {
        assert.ok(metrics.done > 0, role);
        assert.ok(metrics.todayCollected > 0, role);
      }
    }
    assert.equal(totals.size, 3);

    for (const pkg of DEMO_PHYSIO_PACKAGES) {
      assert.ok(completedSessionsForPatient(physio, pkg.patientId) > 0, pkg.patientId);
      assert.ok(completedSessionsForPatient(physio, pkg.patientId) <= pkg.totalSessions, pkg.patientId);
    }
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM patients WHERE tenant_id = ?`).get("tenant-demo-physio") as { c: number }).c,
      DEMO_PHYSIO_PACKAGES.length
    );
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM patients WHERE tenant_id = ?`).get("tenant-demo-polyclinic") as { c: number }).c,
      5
    );
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM appointments WHERE tenant_id = ?`).get("tenant-demo-dentist") as { c: number }).c,
      0
    );

    const real = db.prepare(`SELECT date, time_slot FROM appointments WHERE id = 'real-1'`).get() as { date: string; time_slot: string };
    assert.equal(real.date, "2024-01-02");
    assert.equal(real.time_slot, "12:18 AM");
    assert.equal((db.prepare(`SELECT date FROM appointments WHERE id = 'meta-1'`).get() as { date: string }).date, "2026-09-03");
    assert.equal((db.prepare(`SELECT date FROM appointments WHERE id = 'sun-1'`).get() as { date: string }).date, "2026-05-01");

    const first = JSON.stringify(
      db.prepare(`SELECT id, tenant_id, date, time_slot, status, is_paid, type, consultation_fee FROM appointments ORDER BY id`).all()
    );
    spreadDemoBookDates(db, NOW);
    const second = JSON.stringify(
      db.prepare(`SELECT id, tenant_id, date, time_slot, status, is_paid, type, consultation_fee FROM appointments ORDER BY id`).all()
    );
    assert.equal(second, first);
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM patients`).get() as { c: number }).c,
      DEMO_PHYSIO_PACKAGES.length + 5
    );
    assert.equal(today, "2026-10-16");
  });
});

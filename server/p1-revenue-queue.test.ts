import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { clinicCalendarDate, shiftIsoDate } from "../src/lib/clinicDay.ts";
import { collectedRupees, dayEndTotals, revenueTotals } from "./collected-revenue.ts";
import { ensureAppointmentTokenIndex } from "./queue-tokens.ts";

const IST = "IST (UTC+5:30)";

/** 00:30 on an IST clinic date. The UTC calendar date is the previous day. */
function istWallClockIso(clinicDate: string, hour: number, minute: number): string {
  const [year, month, day] = clinicDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - 330 * 60_000).toISOString();
}

function phone(): string {
  return `+91${crypto.randomInt(6000000000, 9999999999)}`;
}

function createClinicUser(label: string) {
  const suffix = `${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const email = `${label}.${suffix}@p1-test.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', ?, ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Clinic ${label}`, phone(), now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(userId, tenantId, email, hashPassword("Lumera@2026"), `Dr ${label}`, phone(), `Clinic ${label}`, now, now);
  return { tenantId, userId, email };
}

function memoryAppointments(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE appointments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      date TEXT NOT NULL,
      doctor_id TEXT NOT NULL,
      token_number INTEGER NOT NULL,
      patient_name TEXT NOT NULL
    )
  `);
  return db;
}

describe("collected revenue uses the IST collection day", () => {
  it("counts PAID and collected rupees at 00:30 IST, and ignores created_at", () => {
    const now = new Date("2026-10-18T19:00:00.000Z");
    assert.equal(now.toISOString().slice(0, 10), "2026-10-18");
    assert.equal(clinicCalendarDate(now, IST), "2026-10-19");
    const rows = [
      {
        status: "PAID",
        paid_amount: 600,
        total_amount: 600,
        paid_at: "2026-10-18T19:00:00.000Z",
        date: "2026-10-18",
        created_at: "2026-09-01T00:00:00.000Z",
      },
      {
        status: "collected",
        paid_amount: 0,
        total_amount: 100,
        paid_at: "2026-10-18T19:05:00.000Z",
        date: "2026-10-18",
        created_at: "2026-10-18T19:05:00.000Z",
      },
      { status: "Unpaid", total_amount: 900, paid_amount: 0, date: "2026-10-19", created_at: now.toISOString() },
      {
        status: "Paid",
        paid_amount: 999,
        total_amount: 999,
        paid_at: "2026-09-01T06:30:00.000Z",
        date: "2026-10-19",
        created_at: now.toISOString(),
      },
    ];
    const totals = revenueTotals(rows, IST, now);
    assert.equal(totals.date, "2026-10-19");
    assert.equal(totals.today, 700);
    assert.equal(totals.week, 700);
    assert.equal(totals.month, 700);
    assert.equal(totals.currency, "INR");
    assert.equal(collectedRupees(rows[0]), 600);
    const end = dayEndTotals(rows, "2026-10-19", IST);
    assert.equal(end.paidCount, 2);
    assert.equal(end.paidAmount, 700);
    assert.equal(end.dueCount, 1);
    assert.equal(end.dueAmount, 900);
    assert.equal(dayEndTotals(rows, "2026-10-18", IST).paidAmount, 0);
  });
});

describe("appointment tokens stay inside one queue day", () => {
  it("reports duplicate groups and does not delete them or create the index", () => {
    const db = memoryAppointments();
    const insert = db.prepare(
      `INSERT INTO appointments (id, tenant_id, date, doctor_id, token_number, patient_name)
       VALUES (?, 'tenant-qa', '2026-10-14', 'doc-1', 1010, ?)`
    );
    insert.run("row-rajiv", "Rajiv Saxena");
    insert.run("row-qa", "QA Patient");
    const result = ensureAppointmentTokenIndex(db);
    assert.equal(result.created, false);
    assert.equal(result.duplicates.length, 1);
    assert.equal(result.duplicates[0].token_number, 1010);
    assert.equal(result.duplicates[0].n, 2);
    const names = db.prepare(`SELECT id, patient_name FROM appointments ORDER BY id`).all() as Array<{
      id: string;
      patient_name: string;
    }>;
    assert.deepEqual(
      names.map((row) => row.patient_name),
      ["QA Patient", "Rajiv Saxena"]
    );
    insert.run("row-third", "Still here");
    assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM appointments`).get() as { c: number }).c, 3);
  });

  it("rejects a second identical token once the index exists", () => {
    const db = memoryAppointments();
    const result = ensureAppointmentTokenIndex(db);
    assert.equal(result.created, true);
    assert.deepEqual(result.duplicates, []);
    db.prepare(
      `INSERT INTO appointments (id, tenant_id, date, doctor_id, token_number, patient_name)
       VALUES ('a', 'tenant-qa', '2026-10-19', 'doc-1', 1010, 'QA Patient')`
    ).run();
    db.prepare(
      `INSERT INTO appointments (id, tenant_id, date, doctor_id, token_number, patient_name)
       VALUES ('b', 'tenant-qa', '2026-10-14', 'doc-1', 1010, 'Rajiv Saxena')`
    ).run();
    db.prepare(
      `INSERT INTO appointments (id, tenant_id, date, doctor_id, token_number, patient_name)
       VALUES ('c', 'tenant-qa', '2026-10-19', 'doc-2', 1010, 'Other doctor')`
    ).run();
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO appointments (id, tenant_id, date, doctor_id, token_number, patient_name)
             VALUES ('d', 'tenant-qa', '2026-10-19', 'doc-1', 1010, 'Overwrite')`
          )
          .run(),
      /UNIQUE constraint failed/
    );
    const kept = db.prepare(`SELECT patient_name FROM appointments WHERE id = 'a'`).get() as { patient_name: string };
    assert.equal(kept.patient_name, "QA Patient");
  });
});

describe("P1 revenue and queue integrity", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-p1-revenue-queue";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    await close?.();
  });

  async function login(email: string): Promise<string> {
    const loginRes = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(loginRes.status, 200, String(loginRes.json.error || "login failed"));
    return String(loginRes.json.token || "");
  }

  async function createPatient(auth: Record<string, string>, name: string) {
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name, phone: phone(), age: 42, gender: "Male" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    return created.json.patient as { id: string; name: string; phone: string; uhid: string };
  }

  it("counts a collected payment in IST today, including one taken at 00:30 IST", async () => {
    const clinic = createClinicUser("rev");
    const other = createClinicUser("rev-other");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const istToday = clinicCalendarDate(new Date(), IST);
    const midnight = istWallClockIso(istToday, 0, 30);
    assert.notEqual(midnight.slice(0, 10), istToday);

    const patient = await createPatient(auth, "QA Patient");
    const markedPaid = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      {
        patientId: patient.id,
        doctorId: `doc-fee-${clinic.tenantId}`,
        consultationFee: 600,
        isPaid: true,
        date: istToday,
        timeSlot: "11:00 AM",
      },
      auth
    );
    assert.equal(markedPaid.status, 201, String(markedPaid.json.error || ""));

    const before = await jsonRequest(port, "GET", "/api/billing/revenue", undefined, auth);
    assert.equal(before.status, 200, String(before.json.error || ""));
    assert.equal(before.json.today, 0);
    assert.equal(before.json.tenantId, clinic.tenantId);

    const invoiced = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        patientId: patient.id,
        patientName: patient.name,
        patientPhone: patient.phone,
        items: [{ id: "consult", description: "OPD consult", quantity: 1, unitPrice: 600, total: 600 }],
        totalAmount: 600,
      },
      auth
    );
    assert.equal(invoiced.status, 201, String(invoiced.json.error || ""));
    const invoice = invoiced.json.invoice as { id: string };
    const collected = await jsonRequest(port, "POST", `/api/invoices/${invoice.id}/desk-collect`, { paymentMode: "Cash" }, auth);
    assert.equal(collected.status, 200, String(collected.json.error || ""));

    const afterDesk = await jsonRequest(port, "GET", "/api/billing/revenue", undefined, auth);
    assert.equal(afterDesk.json.date, istToday);
    assert.equal(afterDesk.json.today, 600);
    assert.equal(afterDesk.json.week, 600);
    assert.equal(afterDesk.json.month, 600);
    assert.equal(afterDesk.json.currency, "INR");

    const now = new Date().toISOString();
    const insertInvoice = getDb().prepare(
      `INSERT INTO invoices (
         id, tenant_id, invoice_number, date, total_amount, paid_amount, status, paid_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertInvoice.run(
      `inv-midnight-paid-${clinic.tenantId}`,
      clinic.tenantId,
      `INV-MID-PAID-${clinic.tenantId}`,
      midnight.slice(0, 10),
      50,
      50,
      "PAID",
      midnight,
      now
    );
    insertInvoice.run(
      `inv-midnight-col-${clinic.tenantId}`,
      clinic.tenantId,
      `INV-MID-COL-${clinic.tenantId}`,
      midnight.slice(0, 10),
      150,
      150,
      "collected",
      midnight,
      now
    );
    insertInvoice.run(
      `inv-unpaid-${clinic.tenantId}`,
      clinic.tenantId,
      `INV-UNPAID-${clinic.tenantId}`,
      istToday,
      900,
      0,
      "Unpaid",
      null,
      now
    );
    insertInvoice.run(
      `inv-old-${clinic.tenantId}`,
      clinic.tenantId,
      `INV-OLD-${clinic.tenantId}`,
      istToday,
      999,
      999,
      "Paid",
      istWallClockIso(shiftIsoDate(istToday, -40), 12, 0),
      now
    );
    insertInvoice.run(
      `inv-other-${other.tenantId}`,
      other.tenantId,
      `INV-OTHER-${other.tenantId}`,
      istToday,
      5000,
      5000,
      "Paid",
      now,
      now
    );

    const revenue = await jsonRequest(port, "GET", "/api/billing/revenue", undefined, auth);
    assert.equal(revenue.status, 200);
    assert.equal(revenue.json.date, istToday);
    assert.equal(revenue.json.today, 800);
    assert.equal(revenue.json.week, 800);
    assert.equal(revenue.json.month, 800);

    const dayEnd = await jsonRequest(port, "GET", "/api/billing/day-end", undefined, auth);
    assert.equal(dayEnd.status, 200);
    assert.equal(dayEnd.json.date, istToday);
    assert.equal(dayEnd.json.paidAmount, 800);
    assert.equal(dayEnd.json.paidCount, 3);
    assert.equal(dayEnd.json.dueAmount, 900);

    const utcDay = await jsonRequest(port, "GET", `/api/billing/day-end?date=${midnight.slice(0, 10)}`, undefined, auth);
    assert.equal(utcDay.json.date, midnight.slice(0, 10));
    assert.equal(utcDay.json.paidAmount, 0);
  });

  it("keeps token 1010 on each queue day and books 00:30 IST on today's IST date", async () => {
    const clinic = createClinicUser("queue");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const istToday = clinicCalendarDate(new Date(), IST);
    const oct14 = istToday === "2026-10-14" ? "2026-10-13" : "2026-10-14";
    const doctor = `doc-rajiv-${clinic.tenantId}`;
    const rajiv = await createPatient(auth, "Rajiv Saxena");
    const qa = await createPatient(auth, "QA Patient");

    const historical = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      {
        patientId: rajiv.id,
        doctorId: doctor,
        date: oct14,
        timeSlot: "10:00 AM",
        tokenNumber: 1010,
      },
      auth
    );
    assert.equal(historical.status, 201, String(historical.json.error || ""));
    const rajivVisit = historical.json.appointment as {
      id: string;
      tokenNumber: number;
      date: string;
      timeSlot: string;
      patientName: string;
    };
    assert.equal(rajivVisit.tokenNumber, 1010);
    assert.equal(rajivVisit.date, oct14);
    assert.equal(rajivVisit.patientName, "Rajiv Saxena");
    assert.equal(rajivVisit.timeSlot, "10:00 AM");

    const todayVisit = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      {
        patientId: qa.id,
        doctorId: doctor,
        date: istToday,
        timeSlot: "09:15 AM",
        tokenNumber: 1010,
      },
      auth
    );
    assert.equal(todayVisit.status, 201, String(todayVisit.json.error || ""));
    const qaVisit = todayVisit.json.appointment as { id: string; tokenNumber: number; date: string; patientName: string };
    assert.equal(qaVisit.tokenNumber, 1010);
    assert.equal(qaVisit.date, istToday);
    assert.equal(qaVisit.patientName, "QA Patient");
    assert.notEqual(qaVisit.id, rajivVisit.id);

    const clash = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      {
        patientId: qa.id,
        doctorId: doctor,
        date: istToday,
        timeSlot: "09:45 AM",
        tokenNumber: 1010,
      },
      auth
    );
    assert.equal(clash.status, 201, String(clash.json.error || ""));
    const second = clash.json.appointment as { id: string; tokenNumber: number; patientName: string; date: string };
    assert.notEqual(second.tokenNumber, 1010);
    assert.notEqual(second.id, qaVisit.id);
    assert.equal(second.date, istToday);

    const stillRajiv = await jsonRequest(port, "GET", `/api/appointments/${rajivVisit.id}`, undefined, auth);
    const kept = stillRajiv.json.appointment as {
      id: string;
      tokenNumber: number;
      date: string;
      timeSlot: string;
      patientName: string;
    };
    assert.equal(kept.id, rajivVisit.id);
    assert.equal(kept.patientName, "Rajiv Saxena");
    assert.equal(kept.date, oct14);
    assert.equal(kept.timeSlot, "10:00 AM");
    assert.equal(kept.tokenNumber, 1010);

    const octQueue = await jsonRequest(port, "GET", `/api/appointments?date=${oct14}`, undefined, auth);
    const octRows = octQueue.json.appointments as Array<{ id: string; patientName: string; tokenNumber: number }>;
    assert.equal(octRows.filter((row) => row.tokenNumber === 1010).length, 1);
    assert.equal(octRows.find((row) => row.tokenNumber === 1010)?.patientName, "Rajiv Saxena");
    assert.equal(octRows.some((row) => row.id === qaVisit.id), false);

    const doctorA = `doc-a-${clinic.tenantId}`;
    const doctorB = `doc-b-${clinic.tenantId}`;
    const firstA = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      { patientId: rajiv.id, doctorId: doctorA, date: istToday, timeSlot: "04:00 PM" },
      auth
    );
    const firstB = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      { patientId: qa.id, doctorId: doctorB, date: istToday, timeSlot: "04:00 PM" },
      auth
    );
    assert.equal((firstA.json.appointment as { tokenNumber: number }).tokenNumber, 1);
    assert.equal((firstB.json.appointment as { tokenNumber: number }).tokenNumber, 1);
    const secondA = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      { patientId: qa.id, doctorId: doctorA, date: istToday, timeSlot: "04:30 PM" },
      auth
    );
    assert.equal((secondA.json.appointment as { tokenNumber: number }).tokenNumber, 2);

    const at0030 = istWallClockIso(istToday, 0, 30);
    const midnightBooking = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      {
        patientId: qa.id,
        doctorId: `doc-midnight-${clinic.tenantId}`,
        date: at0030,
        timeSlot: "12:30 AM",
      },
      auth
    );
    assert.equal(midnightBooking.status, 201, String(midnightBooking.json.error || ""));
    const midnightVisit = midnightBooking.json.appointment as { date: string; tokenNumber: number };
    assert.equal(midnightVisit.date, istToday);
    assert.notEqual(midnightVisit.date, at0030.slice(0, 10));

    const omitted = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      { patientId: rajiv.id, doctorId: `doc-omit-${clinic.tenantId}`, timeSlot: "08:00 AM" },
      auth
    );
    assert.equal(omitted.status, 201, String(omitted.json.error || ""));
    assert.equal((omitted.json.appointment as { date: string }).date, clinicCalendarDate(new Date(), IST));
  });
});

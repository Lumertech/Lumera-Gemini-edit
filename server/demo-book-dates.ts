import type { SqlDatabase } from "./sql-engine.ts";
import { clinicCalendarDate, shiftIsoDate } from "../src/lib/clinicDay.ts";
import { DEMO_PHYSIO_PACKAGES } from "../src/lib/demoPhysioBook.ts";

/** Visits kept inside the current clinic month for a demo book. */
export const DEMO_BOOK_SIZE = 80;
const TODAY_COUNT = 6;
const WEEK_COUNT = 25;

const CLINIC_SLOTS = ["09:00 AM", "09:30 AM", "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM", "04:00 PM", "04:30 PM"];

/**
 * Demo workspaces created for @lumera.me logins.
 * The Meta review clinic and Sunrise are not in this set.
 */
export function isDemoSeedTenantId(tenantId: string): boolean {
  return String(tenantId || "").trim().startsWith("tenant-demo-");
}

function datesFrom(start: string, endExclusive: string): string[] {
  const days: string[] = [];
  let cursor = start;
  while (cursor && cursor < endExclusive) {
    days.push(cursor);
    cursor = shiftIsoDate(cursor, 1);
  }
  return days;
}

/** Stable date for each active visit, relative to the clinic day. */
export function demoBookDateForIndex(index: number, today: string): string {
  const monthStart = `${today.slice(0, 8)}01`;
  const weekStart = shiftIsoDate(today, -6);
  const outside = shiftIsoDate(monthStart, -1);
  if (index < TODAY_COUNT) return today;
  if (index < WEEK_COUNT) {
    const weekOnly = datesFrom(weekStart, today);
    return weekOnly[(index - TODAY_COUNT) % weekOnly.length] || outside;
  }
  if (index < DEMO_BOOK_SIZE) {
    const monthOnly = datesFrom(monthStart, weekStart);
    return monthOnly[(index - WEEK_COUNT) % monthOnly.length] || outside;
  }
  return outside;
}

function statusRank(status: string): number {
  if (status === "Waiting") return 0;
  if (status === "Triage / Vitals") return 1;
  if (status === "In Consultation") return 2;
  if (status === "Completed") return 3;
  return 4;
}

function isActiveStatus(status: string): boolean {
  return status !== "Cancelled" && status !== "No-Show";
}

/** Today keeps a waiting queue, someone in session, and paid completed visits. */
export function namedDemoVisitPlan(index: number, sessionType: string): { status: string; isPaid: number; type: string } {
  const type = index === 1 && sessionType === "New Consultation" ? "Follow-up" : sessionType;
  if (index < 3) return { status: "Waiting", isPaid: 0, type };
  if (index === 3) return { status: "In Consultation", isPaid: 0, type: sessionType };
  if (index < 6 || index % 3 === 2) return { status: "Completed", isPaid: 1, type: sessionType };
  return { status: "Waiting", isPaid: 0, type: sessionType };
}

interface DemoPerson {
  patientId: string;
  patientName: string;
  patientPhone: string;
  uhid: string;
  age: number;
  gender: string;
  doctorId: string;
  doctorName: string;
  specialty: string;
}

interface NamedBook {
  tenantId: string;
  fee: number;
  sessionType: string;
  people: DemoPerson[];
}

const PHYSIO_DOCTOR = {
  doctorId: "doc-persona-physio",
  doctorName: "Dr. Siddharth Varma (PT)",
  specialty: "Physiotherapy & Rehabilitation",
};

const NAMED_DEMO_BOOKS: NamedBook[] = [
  {
    tenantId: "tenant-demo-physio",
    fee: 700,
    sessionType: "Rehab session",
    people: DEMO_PHYSIO_PACKAGES.map((pkg) => ({
      patientId: pkg.patientId,
      patientName: pkg.patientName,
      patientPhone: pkg.phone,
      uhid: pkg.uhid,
      age: pkg.age,
      gender: pkg.gender,
      ...PHYSIO_DOCTOR,
    })),
  },
  {
    tenantId: "tenant-demo-polyclinic",
    fee: 600,
    sessionType: "New Consultation",
    people: [
      { patientId: "poly-pat-kavita", patientName: "Kavita Rao", patientPhone: "+91 98111 22001", uhid: "LUM-POLY-2201", age: 46, gender: "Female", doctorId: "doc-persona-cardio", doctorName: "Dr. Rajesh Sharma", specialty: "Cardiology" },
      { patientId: "poly-pat-suresh", patientName: "Suresh Iyer", patientPhone: "+91 98111 22002", uhid: "LUM-POLY-2202", age: 52, gender: "Male", doctorId: "doc-persona-derma", doctorName: "Dr. Meera Vasudevan", specialty: "Dermatology" },
      { patientId: "poly-pat-nisha", patientName: "Nisha Kulkarni", patientPhone: "+91 98111 22003", uhid: "LUM-POLY-2203", age: 34, gender: "Female", doctorId: "doc-persona-gynae", doctorName: "Dr. Shalini Mukhopadhyay", specialty: "Gynecology" },
      { patientId: "poly-pat-arjun", patientName: "Arjun Bose", patientPhone: "+91 98111 22004", uhid: "LUM-POLY-2204", age: 8, gender: "Male", doctorId: "doc-persona-pedia", doctorName: "Dr. Ananya Sen", specialty: "Pediatrics" },
      { patientId: "poly-pat-farah", patientName: "Farah Khan", patientPhone: "+91 98111 22005", uhid: "LUM-POLY-2205", age: 61, gender: "Female", doctorId: "doc-persona-ortho", doctorName: "Dr. Harshvardhan Patel", specialty: "Orthopedics" },
    ],
  },
];

function namedBookFor(tenantId: string): NamedBook | undefined {
  return NAMED_DEMO_BOOKS.find((book) => book.tenantId === tenantId);
}

function hasTable(database: SqlDatabase, name: string): boolean {
  const row = database.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) as
    | { ok: number }
    | undefined;
  return Boolean(row);
}

function ensureNamedDemoBook(database: SqlDatabase, book: NamedBook, today: string, now: Date): void {
  const stamp = now.toISOString();
  if (hasTable(database, "patients")) {
    const insertPatient = database.prepare(
      `INSERT INTO patients (
         id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions,
         emergency_contact, address, last_visit, created_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, '', 'O+', '[]', '[]', '', '', ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM patients WHERE id = ?)`
    );
    for (const person of book.people) {
      insertPatient.run(
        person.patientId,
        book.tenantId,
        person.uhid,
        person.patientName,
        person.age,
        person.gender,
        person.patientPhone,
        today,
        stamp,
        person.patientId
      );
    }
  }

  const insertVisit = database.prepare(
    `INSERT INTO appointments (
       id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid,
       doctor_id, doctor_name, specialty, date, time_slot, type, status, source,
       consultation_fee, is_paid, created_at
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Walk-in', ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM appointments WHERE id = ?)`
  );
  for (let n = 0; n < DEMO_BOOK_SIZE; n += 1) {
    const person = book.people[n % book.people.length];
    const plan = namedDemoVisitPlan(n, book.sessionType);
    const id = `demo-book-${book.tenantId}-${String(n).padStart(3, "0")}`;
    insertVisit.run(
      id,
      book.tenantId,
      1000 + n,
      person.patientId,
      person.patientName,
      person.patientPhone,
      person.uhid,
      person.doctorId,
      person.doctorName,
      person.specialty,
      today,
      CLINIC_SLOTS[n % CLINIC_SLOTS.length],
      plan.type,
      plan.status,
      book.fee,
      plan.isPaid,
      stamp,
      id
    );
  }
}

interface AppointmentRow {
  id: string;
  status: string;
  patient_id: string;
  patient_name: string;
  patient_phone: string;
  uhid: string;
  doctor_id: string;
  doctor_name: string;
  specialty: string;
}

/**
 * Spread active visits on demo/seed tenants across today, this week, and this month.
 * Idempotent for a given clinic day. Rows on any other tenant are left unchanged.
 * Empty books are filled only for the physio and polyclinic demo workspaces.
 */
export function spreadDemoBookDates(database: SqlDatabase, now = new Date()): void {
  const today = clinicCalendarDate(now);
  const tenantIds = (
    database.prepare(`SELECT DISTINCT tenant_id AS id FROM appointments`).all() as Array<{ id: string }>
  )
    .map((row) => String(row.id || ""))
    .filter(isDemoSeedTenantId);
  for (const book of NAMED_DEMO_BOOKS) {
    if (!tenantIds.includes(book.tenantId)) tenantIds.push(book.tenantId);
  }

  const list = database.prepare(
    `SELECT id, status, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name, specialty
     FROM appointments WHERE tenant_id = ?`
  );
  const insert = database.prepare(
    `INSERT INTO appointments (
       id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid,
       doctor_id, doctor_name, specialty, date, time_slot, type, status, source,
       consultation_fee, is_paid, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New Consultation', 'Waiting', 'Walk-in', 500, 0, ?)`
  );
  const update = database.prepare(
    `UPDATE appointments SET date = ?, time_slot = ? WHERE id = ? AND tenant_id = ?`
  );
  const updateNamed = database.prepare(
    `UPDATE appointments
     SET date = ?, time_slot = ?, status = ?, is_paid = ?, type = ?, consultation_fee = ?
     WHERE id = ? AND tenant_id = ?`
  );

  for (const tenantId of tenantIds) {
    const book = namedBookFor(tenantId);
    if (book) ensureNamedDemoBook(database, book, today, now);
    const rows = list.all(tenantId) as AppointmentRow[];
    const active = rows.filter((row) => isActiveStatus(String(row.status || "")));
    const sample = rows[0];
    if (!book && sample && active.length < DEMO_BOOK_SIZE) {
      const people = rows.filter((row, index, all) => all.findIndex((item) => item.patient_id === row.patient_id) === index);
      const stamp = now.toISOString();
      for (let n = active.length; n < DEMO_BOOK_SIZE; n += 1) {
        const person = people[n % people.length] || sample;
        const id = `demo-book-${tenantId}-${String(n).padStart(3, "0")}`;
        insert.run(
          id,
          tenantId,
          1000 + n,
          person.patient_id,
          person.patient_name,
          person.patient_phone || "",
          person.uhid || "",
          person.doctor_id,
          person.doctor_name,
          person.specialty || "General Medicine",
          today,
          CLINIC_SLOTS[n % CLINIC_SLOTS.length],
          stamp
        );
        active.push({ ...person, id, status: "Waiting" });
      }
    }

    if (book) {
      const refreshed = list.all(tenantId) as AppointmentRow[];
      const activeNamed = refreshed.filter((row) => isActiveStatus(String(row.status || "")));
      const inactiveNamed = refreshed.filter((row) => !isActiveStatus(String(row.status || "")));
      activeNamed.sort((a, b) => a.id.localeCompare(b.id));
      [...activeNamed, ...inactiveNamed].forEach((row, index) => {
        const date = demoBookDateForIndex(index, today);
        const slot = CLINIC_SLOTS[index % CLINIC_SLOTS.length];
        const plan = namedDemoVisitPlan(index, book.sessionType);
        updateNamed.run(date, slot, plan.status, plan.isPaid, plan.type, book.fee, row.id, tenantId);
      });
      continue;
    }

    active.sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.id.localeCompare(b.id));
    const inactive = rows.filter((row) => !isActiveStatus(String(row.status || "")));
    const ordered = [...active, ...inactive];
    ordered.forEach((row, index) => {
      const date = demoBookDateForIndex(index, today);
      const slot = CLINIC_SLOTS[index % CLINIC_SLOTS.length];
      update.run(date, slot, row.id, tenantId);
    });
  }
}

import { AMBIENT_WALKIN_SOURCE } from "./ambient-walkin.ts";
import type { SqlDatabase } from "./sql-engine.ts";
import { tableExists } from "./sql-catalog.ts";
import { clinicCalendarDate, shiftIsoDate } from "../src/lib/clinicDay.ts";
import { DEMO_PHYSIO_PACKAGES } from "../src/lib/demoPhysioBook.ts";

/** How many active visits land on today, inside the week, and inside the month. */
export interface DemoBookWindow {
  today: number;
  week: number;
  month: number;
  /** Completed rows inside today. The rest of today stays waiting. Nobody is left in consult. */
  doneToday: number;
}

/** Individual, polyclinic, and physio books are different sizes so the counts are not one shape. */
export const INDIVIDUAL_DEMO_WINDOW: DemoBookWindow = { today: 8, week: 20, month: 47, doneToday: 0 };
export const POLYCLINIC_DEMO_WINDOW: DemoBookWindow = { today: 7, week: 16, month: 31, doneToday: 3 };
export const PHYSIO_DEMO_WINDOW: DemoBookWindow = { today: 5, week: 12, month: 24, doneToday: 2 };

export function demoBookWindowFor(tenantId: string): DemoBookWindow {
  if (tenantId === "tenant-demo-polyclinic") return POLYCLINIC_DEMO_WINDOW;
  if (tenantId === "tenant-demo-physio") return PHYSIO_DEMO_WINDOW;
  if (tenantId === "tenant-demo-individual") return INDIVIDUAL_DEMO_WINDOW;
  return { today: 3, week: 9, month: 18, doneToday: 1 };
}

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

/** Stable date for each active visit, relative to the clinic day and that tenant's window. */
export function demoBookDateForIndex(index: number, today: string, window: DemoBookWindow = INDIVIDUAL_DEMO_WINDOW): string {
  const monthStart = `${today.slice(0, 8)}01`;
  const weekStart = shiftIsoDate(today, -6);
  const windowStart = monthStart < weekStart ? monthStart : weekStart;
  const outside = shiftIsoDate(windowStart, -1);
  if (index < window.today) return today;
  if (index < window.week) {
    const weekOnly = datesFrom(weekStart, today);
    return weekOnly[(index - window.today) % weekOnly.length] || outside;
  }
  if (index < window.month) {
    const monthOnly = datesFrom(monthStart, weekStart);
    return monthOnly[(index - window.week) % monthOnly.length] || outside;
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

/** Completed visits the in-window plan assigns to each seat when rows rotate through `seats` people. */
export function windowCompletedBySeat(window: DemoBookWindow, sessionType: string, seats: number): number[] {
  const counts = Array.from({ length: seats }, () => 0);
  if (seats < 1) return counts;
  for (let index = 0; index < window.month; index += 1) {
    if (namedDemoVisitPlan(index, sessionType, window).status === "Completed") counts[index % seats] += 1;
  }
  return counts;
}

function packageTargets(tenantId: string): Map<string, number> | null {
  if (tenantId !== "tenant-demo-physio") return null;
  return new Map(DEMO_PHYSIO_PACKAGES.map((pkg) => [pkg.patientId, pkg.seedCompleted]));
}

/**
 * Window rows keep the shared today/week/month plan.
 * Physio rows outside that window fill each package up to its done-session target.
 * Those extra done visits stay dated before the week and the month.
 */
function planNamedDemoRow(
  index: number,
  patientId: string,
  sessionType: string,
  window: DemoBookWindow,
  targets: Map<string, number> | null,
  completed: Map<string, number>,
  active: boolean
): { status: string; isPaid: number; type: string } {
  const inWindow = index < window.month;
  if (inWindow || !targets || !active) {
    const plan = namedDemoVisitPlan(index, sessionType, window);
    if (active && plan.status === "Completed") completed.set(patientId, (completed.get(patientId) ?? 0) + 1);
    return plan;
  }
  const target = targets.get(patientId) ?? 0;
  const soFar = completed.get(patientId) ?? 0;
  if (soFar < target) {
    completed.set(patientId, soFar + 1);
    return { status: "Completed", isPaid: 1, type: sessionType };
  }
  return { status: "Waiting", isPaid: 0, type: sessionType };
}

/** Today is only waiting and completed, so the cards and the Today trend count the same visits. */
export function namedDemoVisitPlan(
  index: number,
  sessionType: string,
  window: DemoBookWindow
): { status: string; isPaid: number; type: string } {
  const type = index === 1 && sessionType === "New Consultation" ? "Follow-up" : sessionType;
  if (index >= window.month) return { status: "Waiting", isPaid: 0, type: sessionType };
  const doneToday = index < window.today && index >= window.today - window.doneToday;
  const doneEarlier = index >= window.today && index % 3 === 0;
  if (doneToday || doneEarlier) return { status: "Completed", isPaid: 1, type: sessionType };
  return { status: "Waiting", isPaid: 0, type };
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

function orderedNamedRows(rows: AppointmentRow[]): AppointmentRow[] {
  const active = rows.filter((row) => isActiveStatus(String(row.status || "")));
  const inactive = rows.filter((row) => !isActiveStatus(String(row.status || "")));
  active.sort((a, b) => a.id.localeCompare(b.id));
  inactive.sort((a, b) => a.id.localeCompare(b.id));
  return [...active, ...inactive];
}

function hasTable(database: SqlDatabase, name: string): boolean {
  return tableExists(database, name);
}

function ensureNamedDemoBook(database: SqlDatabase, book: NamedBook, today: string, now: Date): void {
  const window = demoBookWindowFor(book.tenantId);
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
  for (let n = 0; n < window.month; n += 1) {
    const person = book.people[n % book.people.length];
    const plan = namedDemoVisitPlan(n, book.sessionType, window);
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

/** Insert the done sessions a physio package still needs. Existing tail rows count, so a second pass inserts nothing. */
function ensurePhysioPackageHistory(
  database: SqlDatabase,
  book: NamedBook,
  window: DemoBookWindow,
  today: string,
  now: Date,
  list: { all: (tenantId: string, source: string) => unknown }
): void {
  const targets = packageTargets(book.tenantId);
  if (!targets) return;
  const completed = new Map<string, number>();
  orderedNamedRows(list.all(book.tenantId, AMBIENT_WALKIN_SOURCE) as AppointmentRow[]).forEach((row, index) => {
    planNamedDemoRow(
      index,
      row.patient_id,
      book.sessionType,
      window,
      targets,
      completed,
      isActiveStatus(String(row.status || ""))
    );
  });
  const insertVisit = database.prepare(
    `INSERT INTO appointments (
       id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid,
       doctor_id, doctor_name, specialty, date, time_slot, type, status, source,
       consultation_fee, is_paid, created_at
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Walk-in', ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM appointments WHERE id = ?)`
  );
  const stamp = now.toISOString();
  for (const person of book.people) {
    const deficit = (targets.get(person.patientId) ?? 0) - (completed.get(person.patientId) ?? 0);
    for (let k = 0; k < deficit; k += 1) {
      const id = `demo-book-${book.tenantId}-pkg-${person.patientId}-${String(k).padStart(2, "0")}`;
      insertVisit.run(
        id,
        book.tenantId,
        3000 + k,
        person.patientId,
        person.patientName,
        person.patientPhone,
        person.uhid,
        person.doctorId,
        person.doctorName,
        person.specialty,
        today,
        CLINIC_SLOTS[k % CLINIC_SLOTS.length],
        book.sessionType,
        "Waiting",
        book.fee,
        0,
        stamp,
        id
      );
    }
  }
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
     FROM appointments WHERE tenant_id = ? AND COALESCE(source, '') != ?`
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
    const window = demoBookWindowFor(tenantId);
    const rows = list.all(tenantId, AMBIENT_WALKIN_SOURCE) as AppointmentRow[];
    const active = rows.filter((row) => isActiveStatus(String(row.status || "")));
    const sample = rows[0];
    if (!book && sample && active.length < window.month) {
      const people = rows.filter((row, index, all) => all.findIndex((item) => item.patient_id === row.patient_id) === index);
      const stamp = now.toISOString();
      for (let n = active.length; n < window.month; n += 1) {
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
      const targets = packageTargets(book.tenantId);
      if (targets) ensurePhysioPackageHistory(database, book, window, today, now, list);
      const refreshed = list.all(tenantId, AMBIENT_WALKIN_SOURCE) as AppointmentRow[];
      const completed = new Map<string, number>();
      orderedNamedRows(refreshed).forEach((row, index) => {
        const date = demoBookDateForIndex(index, today, window);
        const slot = CLINIC_SLOTS[index % CLINIC_SLOTS.length];
        const plan = planNamedDemoRow(
          index,
          row.patient_id,
          book.sessionType,
          window,
          targets,
          completed,
          isActiveStatus(String(row.status || ""))
        );
        updateNamed.run(date, slot, plan.status, plan.isPaid, plan.type, book.fee, row.id, tenantId);
      });
      continue;
    }

    active.sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.id.localeCompare(b.id));
    const inactive = rows.filter((row) => !isActiveStatus(String(row.status || "")));
    const ordered = [...active, ...inactive];
    ordered.forEach((row, index) => {
      const date = demoBookDateForIndex(index, today, window);
      const slot = CLINIC_SLOTS[index % CLINIC_SLOTS.length];
      update.run(date, slot, row.id, tenantId);
    });
  }
}

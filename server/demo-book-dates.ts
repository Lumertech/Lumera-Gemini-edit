import type { SqlDatabase } from "./sql-engine.ts";
import { clinicCalendarDate, shiftIsoDate } from "../src/lib/clinicDay.ts";

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
 */
export function spreadDemoBookDates(database: SqlDatabase, now = new Date()): void {
  const today = clinicCalendarDate(now);
  const tenantIds = (
    database.prepare(`SELECT DISTINCT tenant_id AS id FROM appointments`).all() as Array<{ id: string }>
  )
    .map((row) => String(row.id || ""))
    .filter(isDemoSeedTenantId);

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

  for (const tenantId of tenantIds) {
    const rows = list.all(tenantId) as AppointmentRow[];
    const active = rows.filter((row) => isActiveStatus(String(row.status || "")));
    const sample = rows[0];
    if (sample && active.length < DEMO_BOOK_SIZE) {
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

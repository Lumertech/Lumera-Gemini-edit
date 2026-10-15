/** Clinic calendar dates. Indian clinics default to IST (UTC+5:30), not the browser/UTC day. */

export const CLINIC_TZ_IST = "IST (UTC+5:30)";
export const IST_OFFSET_MINUTES = 330;

export type AppointmentListDate =
  | { kind: "all" }
  | { kind: "today" }
  | { kind: "day"; date: string };

export function utcOffsetMinutes(timezone?: string | null): number {
  const text = String(timezone || "").trim();
  const match = text.match(/UTC\s*([+-])\s*(\d{1,2})(?::(\d{2}))?/i);
  if (match) {
    const sign = match[1] === "-" ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
  }
  if (/IST|Asia\/Kolkata|India/i.test(text) || !text) return IST_OFFSET_MINUTES;
  return IST_OFFSET_MINUTES;
}

/** YYYY-MM-DD in the clinic timezone. Empty timezone means IST. */
export function clinicCalendarDate(now = new Date(), timezone?: string | null): string {
  const shifted = new Date(now.getTime() + utcOffsetMinutes(timezone) * 60_000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shiftIsoDate(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || "").trim());
  if (!match) return "";
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  const year = utc.getUTCFullYear();
  const month = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const day = String(utc.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatClinicDayLabel(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || "").trim());
  if (!match) return String(isoDate || "");
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return utc.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function parseAppointmentListDate(raw: unknown): AppointmentListDate {
  const value = String(raw ?? "").trim();
  if (!value) return { kind: "all" };
  if (/^today$/i.test(value)) return { kind: "today" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { kind: "day", date: value };
  throw Object.assign(new Error("date must be YYYY-MM-DD"), { status: 400 });
}

export function appointmentsForClinicDay<T extends { date?: string }>(appointments: readonly T[], day: string): T[] {
  const iso = String(day || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return appointments.slice(0, 0);
  return appointments.filter((row) => String(row?.date || "") === iso);
}

/**
 * Bill an appointment the user opened, or a visit on the clinic day.
 * Never attach an older visit for the same patient.
 */
export function appointmentIdForBillContext(
  appointments: Array<{ id: string; patientId?: string; date?: string; status?: string }>,
  opts: { selectedAppointmentId?: string; patientId?: string; day: string }
): string {
  const selected = String(opts.selectedAppointmentId || "").trim();
  if (selected) return selected;
  const day = String(opts.day || "").trim();
  const patientId = String(opts.patientId || "").trim();
  if (!day || !patientId) return "";
  const todays = (Array.isArray(appointments) ? appointments : []).filter(
    (row) => row.patientId === patientId && row.date === day
  );
  const active =
    todays.find((row) => row.status === "In Consultation") ||
    todays.find((row) => row.status === "Waiting" || row.status === "Triage / Vitals") ||
    todays[0];
  return active?.id || "";
}

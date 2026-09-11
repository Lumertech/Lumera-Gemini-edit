import type { Appointment, Doctor } from "../types";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addCalendarDays(from: Date, days: number): Date {
  const next = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

export function weekdayShort(date: Date): string {
  return WEEKDAY_SHORT[date.getDay()];
}

export function parseClockToMinutes(token: string): number | null {
  const match = token.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (hours === 12) hours = 0;
  if (meridiem === "PM") hours += 12;
  return hours * 60 + minutes;
}

export function minutesToClock(total: number): string {
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours24 = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  const meridiem = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${String(hours12).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}

export function parseOpdWindows(opdTiming: string): { startMin: number; endMin: number }[] {
  if (!opdTiming?.trim()) return [{ startMin: 9 * 60, endMin: 14 * 60 }];
  const windows: { startMin: number; endMin: number }[] = [];
  const chunks = opdTiming.split(/[,;]/);
  for (const chunk of chunks) {
    const parts = chunk.split(/\s*[-–—]\s*/);
    if (parts.length < 2) continue;
    const startMin = parseClockToMinutes(parts[0]);
    const endMin = parseClockToMinutes(parts[1]);
    if (startMin == null || endMin == null || endMin <= startMin) continue;
    windows.push({ startMin, endMin });
  }
  return windows.length ? windows : [{ startMin: 9 * 60, endMin: 14 * 60 }];
}

export function isDoctorAvailableOn(date: Date, availableDays: string[] | undefined): boolean {
  if (!availableDays?.length) return date.getDay() !== 0;
  const short = weekdayShort(date);
  return availableDays.some((day) => {
    const normalized = day.trim().slice(0, 3);
    return normalized.toLowerCase() === short.toLowerCase();
  });
}

export type FollowUpSlot = {
  timeSlot: string;
  available: boolean;
};

export function generateFollowUpSlots(options: {
  date: Date;
  doctor: Pick<Doctor, "id" | "opdTiming" | "slotDurationMinutes" | "availableDays">;
  appointments: Pick<Appointment, "date" | "timeSlot" | "doctorId" | "status">[];
}): FollowUpSlot[] {
  const { date, doctor, appointments } = options;
  if (!isDoctorAvailableOn(date, doctor.availableDays)) return [];
  const duration = Math.max(5, doctor.slotDurationMinutes || 15);
  const dateKey = isoDate(date);
  const occupied = new Set(
    appointments
      .filter(
        (apt) =>
          apt.doctorId === doctor.id &&
          apt.date === dateKey &&
          apt.status !== "Cancelled" &&
          apt.status !== "No-Show"
      )
      .map((apt) => apt.timeSlot.trim().toUpperCase())
  );
  const slots: FollowUpSlot[] = [];
  for (const window of parseOpdWindows(doctor.opdTiming)) {
    for (let t = window.startMin; t + duration <= window.endMin; t += duration) {
      const timeSlot = minutesToClock(t);
      slots.push({
        timeSlot,
        available: !occupied.has(timeSlot.toUpperCase()),
      });
    }
  }
  return slots;
}

export function followUpBookingRef(appointmentId: string, date: string, timeSlot: string): string {
  const short = appointmentId.replace(/^apt-/, "").slice(0, 8).toUpperCase();
  return `FU-${date.replace(/-/g, "")}-${timeSlot.replace(/[^0-9APMapm]/g, "")}-${short}`;
}

export function monthCells(year: number, monthIndex: number): (Date | null)[] {
  const first = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, monthIndex, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

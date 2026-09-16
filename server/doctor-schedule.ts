import { getDb } from "./db.ts";
import { ensureDoctorScheduleSchema } from "./doctor-schedule-schema.ts";
import type { SqlDatabase } from "./sql-engine.ts";

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const OVERRIDE_TYPES = ["BLOCKED", "CUSTOM_HOURS"] as const;
export type OverrideType = (typeof OVERRIDE_TYPES)[number];
export const SLOT_DURATIONS = [10, 15, 20, 30] as const;

export type ScheduleShift = {
  id?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
  isActive: boolean;
};

export type DaySchedule = {
  dayOfWeek: number;
  weekday: string;
  isActive: boolean;
  shifts: { id?: string; startTime: string; endTime: string }[];
  slotDurationMinutes: number;
};

export type DoctorOverrideRow = {
  id: string;
  doctorId: string;
  overrideDate: string;
  overrideType: OverrideType;
  customStartTime: string | null;
  customEndTime: string | null;
  reason: string | null;
  source: string;
  googleEventId: string | null;
};

export type TimeWindow = { startMin: number; endMin: number };

export type GeneratedSlot = {
  timeSlot: string;
  startTime: string;
  endTime: string;
  available: boolean;
  blockedReason?: "override" | "google_busy" | "booked";
};

export type BookedAppointment = {
  date: string;
  timeSlot: string;
  doctorId: string;
  status: string;
};

function db(): SqlDatabase {
  const database = getDb();
  ensureDoctorScheduleSchema(database);
  return database;
}

export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addCalendarDays(from: string, days: number): string {
  const [y, m, d] = from.split("-").map(Number);
  const next = new Date(y, m - 1, d);
  next.setDate(next.getDate() + days);
  return isoDate(next);
}

export function parseTimeToMinutes(token: string): number | null {
  const raw = String(token || "").trim();
  const hhmm = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const hours = Number(hhmm[1]);
    const minutes = Number(hhmm[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }
  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!ampm) return null;
  let hours = Number(ampm[1]);
  const minutes = Number(ampm[2]);
  const meridiem = ampm[3].toUpperCase();
  if (hours === 12) hours = 0;
  if (meridiem === "PM") hours += 12;
  return hours * 60 + minutes;
}

export function minutesToHHmm(total: number): string {
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function minutesToClock12(total: number): string {
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours24 = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  const meridiem = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${String(hours12).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}

export function normalizeHHmm(token: string): string | null {
  const minutes = parseTimeToMinutes(token);
  if (minutes == null) return null;
  return minutesToHHmm(minutes);
}

function windowsOverlap(a: TimeWindow, b: TimeWindow): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

function subtractWindows(source: TimeWindow[], blocked: TimeWindow[]): TimeWindow[] {
  let remaining = [...source];
  for (const block of blocked) {
    const next: TimeWindow[] = [];
    for (const win of remaining) {
      if (!windowsOverlap(win, block)) {
        next.push(win);
        continue;
      }
      if (win.startMin < block.startMin) {
        next.push({ startMin: win.startMin, endMin: Math.min(win.endMin, block.startMin) });
      }
      if (win.endMin > block.endMin) {
        next.push({ startMin: Math.max(win.startMin, block.endMin), endMin: win.endMin });
      }
    }
    remaining = next.filter((w) => w.endMin - w.startMin >= 1);
  }
  return remaining;
}

export function doctorBelongsToTenant(doctorId: string, tenantId: string): boolean {
  if (!doctorId || !tenantId) return false;
  const row = db()
    .prepare(
      `SELECT d.id FROM doctors d
       LEFT JOIN users u ON u.id = d.user_id
       WHERE d.id = ? AND (
         u.tenant_id = ?
         OR EXISTS (SELECT 1 FROM users u2 WHERE u2.id = d.id AND u2.tenant_id = ?)
       )`
    )
    .get(doctorId, tenantId, tenantId) as { id?: string } | undefined;
  return Boolean(row?.id);
}

export function findDoctorIdForUser(userId: string, tenantId?: string): string | null {
  if (!userId) return null;
  const byUser = db()
    .prepare("SELECT id FROM doctors WHERE user_id = ? LIMIT 1")
    .get(userId) as { id?: string } | undefined;
  if (byUser?.id) return String(byUser.id);
  const byId = db()
    .prepare("SELECT id FROM doctors WHERE id = ? LIMIT 1")
    .get(userId) as { id?: string } | undefined;
  if (byId?.id) return String(byId.id);
  if (tenantId) {
    const any = db()
      .prepare(
        `SELECT d.id FROM doctors d
         JOIN users u ON u.id = d.user_id
         WHERE u.tenant_id = ?
         ORDER BY d.name ASC
         LIMIT 1`
      )
      .get(tenantId) as { id?: string } | undefined;
    if (any?.id) return String(any.id);
  }
  return null;
}

export function resolveDoctorId(opts: {
  userId: string;
  tenantId: string;
  requestedDoctorId?: string;
  requireExplicit?: boolean;
}): string {
  const requested = String(opts.requestedDoctorId || "").trim();
  if (requested) {
    if (!doctorBelongsToTenant(requested, opts.tenantId) && requested !== opts.userId) {
      const own = findDoctorIdForUser(opts.userId, opts.tenantId);
      if (own !== requested) {
        throw Object.assign(new Error("Doctor not found in this clinic."), { status: 404 });
      }
    }
    return requested;
  }
  const fallback = findDoctorIdForUser(opts.userId, opts.tenantId);
  if (!fallback) {
    throw Object.assign(new Error("doctorId is required."), { status: 400 });
  }
  return fallback;
}

function mapScheduleRow(row: Record<string, unknown>): ScheduleShift {
  return {
    id: String(row.id),
    dayOfWeek: Number(row.day_of_week),
    startTime: String(row.start_time),
    endTime: String(row.end_time),
    slotDurationMinutes: Number(row.slot_duration_minutes || 15),
    isActive: Number(row.is_active) !== 0,
  };
}

function mapOverrideRow(row: Record<string, unknown>): DoctorOverrideRow {
  const type = String(row.override_type || "BLOCKED").toUpperCase();
  return {
    id: String(row.id),
    doctorId: String(row.doctor_id),
    overrideDate: String(row.override_date),
    overrideType: type === "CUSTOM_HOURS" ? "CUSTOM_HOURS" : "BLOCKED",
    customStartTime: row.custom_start_time ? String(row.custom_start_time) : null,
    customEndTime: row.custom_end_time ? String(row.custom_end_time) : null,
    reason: row.reason ? String(row.reason) : null,
    source: String(row.source || "manual"),
    googleEventId: row.google_event_id ? String(row.google_event_id) : null,
  };
}

export function listSchedules(doctorId: string): ScheduleShift[] {
  const rows = db()
    .prepare(
      `SELECT * FROM doctor_schedules
       WHERE doctor_id = ?
       ORDER BY day_of_week ASC, start_time ASC`
    )
    .all(doctorId) as Record<string, unknown>[];
  return rows.map(mapScheduleRow);
}

export function listOverrides(
  doctorId: string,
  opts?: { from?: string; to?: string; includeGoogleBusy?: boolean }
): DoctorOverrideRow[] {
  let sql = `SELECT * FROM doctor_overrides WHERE doctor_id = ?`;
  const params: unknown[] = [doctorId];
  if (!opts?.includeGoogleBusy) {
    sql += ` AND COALESCE(source, 'manual') != 'google_busy'`;
  }
  if (opts?.from) {
    sql += ` AND override_date >= ?`;
    params.push(opts.from);
  }
  if (opts?.to) {
    sql += ` AND override_date <= ?`;
    params.push(opts.to);
  }
  sql += ` ORDER BY override_date ASC, custom_start_time ASC`;
  const rows = db().prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(mapOverrideRow);
}

export function groupWeeklySchedule(shifts: ScheduleShift[], fallbackDuration = 15): DaySchedule[] {
  const duration =
    shifts.find((s) => s.slotDurationMinutes)?.slotDurationMinutes || fallbackDuration;
  return WEEKDAY_SHORT.map((weekday, dayOfWeek) => {
    const dayShifts = shifts.filter((s) => s.dayOfWeek === dayOfWeek);
    const isActive = dayShifts.some((s) => s.isActive);
    return {
      dayOfWeek,
      weekday,
      isActive,
      slotDurationMinutes: dayShifts[0]?.slotDurationMinutes || duration,
      shifts: dayShifts
        .filter((s) => s.isActive)
        .map((s) => ({ id: s.id, startTime: s.startTime, endTime: s.endTime })),
    };
  });
}

function parseOpdWindows(opdTiming: string): TimeWindow[] {
  if (!opdTiming?.trim()) return [{ startMin: 9 * 60, endMin: 13 * 60 }];
  const windows: TimeWindow[] = [];
  for (const chunk of opdTiming.split(/[,;]/)) {
    const parts = chunk.split(/\s*[-–—]\s*/);
    if (parts.length < 2) continue;
    const startMin = parseTimeToMinutes(parts[0]);
    const endMin = parseTimeToMinutes(parts[1]);
    if (startMin == null || endMin == null || endMin <= startMin) continue;
    windows.push({ startMin, endMin });
  }
  return windows.length ? windows : [{ startMin: 9 * 60, endMin: 13 * 60 }];
}

export function seedScheduleFromDoctorProfile(doctorId: string): ScheduleShift[] {
  const existing = listSchedules(doctorId);
  if (existing.length) return existing;
  const doctor = db()
    .prepare("SELECT available_days, opd_timing, slot_duration_minutes FROM doctors WHERE id = ?")
    .get(doctorId) as
    | { available_days?: string; opd_timing?: string; slot_duration_minutes?: number }
    | undefined;
  if (!doctor) return [];
  let days: string[] = [];
  try {
    days = JSON.parse(String(doctor.available_days || "[]"));
  } catch {
    days = [];
  }
  const activeDow = new Set<number>();
  if (days.length) {
    for (const day of days) {
      const short = String(day).trim().slice(0, 3);
      const idx = WEEKDAY_SHORT.findIndex((w) => w.toLowerCase() === short.toLowerCase());
      if (idx >= 0) activeDow.add(idx);
    }
  } else {
    for (let i = 1; i <= 6; i++) activeDow.add(i);
  }
  const windows = parseOpdWindows(String(doctor.opd_timing || ""));
  const duration = Number(doctor.slot_duration_minutes || 15) || 15;
  const now = new Date().toISOString();
  for (let dow = 0; dow <= 6; dow++) {
    if (!activeDow.has(dow)) continue;
    for (const win of windows) {
      db()
        .prepare(
          `INSERT INTO doctor_schedules (
            id, doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(
          crypto.randomUUID(),
          doctorId,
          dow,
          minutesToHHmm(win.startMin),
          minutesToHHmm(win.endMin),
          duration,
          now,
          now
        );
    }
  }
  return listSchedules(doctorId);
}

function summarizeOpdTiming(days: DaySchedule[]): string {
  const unique = new Map<string, string>();
  for (const day of days) {
    if (!day.isActive) continue;
    for (const shift of day.shifts) {
      const start = parseTimeToMinutes(shift.startTime);
      const end = parseTimeToMinutes(shift.endTime);
      if (start == null || end == null) continue;
      const label = `${minutesToClock12(start)} - ${minutesToClock12(end)}`;
      unique.set(label, label);
    }
  }
  return [...unique.values()].join(", ");
}

export function replaceWeeklySchedule(opts: {
  doctorId: string;
  slotDurationMinutes?: number;
  days: Array<{
    dayOfWeek: number;
    isActive?: boolean;
    shifts?: Array<{ startTime: string; endTime: string }>;
    slotDurationMinutes?: number;
  }>;
}): DaySchedule[] {
  const durationRaw = Number(opts.slotDurationMinutes || 15);
  const duration = SLOT_DURATIONS.includes(durationRaw as (typeof SLOT_DURATIONS)[number])
    ? durationRaw
    : durationRaw >= 5 && durationRaw <= 120
      ? Math.round(durationRaw)
      : 15;
  const now = new Date().toISOString();
  db().prepare("DELETE FROM doctor_schedules WHERE doctor_id = ?").run(opts.doctorId);

  const byDay = new Map<number, { isActive: boolean; shifts: { startTime: string; endTime: string }[] }>();
  for (let dow = 0; dow <= 6; dow++) {
    byDay.set(dow, { isActive: false, shifts: [] });
  }
  for (const day of opts.days || []) {
    const dow = Number(day.dayOfWeek);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) continue;
    const shifts: { startTime: string; endTime: string }[] = [];
    for (const shift of day.shifts || []) {
      const start = normalizeHHmm(shift.startTime);
      const end = normalizeHHmm(shift.endTime);
      if (!start || !end) continue;
      const startMin = parseTimeToMinutes(start)!;
      const endMin = parseTimeToMinutes(end)!;
      if (endMin <= startMin) {
        throw Object.assign(new Error(`Shift end must be after start (${start}–${end}).`), { status: 400 });
      }
      shifts.push({ startTime: start, endTime: end });
    }
    byDay.set(dow, { isActive: day.isActive !== false && shifts.length > 0, shifts });
  }

  for (const [dow, day] of byDay) {
    if (!day.isActive) continue;
    for (const shift of day.shifts) {
      db()
        .prepare(
          `INSERT INTO doctor_schedules (
            id, doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(crypto.randomUUID(), opts.doctorId, dow, shift.startTime, shift.endTime, duration, now, now);
    }
  }

  const grouped = groupWeeklySchedule(listSchedules(opts.doctorId), duration);
  const availableDays = grouped.filter((d) => d.isActive).map((d) => d.weekday);
  try {
    db()
      .prepare(
        `UPDATE doctors SET slot_duration_minutes = ?, available_days = ?, opd_timing = ? WHERE id = ?`
      )
      .run(duration, JSON.stringify(availableDays), summarizeOpdTiming(grouped), opts.doctorId);
  } catch {
    /* older doctors tables without slot_duration_minutes */
  }
  return grouped;
}

export function addOverrides(opts: {
  doctorId: string;
  startDate: string;
  endDate?: string;
  overrideType: OverrideType;
  customStartTime?: string | null;
  customEndTime?: string | null;
  reason?: string | null;
  source?: string;
  googleEventId?: string | null;
}): DoctorOverrideRow[] {
  const type = opts.overrideType === "CUSTOM_HOURS" ? "CUSTOM_HOURS" : "BLOCKED";
  const start = String(opts.startDate || "").slice(0, 10);
  const end = String(opts.endDate || opts.startDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw Object.assign(new Error("overrideDate must be YYYY-MM-DD."), { status: 400 });
  }
  if (end < start) {
    throw Object.assign(new Error("endDate must be on or after startDate."), { status: 400 });
  }
  let customStart: string | null = null;
  let customEnd: string | null = null;
  if (type === "CUSTOM_HOURS" || opts.customStartTime || opts.customEndTime) {
    customStart = opts.customStartTime ? normalizeHHmm(opts.customStartTime) : null;
    customEnd = opts.customEndTime ? normalizeHHmm(opts.customEndTime) : null;
    if (type === "CUSTOM_HOURS" && (!customStart || !customEnd)) {
      throw Object.assign(new Error("CUSTOM_HOURS requires customStartTime and customEndTime."), { status: 400 });
    }
    if (customStart && customEnd && parseTimeToMinutes(customEnd)! <= parseTimeToMinutes(customStart)!) {
      throw Object.assign(new Error("customEndTime must be after customStartTime."), { status: 400 });
    }
  }
  const now = new Date().toISOString();
  const created: DoctorOverrideRow[] = [];
  for (let date = start; date <= end; date = addCalendarDays(date, 1)) {
    const id = crypto.randomUUID();
    db()
      .prepare(
        `INSERT INTO doctor_overrides (
          id, doctor_id, override_date, override_type, custom_start_time, custom_end_time,
          reason, source, google_event_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        opts.doctorId,
        date,
        type,
        customStart,
        customEnd,
        opts.reason ? String(opts.reason) : null,
        opts.source || "manual",
        opts.googleEventId || null,
        now,
        now
      );
    created.push(mapOverrideRow(db().prepare("SELECT * FROM doctor_overrides WHERE id = ?").get(id) as Record<string, unknown>));
  }
  return created;
}

export function removeOverride(opts: { doctorId: string; id?: string; startDate?: string; endDate?: string }): number {
  if (opts.id) {
    const result = db()
      .prepare("DELETE FROM doctor_overrides WHERE id = ? AND doctor_id = ? AND COALESCE(source, 'manual') != 'google_busy'")
      .run(opts.id, opts.doctorId);
    return Number(result.changes || 0);
  }
  const start = String(opts.startDate || "").slice(0, 10);
  const end = String(opts.endDate || opts.startDate || "").slice(0, 10);
  if (!start) {
    throw Object.assign(new Error("id or startDate is required to remove an override."), { status: 400 });
  }
  const result = db()
    .prepare(
      `DELETE FROM doctor_overrides
       WHERE doctor_id = ? AND override_date >= ? AND override_date <= ?
         AND COALESCE(source, 'manual') != 'google_busy'`
    )
    .run(opts.doctorId, start, end);
  return Number(result.changes || 0);
}

export function replaceGoogleBusyOverrides(
  doctorId: string,
  blocks: Array<{ date: string; startTime: string; endTime: string; eventId?: string }>
): void {
  db()
    .prepare("DELETE FROM doctor_overrides WHERE doctor_id = ? AND source = 'google_busy'")
    .run(doctorId);
  const now = new Date().toISOString();
  for (const block of blocks) {
    const start = normalizeHHmm(block.startTime);
    const end = normalizeHHmm(block.endTime);
    if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(block.date)) continue;
    db()
      .prepare(
        `INSERT INTO doctor_overrides (
          id, doctor_id, override_date, override_type, custom_start_time, custom_end_time,
          reason, source, google_event_id, created_at, updated_at
        ) VALUES (?, ?, ?, 'BLOCKED', ?, ?, 'Google Calendar busy', 'google_busy', ?, ?, ?)`
      )
      .run(crypto.randomUUID(), doctorId, block.date, start, end, block.eventId || null, now, now);
  }
}

export function listBookedAppointments(tenantId: string, doctorId: string, date: string): BookedAppointment[] {
  const rows = db()
    .prepare(
      `SELECT date, time_slot, doctor_id, status
       FROM appointments
       WHERE tenant_id = ? AND doctor_id = ? AND date = ?`
    )
    .all(tenantId, doctorId, date) as Record<string, unknown>[];
  return rows.map((row) => ({
    date: String(row.date),
    timeSlot: String(row.time_slot || ""),
    doctorId: String(row.doctor_id || ""),
    status: String(row.status || ""),
  }));
}

/**
 * Available slots = (recurring shifts ∖ Lumera overrides ∖ Google busy) ∖ booked appointments.
 */
export function generateAvailableSlots(opts: {
  date: string | Date;
  schedules: ScheduleShift[];
  overrides: DoctorOverrideRow[];
  appointments?: BookedAppointment[];
  doctorId: string;
  includeUnavailable?: boolean;
}): GeneratedSlot[] {
  const date = typeof opts.date === "string" ? opts.date : isoDate(opts.date);
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  const dayOverrides = opts.overrides.filter((o) => o.overrideDate === date);
  const fullBlock = dayOverrides.find(
    (o) => o.overrideType === "BLOCKED" && o.source !== "google_busy" && !o.customStartTime
  );
  if (fullBlock) return [];

  const customHours = dayOverrides.filter((o) => o.overrideType === "CUSTOM_HOURS");
  const duration =
    opts.schedules.find((s) => s.dayOfWeek === dow)?.slotDurationMinutes ||
    opts.schedules[0]?.slotDurationMinutes ||
    15;

  let windows: TimeWindow[] = [];
  if (customHours.length) {
    for (const row of customHours) {
      const startMin = parseTimeToMinutes(String(row.customStartTime || ""));
      const endMin = parseTimeToMinutes(String(row.customEndTime || ""));
      if (startMin != null && endMin != null && endMin > startMin) {
        windows.push({ startMin, endMin });
      }
    }
  } else {
    windows = opts.schedules
      .filter((s) => s.dayOfWeek === dow && s.isActive)
      .map((s) => ({
        startMin: parseTimeToMinutes(s.startTime) ?? 0,
        endMin: parseTimeToMinutes(s.endTime) ?? 0,
      }))
      .filter((w) => w.endMin > w.startMin);
  }

  const lumeraBlocks: TimeWindow[] = dayOverrides
    .filter((o) => o.overrideType === "BLOCKED" && o.source !== "google_busy" && o.customStartTime)
    .map((o) => ({
      startMin: parseTimeToMinutes(String(o.customStartTime)) ?? 0,
      endMin: parseTimeToMinutes(String(o.customEndTime || "23:59")) ?? 24 * 60,
    }))
    .filter((w) => w.endMin > w.startMin);

  const googleBlocks: TimeWindow[] = dayOverrides
    .filter((o) => o.source === "google_busy")
    .map((o) => ({
      startMin: parseTimeToMinutes(String(o.customStartTime || "00:00")) ?? 0,
      endMin: parseTimeToMinutes(String(o.customEndTime || "23:59")) ?? 24 * 60,
    }))
    .filter((w) => w.endMin > w.startMin);

  const afterOverrides = subtractWindows(windows, lumeraBlocks);
  const afterBusy = subtractWindows(afterOverrides, googleBlocks);

  const occupied = new Set(
    (opts.appointments || [])
      .filter(
        (apt) =>
          apt.doctorId === opts.doctorId &&
          apt.date === date &&
          apt.status !== "Cancelled" &&
          apt.status !== "No-Show"
      )
      .map((apt) => {
        const minutes = parseTimeToMinutes(apt.timeSlot);
        return minutes == null ? apt.timeSlot.trim().toUpperCase() : minutesToClock12(minutes).toUpperCase();
      })
  );

  const slots: GeneratedSlot[] = [];
  const seen = new Set<number>();
  const emitFrom = (sourceWindows: TimeWindow[], available: boolean, reason?: GeneratedSlot["blockedReason"]) => {
    for (const win of sourceWindows) {
      for (let t = win.startMin; t + duration <= win.endMin; t += duration) {
        if (seen.has(t)) continue;
        seen.add(t);
        const clock = minutesToClock12(t);
        const booked = occupied.has(clock.toUpperCase());
        slots.push({
          timeSlot: clock,
          startTime: minutesToHHmm(t),
          endTime: minutesToHHmm(t + duration),
          available: available && !booked,
          blockedReason: booked ? "booked" : available ? undefined : reason,
        });
      }
    }
  };

  emitFrom(afterBusy, true);
  if (opts.includeUnavailable) {
    emitFrom(subtractWindows(afterOverrides, []).filter((w) => !afterBusy.some((b) => b.startMin === w.startMin && b.endMin === w.endMin)), false, "google_busy");
  }
  slots.sort((a, b) => parseTimeToMinutes(a.startTime)! - parseTimeToMinutes(b.startTime)!);
  return slots;
}

export function slotsForDoctorDate(opts: {
  tenantId: string;
  doctorId: string;
  date: string;
  includeGoogleBusy?: boolean;
}): GeneratedSlot[] {
  const schedules = seedScheduleFromDoctorProfile(opts.doctorId);
  const overrides = listOverrides(opts.doctorId, {
    from: opts.date,
    to: opts.date,
    includeGoogleBusy: opts.includeGoogleBusy !== false,
  });
  const appointments = listBookedAppointments(opts.tenantId, opts.doctorId, opts.date);
  return generateAvailableSlots({
    date: opts.date,
    schedules,
    overrides,
    appointments,
    doctorId: opts.doctorId,
  });
}

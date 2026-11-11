import { type SqlDatabase } from "./sql-engine.ts";
import { getDb } from "./db.ts";

export interface ClinicScheduleSettings {
  tenantId: string;
  doctorId: string; // '' means clinic-wide default
  slotDurationMinutes: number; // default 15
  slotOverlapMax: number; // default 1 (max appointments for the same slot)
  opdStartTime: string; // default "09:00 AM"
  opdEndTime: string; // default "05:00 PM"
  updatedAt: string;
}

export function ensureClinicScheduleSettingsTable(db: SqlDatabase = getDb()) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS clinic_schedule_settings (
        tenant_id TEXT NOT NULL,
        doctor_id TEXT NOT NULL DEFAULT '',
        slot_duration_minutes INTEGER NOT NULL DEFAULT 15,
        slot_overlap_max INTEGER NOT NULL DEFAULT 1,
        opd_start_time TEXT NOT NULL DEFAULT '09:00 AM',
        opd_end_time TEXT NOT NULL DEFAULT '05:00 PM',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, doctor_id)
      );
    `);
  } catch {
    /* ignore if exists or in memory test */
  }
}

export function getClinicScheduleSettings(
  db: SqlDatabase = getDb(),
  tenantId: string,
  doctorId = ""
): ClinicScheduleSettings {
  ensureClinicScheduleSettingsTable(db);
  const tid = String(tenantId || "").trim();
  const did = String(doctorId || "").trim();

  // 1. Try doctor-specific override if doctorId provided
  if (did) {
    try {
      const row = db
        .prepare(
          `SELECT * FROM clinic_schedule_settings
           WHERE tenant_id = ? AND doctor_id = ?`
        )
        .get(tid, did) as Record<string, unknown> | undefined;
      if (row) {
        return {
          tenantId: tid,
          doctorId: did,
          slotDurationMinutes: Math.max(1, Number(row.slot_duration_minutes || 15)),
          slotOverlapMax: Math.max(1, Number(row.slot_overlap_max || 1)),
          opdStartTime: String(row.opd_start_time || "09:00 AM").trim(),
          opdEndTime: String(row.opd_end_time || "05:00 PM").trim(),
          updatedAt: String(row.updated_at || ""),
        };
      }
    } catch {
      /* ignore */
    }
  }

  // 2. Try clinic-wide default (doctorId = '')
  try {
    const row = db
      .prepare(
        `SELECT * FROM clinic_schedule_settings
         WHERE tenant_id = ? AND doctor_id = ''`
      )
      .get(tid) as Record<string, unknown> | undefined;
    if (row) {
      return {
        tenantId: tid,
        doctorId: "",
        slotDurationMinutes: Math.max(1, Number(row.slot_duration_minutes || 15)),
        slotOverlapMax: Math.max(1, Number(row.slot_overlap_max || 1)),
        opdStartTime: String(row.opd_start_time || "09:00 AM").trim(),
        opdEndTime: String(row.opd_end_time || "05:00 PM").trim(),
        updatedAt: String(row.updated_at || ""),
      };
    }
  } catch {
    /* ignore */
  }

  // 3. Fallback defaults
  return {
    tenantId: tid,
    doctorId: did,
    slotDurationMinutes: 15,
    slotOverlapMax: 1,
    opdStartTime: "09:00 AM",
    opdEndTime: "05:00 PM",
    updatedAt: new Date().toISOString(),
  };
}

export function saveClinicScheduleSettings(
  db: SqlDatabase = getDb(),
  tenantId: string,
  settings: {
    doctorId?: string;
    slotDurationMinutes?: number;
    slotOverlapMax?: number;
    opdStartTime?: string;
    opdEndTime?: string;
  }
): ClinicScheduleSettings {
  ensureClinicScheduleSettingsTable(db);
  const tid = String(tenantId || "").trim();
  const did = String(settings.doctorId || "").trim();
  const current = getClinicScheduleSettings(db, tid, did);

  const duration = settings.slotDurationMinutes !== undefined
    ? Math.max(1, Math.min(240, Number(settings.slotDurationMinutes) || 15))
    : current.slotDurationMinutes;

  const overlap = settings.slotOverlapMax !== undefined
    ? Math.max(1, Math.min(50, Number(settings.slotOverlapMax) || 1))
    : current.slotOverlapMax;

  const startTime = (settings.opdStartTime || current.opdStartTime || "09:00 AM").trim();
  const endTime = (settings.opdEndTime || current.opdEndTime || "05:00 PM").trim();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO clinic_schedule_settings (
      tenant_id, doctor_id, slot_duration_minutes, slot_overlap_max,
      opd_start_time, opd_end_time, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, doctor_id) DO UPDATE SET
      slot_duration_minutes = excluded.slot_duration_minutes,
      slot_overlap_max = excluded.slot_overlap_max,
      opd_start_time = excluded.opd_start_time,
      opd_end_time = excluded.opd_end_time,
      updated_at = excluded.updated_at
  `).run(tid, did, duration, overlap, startTime, endTime, now);

  return {
    tenantId: tid,
    doctorId: did,
    slotDurationMinutes: duration,
    slotOverlapMax: overlap,
    opdStartTime: startTime,
    opdEndTime: endTime,
    updatedAt: now,
  };
}

export interface SlotOccupancyItem {
  timeSlot: string;
  bookedCount: number;
  maxOverlap: number;
  isAvailable: boolean;
  appointments: Array<{
    id: string;
    tokenNumber: number;
    patientName: string;
    patientPhone?: string;
    uhid?: string;
    status: string;
    type?: string;
    doctorName?: string;
  }>;
}

export function parseTimeToMinutes(timeStr: string, defaultMinutes = 540): number {
  const match = String(timeStr || "").match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return defaultMinutes;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const ampm = (match[3] || "").toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return h * 60 + m;
}

/**
 * Completed, Cancelled, and No-Show do not take a bookable chair.
 * Slot search and the calendar occupancy count must use this same list.
 */
export const SCHEDULE_SLOT_FREE_STATUSES = ["Completed", "Cancelled", "No-Show"] as const;

export function scheduleSlotFreeStatusSql(column = "status"): string {
  return `${column} NOT IN ('Completed', 'Cancelled', 'No-Show')`;
}

/** Minutes since midnight in Asia/Kolkata. */
export function istClockMinutes(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  let hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  if (!Number.isFinite(hour) || hour === 24) hour = 0;
  if (!Number.isFinite(minute)) return hour * 60;
  return hour * 60 + minute;
}

export function formatMinutesToTime(totalMins: number): string {
  const minsInDay = ((totalMins % 1440) + 1440) % 1440;
  const slotHour = Math.floor(minsInDay / 60);
  const slotMin = minsInDay % 60;
  const ampm = slotHour >= 12 ? "PM" : "AM";
  const displayHour = slotHour % 12 === 0 ? 12 : slotHour % 12;
  const displayMin = slotMin < 10 ? `0${slotMin}` : `${slotMin}`;
  const formattedH = displayHour < 10 ? `0${displayHour}` : `${displayHour}`;
  return `${formattedH}:${displayMin} ${ampm}`;
}

export function listSlotOccupancy(
  db: SqlDatabase = getDb(),
  opts: {
    tenantId: string;
    date: string;
    doctorId?: string;
    includePrivateDetails?: boolean;
  }
): {
  settings: ClinicScheduleSettings;
  date: string;
  slots: SlotOccupancyItem[];
} {
  const tid = String(opts.tenantId || "").trim();
  const date = String(opts.date || "").trim();
  const did = String(opts.doctorId || "").trim();
  const isStaff = Boolean(opts.includePrivateDetails);

  const settings = getClinicScheduleSettings(db, tid, did);
  const duration = settings.slotDurationMinutes;
  const maxOverlap = settings.slotOverlapMax;

  let startMinutes = parseTimeToMinutes(settings.opdStartTime, 540); // 09:00 AM
  let endMinutes = parseTimeToMinutes(settings.opdEndTime, 1020); // 05:00 PM
  if (endMinutes <= startMinutes) {
    endMinutes = startMinutes + 8 * 60; // 8-hour fallback
  }

  // Query appointments strictly scoped to tenant and date
  let rows: Array<Record<string, unknown>> = [];
  try {
    if (did) {
      rows = db
        .prepare(
          `SELECT * FROM appointments
           WHERE tenant_id = ? AND date = ? AND (doctor_id = ? OR doctor_name = ?)
             AND ${scheduleSlotFreeStatusSql("status")}
           ORDER BY token_number ASC`
        )
        .all(tid, date, did, did) as Array<Record<string, unknown>>;
    } else {
      rows = db
        .prepare(
          `SELECT * FROM appointments
           WHERE tenant_id = ? AND date = ?
             AND ${scheduleSlotFreeStatusSql("status")}
           ORDER BY token_number ASC`
        )
        .all(tid, date) as Array<Record<string, unknown>>;
    }
  } catch {
    rows = [];
  }

  // Normalize booked appointments by slot
  const slotMap = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const rawSlot = String(row.time_slot || "").trim();
    if (!rawSlot) continue;
    // Normalize format e.g. "9:00 AM" -> "09:00 AM"
    const mins = parseTimeToMinutes(rawSlot, -1);
    const normalizedKey = mins >= 0 ? formatMinutesToTime(mins) : rawSlot;
    const list = slotMap.get(normalizedKey) || [];
    list.push(row);
    slotMap.set(normalizedKey, list);
  }

  const slots: SlotOccupancyItem[] = [];
  for (let m = startMinutes; m < endMinutes; m += duration) {
    const slotTime = formatMinutesToTime(m);
    const booked = slotMap.get(slotTime) || [];
    const count = booked.length;

    slots.push({
      timeSlot: slotTime,
      bookedCount: count,
      maxOverlap,
      isAvailable: count < maxOverlap,
      appointments: isStaff
        ? booked.map((b) => ({
            id: String(b.id || ""),
            tokenNumber: Number(b.token_number || 0),
            patientName: String(b.patient_name || ""),
            patientPhone: String(b.patient_phone || ""),
            uhid: String(b.uhid || ""),
            status: String(b.status || "Waiting"),
            type: String(b.type || "New Consultation"),
            doctorName: String(b.doctor_name || ""),
          }))
        : [],
    });
  }

  return { settings, date, slots };
}

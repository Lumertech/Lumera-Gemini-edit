/**
 * Live OPD snapshot for one visit. Counts stay inside the link's tenant and doctor.
 * Hidden ambient walk-ins are not a queue position.
 */
import type { SqlDatabase } from "./sql-engine.ts";
import { HIDDEN_AMBIENT_SOURCES, hiddenVisitSourceSql } from "./ambient-walkin.ts";
import { getClinicScheduleSettings, istClockMinutes, parseTimeToMinutes } from "./clinic-schedule.ts";
import { clinicCalendarDate } from "../src/lib/clinicDay.ts";

const IN_LINE = new Set(["Waiting", "Triage / Vitals", "In Consultation"]);

export type QueueSnapshot = {
  appointmentId: string;
  yourToken: number;
  yourStatus: string;
  currentToken: number;
  peopleAhead: number;
  etaMinutes: number | null;
  clinicOpen: boolean;
  clinicName: string;
  doctorName: string;
  visitDate: string;
  visitIsToday: boolean;
  slotMinutes: number;
};

type QueueRow = { token_number: number; status: string };

function padToken(token: number): string {
  if (!Number.isFinite(token) || token <= 0) return "—";
  return String(token).padStart(2, "0");
}

export function formatQueueToken(token: number): string {
  return padToken(token);
}

function clinicTimezone(db: SqlDatabase, tenantId: string): string {
  try {
    const row = db.prepare("SELECT timezone FROM tenants WHERE id = ?").get(tenantId) as { timezone?: string } | undefined;
    return String(row?.timezone || "IST (UTC+5:30)");
  } catch {
    return "IST (UTC+5:30)";
  }
}

function clinicName(db: SqlDatabase, tenantId: string): string {
  try {
    const row = db.prepare("SELECT name FROM tenants WHERE id = ?").get(tenantId) as { name?: string } | undefined;
    const name = String(row?.name || "").trim();
    return name || "your clinic";
  } catch {
    return "your clinic";
  }
}

export function describeLiveQueue(
  db: SqlDatabase,
  input: {
    tenantId: string;
    doctorId: string;
    doctorName?: string;
    date: string;
    tokenNumber: number;
    status: string;
    appointmentId: string;
  },
  now = new Date()
): QueueSnapshot {
  const tenantId = String(input.tenantId || "").trim();
  const doctorId = String(input.doctorId || "").trim();
  const date = String(input.date || "").trim();
  const yourToken = Number(input.tokenNumber) || 0;
  const yourStatus = String(input.status || "");
  let rows: QueueRow[] = [];
  try {
    rows = db
      .prepare(
        `SELECT token_number, status FROM appointments
         WHERE tenant_id = ? AND doctor_id = ? AND date = ? AND ${hiddenVisitSourceSql()}
         ORDER BY token_number ASC`
      )
      .all(tenantId, doctorId, date, ...HIDDEN_AMBIENT_SOURCES) as QueueRow[];
  } catch {
    rows = [];
  }

  const inConsult = rows
    .filter((row) => row.status === "In Consultation")
    .map((row) => Number(row.token_number) || 0)
    .filter((token) => token > 0)
    .sort((a, b) => a - b);
  const waiting = rows
    .filter((row) => row.status === "Waiting" || row.status === "Triage / Vitals")
    .map((row) => Number(row.token_number) || 0)
    .filter((token) => token > 0)
    .sort((a, b) => a - b);
  const completed = rows
    .filter((row) => row.status === "Completed")
    .map((row) => Number(row.token_number) || 0);
  const currentToken = inConsult[0] || waiting[0] || (completed.length ? Math.max(...completed) : 0);

  const peopleAhead =
    yourStatus === "In Consultation"
      ? 0
      : rows.filter((row) => IN_LINE.has(String(row.status)) && Number(row.token_number) < yourToken).length;

  const settings = getClinicScheduleSettings(db, tenantId, doctorId);
  const slotMinutes = Math.max(1, settings.slotDurationMinutes || 15);
  let start = parseTimeToMinutes(settings.opdStartTime, 9 * 60);
  let end = parseTimeToMinutes(settings.opdEndTime, 17 * 60);
  if (end <= start) end = start + 8 * 60;
  const timezone = clinicTimezone(db, tenantId);
  const today = clinicCalendarDate(now, timezone);
  const visitIsToday = date === today;
  const nowMinutes = istClockMinutes(now);
  const clinicOpen = visitIsToday && nowMinutes >= start && nowMinutes < end;
  const etaMinutes = !clinicOpen ? null : yourStatus === "In Consultation" || peopleAhead === 0 ? 0 : peopleAhead * slotMinutes;

  const doctorName = String(input.doctorName || "").trim() || "your doctor";
  return {
    appointmentId: String(input.appointmentId || ""),
    yourToken,
    yourStatus,
    currentToken,
    peopleAhead,
    etaMinutes,
    clinicOpen,
    clinicName: clinicName(db, tenantId),
    doctorName,
    visitDate: date,
    visitIsToday,
    slotMinutes,
  };
}

export function queueSnapshotFromAppointment(db: SqlDatabase, row: Record<string, unknown>, now = new Date()): QueueSnapshot {
  return describeLiveQueue(
    db,
    {
      tenantId: String(row.tenant_id || row.tenantId || ""),
      doctorId: String(row.doctor_id || row.doctorId || ""),
      doctorName: String(row.doctor_name || row.doctorName || ""),
      date: String(row.date || ""),
      tokenNumber: Number(row.token_number ?? row.tokenNumber ?? 0),
      status: String(row.status || ""),
      appointmentId: String(row.id || ""),
    },
    now
  );
}

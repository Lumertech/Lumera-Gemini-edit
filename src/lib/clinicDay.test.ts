import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  appointmentIdForBillContext,
  appointmentsForClinicDay,
  clinicCalendarDate,
  clinicDateFromIso,
  clinicDayUtcBounds,
  clinicToday,
  formatClinicDateLabel,
  formatClinicDayLabel,
  formatClinicMonthLabel,
  parseAppointmentListDate,
  resolveQueueDate,
  shiftIsoDate,
} from "./clinicDay";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const queueUi = fs.readFileSync(path.join(__dirname, "../components/QueueBoard.tsx"), "utf8");
const appUi = fs.readFileSync(path.join(__dirname, "../ClinicianApp.tsx"), "utf8");
const clinical = fs.readFileSync(path.join(__dirname, "../../server/clinical.ts"), "utf8");

describe("clinic day queue filter", () => {
  it("uses IST for the clinic day when UTC is still the previous date", () => {
    const now = new Date("2026-10-14T19:00:00.000Z");
    assert.equal(clinicCalendarDate(now, "IST (UTC+5:30)"), "2026-10-15");
    assert.equal(clinicCalendarDate(now, "Asia/Kolkata"), "2026-10-15");
    assert.equal(clinicCalendarDate(now), "2026-10-15");
    assert.equal(clinicCalendarDate(now, "UTC (UTC+0:00)"), "2026-10-14");
    assert.equal(shiftIsoDate("2026-10-15", -1), "2026-10-14");
    assert.equal(resolveQueueDate("2026-10-18T19:00:00.000Z"), "2026-10-19");
    assert.equal(resolveQueueDate("2026-10-18T19:00:00.000Z", "IST (UTC+5:30)"), "2026-10-19");
    assert.equal(resolveQueueDate("2026-10-14"), "2026-10-14");
    assert.equal(resolveQueueDate("", null, new Date("2026-10-18T19:00:00.000Z")), "2026-10-19");
    assert.deepEqual(clinicDayUtcBounds("2026-10-19", "IST (UTC+5:30)"), {
      start: "2026-10-18T18:30:00.000Z",
      end: "2026-10-19T18:30:00.000Z",
    });
    assert.equal(clinicDayUtcBounds("nope").start, "");
  });

  it("keeps the queue on the selected clinic day and leaves other days for history", () => {
    const rows = [
      { id: "today", date: "2026-10-15", patientName: "Today Patient" },
      { id: "yesterday", date: "2026-10-14", patientName: "Yesterday Patient" },
      { id: "archive", date: "2024-03-02", patientName: "Old Patient" },
    ];
    const queued = appointmentsForClinicDay(rows, "2026-10-15");
    assert.deepEqual(queued.map((row) => row.id), ["today"]);
    assert.equal(appointmentsForClinicDay(rows, "").length, 0);
    assert.equal(appointmentsForClinicDay(rows, "not-a-date").length, 0);
    assert.match(formatClinicDayLabel("2026-10-15"), /2026/);
    const aheadOfIst = new Date("2026-10-15T19:00:00.000Z");
    const today = clinicToday(aheadOfIst);
    assert.equal(
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
      "2026-10-16"
    );
    assert.equal(formatClinicDateLabel("2026-10-16"), "16 Oct 2026");
    assert.equal(formatClinicMonthLabel(2026, 9), "October 2026");
    assert.equal(Number.isNaN(clinicDateFromIso("nope").getTime()), true);
  });

  it("parses the appointments list date param and rejects junk", () => {
    assert.deepEqual(parseAppointmentListDate(""), { kind: "all" });
    assert.deepEqual(parseAppointmentListDate("today"), { kind: "today" });
    assert.deepEqual(parseAppointmentListDate("2026-10-15"), { kind: "day", date: "2026-10-15" });
    assert.throws(() => parseAppointmentListDate("yesterday"), /YYYY-MM-DD/);
  });

  it("binds a bill to the opened appointment, never an older visit for the same patient", () => {
    const visits = [
      { id: "old-paid", patientId: "p1", date: "2026-01-02", status: "Completed" },
      { id: "today-wait", patientId: "p1", date: "2026-10-15", status: "Waiting" },
      { id: "other", patientId: "p2", date: "2026-10-15", status: "Waiting" },
    ];
    assert.equal(
      appointmentIdForBillContext(visits, { selectedAppointmentId: "today-wait", patientId: "p1", day: "2026-10-15" }),
      "today-wait"
    );
    assert.equal(
      appointmentIdForBillContext(visits, { patientId: "p1", day: "2026-10-15" }),
      "today-wait"
    );
    assert.equal(appointmentIdForBillContext(visits, { patientId: "p1", day: "2026-10-16" }), "");
    assert.notEqual(
      appointmentIdForBillContext(visits, { patientId: "p1", day: "2026-10-15" }),
      "old-paid"
    );
  });
});

describe("follow-up picker uses the India clinic day", () => {
  it("labels the reserved calendar date, not the browser midnight in Kolkata", () => {
    const picker = fs.readFileSync(path.join(__dirname, "../components/FollowUpSlotPicker.tsx"), "utf8");
    assert.match(picker, /clinicToday\(/);
    assert.match(picker, /formatClinicDateLabel\(isoDate\(/);
    assert.match(picker, /formatClinicMonthLabel\(/);
    assert.doesNotMatch(picker, /toLocaleDateString/);
  });
});

describe("queue screen wires the clinic-day filter", () => {
  it("requests a tenant-scoped date and does not render the full history on the queue", () => {
    assert.match(queueUi, /appointmentsForClinicDay/);
    assert.match(queueUi, /aria-label="Queue day"/);
    assert.match(queueUi, /data-testid="queue-date-label"/);
    assert.match(queueUi, /Queue date/);
    const sidebar = fs.readFileSync(path.join(__dirname, "../components/Sidebar.tsx"), "utf8");
    assert.match(sidebar, /doctor: \[[^\]]*queue/);
    assert.match(sidebar, /receptionist: \[[^\]]*queue/);
    assert.match(queueUi, /Earlier visits stay on the appointments calendar/);
    assert.match(appUi, /\/api\/appointments\?date=/);
    assert.match(appUi, /appointments=\{queueAppointments\}/);
    assert.match(appUi, /<AppointmentsCalendar[\s\S]*appointments=\{appointments\}/);
    assert.match(clinical, /tenant_id = \? AND date = \?/);
    assert.doesNotMatch(queueUi, /Lumera/);
  });
});

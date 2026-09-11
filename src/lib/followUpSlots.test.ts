import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  followUpBookingRef,
  generateFollowUpSlots,
  isoDate,
  isDoctorAvailableOn,
  minutesToClock,
  parseClockToMinutes,
  parseOpdWindows,
} from "./followUpSlots.ts";
import type { Doctor } from "../types.ts";

const physio: Pick<Doctor, "id" | "opdTiming" | "slotDurationMinutes" | "availableDays"> = {
  id: "doc-demo-physio",
  opdTiming: "09:00 AM - 11:00 AM",
  slotDurationMinutes: 30,
  availableDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

describe("follow-up slot picker", () => {
  it("parses split OPD windows used by physio clinics", () => {
    const windows = parseOpdWindows("08:30 AM - 01:30 PM, 04:30 PM - 08:00 PM");
    assert.equal(windows.length, 2);
    assert.equal(windows[0].startMin, parseClockToMinutes("08:30 AM"));
    assert.equal(windows[1].endMin, parseClockToMinutes("08:00 PM"));
    assert.equal(minutesToClock(90), "01:30 AM");
  });

  it("skips Sunday when Dr. Demo Physio works Mon-Sat", () => {
    const sunday = new Date(2026, 8, 13);
    assert.equal(sunday.getDay(), 0);
    assert.equal(isDoctorAvailableOn(sunday, physio.availableDays), false);
    const monday = new Date(2026, 8, 14);
    assert.equal(isDoctorAvailableOn(monday, physio.availableDays), true);
  });

  it("marks occupied slots unavailable and leaves open ones bookable", () => {
    const monday = new Date(2026, 8, 14);
    const slots = generateFollowUpSlots({
      date: monday,
      doctor: physio,
      appointments: [
        {
          date: isoDate(monday),
          timeSlot: "09:00 AM",
          doctorId: physio.id,
          status: "Waiting",
        },
      ],
    });
    assert.ok(slots.length >= 3);
    const first = slots.find((s) => s.timeSlot === "09:00 AM");
    const second = slots.find((s) => s.timeSlot === "09:30 AM");
    assert.equal(first?.available, false);
    assert.equal(second?.available, true);
  });

  it("returns no slots on a closed weekday", () => {
    const sunday = new Date(2026, 8, 13);
    const slots = generateFollowUpSlots({ date: sunday, doctor: physio, appointments: [] });
    assert.deepEqual(slots, []);
  });

  it("builds a booking reference attached to the signed Rx", () => {
    assert.match(followUpBookingRef("apt-abc12345xyz", "2026-09-21", "10:30 AM"), /^FU-20260921-1030AM-/);
  });
});

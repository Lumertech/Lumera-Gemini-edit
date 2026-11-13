import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { initDatabase, getDb } from "./db.ts";
import {
  ensureClinicScheduleSettingsTable,
  getClinicScheduleSettings,
  saveClinicScheduleSettings,
  listSlotOccupancy,
  parseTimeToMinutes,
  formatMinutesToTime,
} from "./clinic-schedule.ts";
import { getNextAvailableDoctorSlot } from "./whatsapp-calendar-booking.ts";
import { mountGeminiVoiceRoutes } from "./gemini-voice.ts";
import { saveWhatsAppTenantVoiceSettings } from "./whatsapp-numbers-store.ts";

describe("Clinic Schedule Settings, Overlap Allocation & 3-Attempt Voice Failover", () => {
  let db: any;
  let server: Server;
  let baseUrl: string;
  const testTenant = `test-sched-${Date.now()}`;
  const testTenantB = `test-sched-b-${Date.now()}`;
  const envSnapshot = {
    MAYA_TTS_OFFLINE: process.env.MAYA_TTS_OFFLINE,
  };

  function restoreEnv(snapshot: Record<string, string | undefined>) {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  before(async () => {
    process.env.MAYA_TTS_OFFLINE = "1";
    db = initDatabase();
    ensureClinicScheduleSettingsTable(db);

    const app = express();
    app.use(express.json());
    mountGeminiVoiceRoutes(app, () => null);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(() => {
    restoreEnv(envSnapshot);
    if (server) server.close();
  });

  it("1. Returns sensible default settings (15-min duration, 1-appointment overlap)", () => {
    const settings = getClinicScheduleSettings(db, testTenant);
    assert.equal(settings.slotDurationMinutes, 15, "Default slot duration should be 15 minutes");
    assert.equal(settings.slotOverlapMax, 1, "Default slot overlap should be 1 appointment per slot");
    assert.equal(settings.opdStartTime, "09:00 AM");
    assert.equal(settings.opdEndTime, "05:00 PM");
  });

  it("2. Allows custom slot duration (e.g. 10 min) and overlap (e.g. 3)", () => {
    const saved = saveClinicScheduleSettings(db, testTenant, {
      slotDurationMinutes: 10,
      slotOverlapMax: 3,
      opdStartTime: "10:00 AM",
      opdEndTime: "02:00 PM",
    });

    assert.equal(saved.slotDurationMinutes, 10);
    assert.equal(saved.slotOverlapMax, 3);
    assert.equal(saved.opdStartTime, "10:00 AM");
    assert.equal(saved.opdEndTime, "02:00 PM");

    const reloaded = getClinicScheduleSettings(db, testTenant);
    assert.equal(reloaded.slotDurationMinutes, 10);
    assert.equal(reloaded.slotOverlapMax, 3);
  });

  it("3. parseTimeToMinutes and formatMinutesToTime roundtrips correctly", () => {
    assert.equal(parseTimeToMinutes("09:00 AM"), 540);
    assert.equal(parseTimeToMinutes("09:15 AM"), 555);
    assert.equal(parseTimeToMinutes("01:30 PM"), 810);
    assert.equal(formatMinutesToTime(540), "09:00 AM");
    assert.equal(formatMinutesToTime(555), "09:15 AM");
    assert.equal(formatMinutesToTime(810), "01:30 PM");
  });

  it("4. listSlotOccupancy steps slots according to configured duration", () => {
    saveClinicScheduleSettings(db, testTenant, {
      slotDurationMinutes: 20,
      slotOverlapMax: 2,
      opdStartTime: "09:00 AM",
      opdEndTime: "10:00 AM",
    });

    const res = listSlotOccupancy(db, {
      tenantId: testTenant,
      date: "2026-11-10",
      includePrivateDetails: true,
    });

    assert.equal(res.slots.length, 3); // 09:00, 09:20, 09:40
    assert.equal(res.slots[0].timeSlot, "09:00 AM");
    assert.equal(res.slots[1].timeSlot, "09:20 AM");
    assert.equal(res.slots[2].timeSlot, "09:40 AM");
    assert.equal(res.slots[0].maxOverlap, 2);
    assert.equal(res.slots[0].isAvailable, true);
  });

  it("5. Overlap capacity: slot remains available until maxOverlap is reached", () => {
    saveClinicScheduleSettings(db, testTenant, {
      slotDurationMinutes: 15,
      slotOverlapMax: 2,
      opdStartTime: "09:00 AM",
      opdEndTime: "10:00 AM",
    });

    const date = "2026-11-10";
    const now = new Date().toISOString();
    // Seed 1 appointment at 09:00 AM
    db.prepare(`
      INSERT INTO appointments (id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name, specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at)
      VALUES (?, ?, 1, 'pat-1', 'Patient One', '+919999900001', 'UHID-001', 'doc-1', 'Dr. Rao', 'General', ?, '09:00 AM', 'New Consultation', 'Waiting', 'WhatsApp Bot', 500, 1, ?)
    `).run(`apt-ov-1-${Date.now()}`, testTenant, date, now);

    // Overlap is 2, so 09:00 AM should still be returned as next available slot!
    const slotAfter1 = getNextAvailableDoctorSlot({
      tenantId: testTenant,
      date,
      doctorName: "Dr. Rao",
    });
    assert.equal(slotAfter1, "09:00 AM", "Slot 09:00 AM should still be available for 2nd booking");

    // Seed 2nd appointment at 09:00 AM
    db.prepare(`
      INSERT INTO appointments (id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name, specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at)
      VALUES (?, ?, 2, 'pat-2', 'Patient Two', '+919999900002', 'UHID-002', 'doc-1', 'Dr. Rao', 'General', ?, '09:00 AM', 'New Consultation', 'Waiting', 'WhatsApp Bot', 500, 1, ?)
    `).run(`apt-ov-2-${Date.now()}`, testTenant, date, now);

    // Now 09:00 AM has reached capacity (2/2), so next slot must advance to 09:15 AM
    const slotAfter2 = getNextAvailableDoctorSlot({
      tenantId: testTenant,
      date,
      doctorName: "Dr. Rao",
    });
    assert.equal(slotAfter2, "09:15 AM", "Slot must advance to 09:15 AM once 09:00 AM reaches overlap limit of 2");
  });

  it("6. Multi-tenant privacy: Tenant B cannot see Tenant A's booked patients", () => {
    const date = "2026-11-10";
    const occupancyStaff = listSlotOccupancy(db, {
      tenantId: testTenant,
      date,
      includePrivateDetails: true,
    });
    const bookedSlot = occupancyStaff.slots.find((s) => s.timeSlot === "09:00 AM");
    assert.ok(bookedSlot && bookedSlot.appointments.length === 2);
    assert.equal(bookedSlot.appointments[0].patientName, "Patient One");

    // Tenant B queries same date
    const occupancyOtherTenant = listSlotOccupancy(db, {
      tenantId: testTenantB,
      date,
      includePrivateDetails: true,
    });
    const otherSlot = occupancyOtherTenant.slots.find((s) => s.timeSlot === "09:00 AM");
    assert.ok(otherSlot);
    assert.equal(otherSlot.bookedCount, 0, "Tenant B should see 0 bookings in their own schedule");
    assert.equal(otherSlot.appointments.length, 0, "Tenant B must never see Tenant A's patient appointments");
  });

  it("7. Public WhatsApp patient view strips all private patient details", () => {
    const date = "2026-11-10";
    const publicView = listSlotOccupancy(db, {
      tenantId: testTenant,
      date,
      includePrivateDetails: false, // End user / WhatsApp patient
    });

    for (const slot of publicView.slots) {
      assert.equal(slot.appointments.length, 0, "Public view must have zero patient details");
    }
  });

  it("8. Maya Voicebot transfers to reception/helpdesk after 3 listening attempts", async () => {
    const phoneNumberId = `1555${String(Date.now()).slice(-10)}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, phone_number_id, created_at, updated_at)
       VALUES (?, 'Schedule Clinic', 'General Medicine', 'India', 'IST (UTC+5:30)', '+919800011122', ?, 500, 0, 1, '', ?, ?, ?)`
    ).run(testTenant, now, phoneNumberId, now, now);
    // Configure clinic escalation number
    saveWhatsAppTenantVoiceSettings(db, testTenant, {
      escalationPhone: "+91 98233 11111",
      receptionistName: "Maya",
    });

    const prevSecret = process.env.VOICE_GATEWAY_SECRET;
    process.env.VOICE_GATEWAY_SECRET = "schedule-voice-gateway-secret";
    try {
      // Simulate 3rd listening attempt with 2 previous clarification attempts in conversation history.
      // A body tenantId for a different clinic must be ignored; the line id selects the clinic.
      const res = await fetch(`${baseUrl}/api/whatsapp/voice-call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Voice-Gateway-Secret": "schedule-voice-gateway-secret",
        },
        body: JSON.stringify({
          from: "+919999988888",
          message: "", // inaudible / unclear speech
          tenantId: "tenant-not-this-clinic",
          phoneNumberId,
          conversationHistory: [
            { role: "caller", text: "..." },
            { role: "maya", text: "I'm sorry, I couldn't hear that clearly. Could you please repeat?" },
            { role: "caller", text: "..." },
            { role: "maya", text: "I'm sorry, I couldn't hear that clearly. Could you please repeat?" },
          ],
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json() as any;
      assert.equal(data.intent, "TRANSFER", "After 3 unclear attempts, Maya must trigger TRANSFER intent");
      assert.equal(data.shouldTransfer, true);
      assert.match(data.speechText, /98233 11111/, "Speech text must direct caller to this clinic's desk number");
      assert.match(data.speechText, /clinic staff/i);
      assert.doesNotMatch(data.speechText, /98233\s*73271/);
      assert.match(data.suggestedAction, /clinic desk/i);
      assert.equal(data.escalationPhone, undefined);
    } finally {
      if (prevSecret === undefined) delete process.env.VOICE_GATEWAY_SECRET;
      else process.env.VOICE_GATEWAY_SECRET = prevSecret;
    }
  });
});

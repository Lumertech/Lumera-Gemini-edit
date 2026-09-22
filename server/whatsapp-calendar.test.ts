import assert from "node:assert/strict";
import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { createWhatsAppRouter } from "./whatsapp.ts";
import { installWhatsAppRouterPatch, protectWhatsAppDashboard } from "./whatsapp-dashboard-guard.ts";
import { DEMO_TENANT_ID, getDb, initDatabase, seedClinicalAndWhatsAppIfMissing } from "./db.ts";
import { listTenantOutboundEvents } from "./whatsapp-scope.ts";
import { hashPassword } from "./password.ts";
import { applyWalletTransaction } from "./usage-wallet.ts";
import { canonicalAppointmentPhone } from "./clinical.ts";
import {
  appointmentInstantUtc,
  bookWhatsAppAppointment,
  dispatchAppointmentReminder,
  dispatchWhatsAppBookConfirmation,
  findActiveAppointment,
  parseTimeSlot,
  runAppointmentReminders,
  tenantUtcOffsetMinutes,
} from "./whatsapp-calendar.ts";

async function jsonRequest(
  port: number,
  method: string,
  urlPath: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function createClinicUser(label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const doctorId = `doc-${label}-${suffix}`;
  const email = `${label}.${suffix}@wa-cal-test.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Clinic ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(
    userId,
    tenantId,
    email,
    hashPassword("Lumera@2026"),
    `Dr ${label}`,
    `+91 91000 ${label.slice(0, 5).padEnd(5, "0")}`,
    `Clinic ${label}`,
    now,
    now
  );
  db.prepare(
    `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
     VALUES (?, ?, ?, 'MBBS', ?, 'General Medicine', 8, 500, 'OPD-1', '["Mon","Tue","Wed","Thu","Fri"]', '09:00 AM - 01:00 PM', ?, ?, '', '', '', 1)`
  ).run(doctorId, userId, `Dr ${label}`, `REG-${suffix}`, `+91 91000 ${label.slice(0, 5).padEnd(5, "0")}`, email);
  applyWalletTransaction(tenantId, "adjustment", 1000, {
    note: "Test seed credit for WhatsApp metering",
    createdBy: "system",
  });
  return { tenantId, userId, doctorId, email };
}

let phoneSeq = 0;
function uniquePhone(): string {
  phoneSeq += 1;
  const n = `${Date.now()}${phoneSeq}${Math.floor(Math.random() * 900 + 100)}`.replace(/\D/g, "").slice(-10);
  return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
}

describe("Wave 2 WhatsApp calendar + reminders", () => {
  let port = 0;
  let server: Server | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-whatsapp-calendar";
    }
    try {
      getDb();
    } catch {
      initDatabase();
    }

    installWhatsAppRouterPatch();
    const app = express();
    app.use(express.json());
    app.use(attachUser);
    app.use("/api/whatsapp", protectWhatsAppDashboard(createWhatsAppRouter()));
    app.use("/api", createApiRouter());

    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("server did not bind a port");
    port = addr.port;
  });

  after(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
  });

  async function login(email: string): Promise<string> {
    const loginRes = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(loginRes.status, 200, String(loginRes.json.error || "login failed"));
    const token = String(loginRes.json.token || "");
    assert.ok(token);
    return token;
  }

  it("parses clinic local time for IST reminder windows", () => {
    assert.equal(tenantUtcOffsetMinutes("IST (UTC+5:30)"), 330);
    assert.deepEqual(parseTimeSlot("10:30 AM"), { hours: 10, minutes: 30 });
    const utc = appointmentInstantUtc("2026-09-11", "10:30 AM", 330);
    assert.equal(utc.toISOString(), "2026-09-11T05:00:00.000Z");
  });

  it("WhatsApp book_appointment creates a tenant-scoped calendar row with source WhatsApp Bot", async () => {
    const clinic = createClinicUser("bookA");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const phone = uniquePhone();

    const booked = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/emr-action",
      {
        action: "book_appointment",
        tenantId: clinic.tenantId,
        patientPhone: phone,
        payload: {
          patientName: "Neha WhatsApp",
          doctorId: clinic.doctorId,
          date: "2026-09-12",
          timeSlot: "11:00 AM",
        },
      },
      auth
    );
    assert.equal(booked.status, 200, String(booked.json.error || ""));
    const appointment = booked.json.appointment as {
      id: string;
      source: string;
      status: string;
      tokenNumber: number;
      patientName: string;
    };
    assert.ok(appointment.id);
    assert.equal(appointment.source, "WhatsApp Bot");
    assert.equal(appointment.status, "Waiting");
    assert.equal(appointment.tokenNumber, 1);
    assert.equal(appointment.patientName, "Neha WhatsApp");
    assert.equal(booked.json.reused, false);
    const confirmation = booked.json.confirmation as { ok: boolean; channel: string };
    assert.equal(confirmation.ok, true);
    assert.equal(confirmation.channel, "sandbox");

    const listed = await jsonRequest(port, "GET", "/api/appointments", undefined, auth);
    assert.equal(listed.status, 200);
    const rows = listed.json.appointments as Array<{ id: string; source: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, appointment.id);
    assert.equal(rows[0].source, "WhatsApp Bot");

    const row = getDb()
      .prepare("SELECT tenant_id, source FROM appointments WHERE id = ?")
      .get(appointment.id) as { tenant_id: string; source: string };
    assert.equal(row.tenant_id, clinic.tenantId);
    assert.equal(row.source, "WhatsApp Bot");
  });

  it("repeat WhatsApp book does not duplicate the same patient/doctor/date row", async () => {
    const clinic = createClinicUser("dedupe");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const phone = uniquePhone();
    const payload = {
      action: "book_appointment",
      tenantId: clinic.tenantId,
      patientPhone: phone,
      payload: {
        patientName: "Repeat Patient",
        doctorId: clinic.doctorId,
        date: "2026-09-13",
        timeSlot: "09:30 AM",
      },
    };
    const first = await jsonRequest(port, "POST", "/api/whatsapp/emr-action", payload, auth);
    const second = await jsonRequest(port, "POST", "/api/whatsapp/emr-action", payload, auth);
    assert.equal(first.status, 200, String(first.json.error || ""));
    assert.equal(second.status, 200, String(second.json.error || ""));
    assert.equal(second.json.reused, true);
    assert.deepEqual(second.json.confirmation, { skipped: true, reason: "existing_appointment" });
    const firstId = (first.json.appointment as { id: string }).id;
    const secondId = (second.json.appointment as { id: string }).id;
    assert.equal(firstId, secondId);

    const count = getDb()
      .prepare("SELECT COUNT(*) AS c FROM appointments WHERE tenant_id = ? AND patient_phone = ?")
      .get(clinic.tenantId, canonicalAppointmentPhone(phone)) as { c: number };
    assert.equal(count.c, 1);
  });

  it("clinic B cannot see clinic A's WhatsApp-booked token", async () => {
    const clinicA = createClinicUser("isoWA");
    const clinicB = createClinicUser("isoWB");
    const tokenA = await login(clinicA.email);
    const tokenB = await login(clinicB.email);
    const phone = uniquePhone();

    const booked = await jsonRequest(port, "POST", "/api/whatsapp/emr-action", {
      action: "book_appointment",
      tenantId: clinicA.tenantId,
      patientPhone: phone,
      payload: { patientName: "A-only WA", doctorId: clinicA.doctorId, date: "2026-09-14" },
    }, { Authorization: `Bearer ${tokenA}` });
    assert.equal(booked.status, 200, String(booked.json.error || ""));
    const aptId = (booked.json.appointment as { id: string }).id;

    const listB = await jsonRequest(port, "GET", "/api/appointments", undefined, {
      Authorization: `Bearer ${tokenB}`,
    });
    const idsB = ((listB.json.appointments as Array<{ id: string }>) || []).map((row) => row.id);
    assert.equal(idsB.includes(aptId), false);

    const stolen = await jsonRequest(port, "GET", `/api/appointments/${aptId}`, undefined, {
      Authorization: `Bearer ${tokenB}`,
    });
    assert.equal(stolen.status, 404);

    const demoToken = await login("doctor@lumera.me");
    const demoList = await jsonRequest(port, "GET", "/api/appointments", undefined, {
      Authorization: `Bearer ${demoToken}`,
    });
    const demoIds = ((demoList.json.appointments as Array<{ id: string }>) || []).map((row) => row.id);
    assert.equal(demoIds.includes(aptId), false);
    assert.ok(DEMO_TENANT_ID);
  });

  it("cancel and reschedule update the same appointments row", async () => {
    const clinic = createClinicUser("patch");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const phone = uniquePhone();
    const booked = await jsonRequest(port, "POST", "/api/whatsapp/emr-action", {
      action: "book_appointment",
      tenantId: clinic.tenantId,
      patientPhone: phone,
      payload: {
        patientName: "Reschedule Me",
        doctorId: clinic.doctorId,
        date: "2026-09-15",
        timeSlot: "10:00 AM",
      },
    }, auth);
    const aptId = (booked.json.appointment as { id: string }).id;

    const rescheduled = await jsonRequest(port, "POST", "/api/whatsapp/emr-action", {
      action: "reschedule_appointment",
      tenantId: clinic.tenantId,
      patientPhone: phone,
      payload: { appointmentId: aptId, date: "2026-09-16", timeSlot: "04:00 PM" },
    }, auth);
    assert.equal(rescheduled.status, 200, String(rescheduled.json.error || ""));
    const moved = rescheduled.json.appointment as { id: string; date: string; timeSlot: string; status: string };
    assert.equal(moved.id, aptId);
    assert.equal(moved.date, "2026-09-16");
    assert.equal(moved.timeSlot, "04:00 PM");
    assert.equal(moved.status, "Waiting");

    const clinicianView = await jsonRequest(port, "GET", `/api/appointments/${aptId}`, undefined, {
      Authorization: `Bearer ${token}`,
    });
    assert.equal((clinicianView.json.appointment as { date: string }).date, "2026-09-16");

    const cancelled = await jsonRequest(port, "POST", "/api/whatsapp/emr-action", {
      action: "cancel_appointment",
      tenantId: clinic.tenantId,
      patientPhone: phone,
      payload: { appointmentId: aptId },
    }, auth);
    assert.equal(cancelled.status, 200, String(cancelled.json.error || ""));
    assert.equal((cancelled.json.appointment as { status: string }).status, "Cancelled");

    const noShowBook = await jsonRequest(port, "POST", "/api/whatsapp/emr-action", {
      action: "book_appointment",
      tenantId: clinic.tenantId,
      patientPhone: phone,
      payload: {
        patientName: "Reschedule Me",
        doctorId: clinic.doctorId,
        date: "2026-09-17",
        timeSlot: "09:00 AM",
      },
    }, auth);
    const noShowId = (noShowBook.json.appointment as { id: string }).id;
    const marked = await jsonRequest(port, "POST", "/api/whatsapp/emr-action", {
      action: "mark_no_show",
      tenantId: clinic.tenantId,
      patientPhone: phone,
      payload: { appointmentId: noShowId },
    }, auth);
    assert.equal((marked.json.appointment as { status: string }).status, "No-Show");
  });

  it("sandbox reminder path records locally without Graph secrets", async () => {
    const prevToken = process.env.META_ACCESS_TOKEN;
    const prevPhone = process.env.META_PHONE_NUMBER_ID;
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_PHONE_NUMBER_ID;

    try {
      const clinic = createClinicUser("remindS");
      const booked = bookWhatsAppAppointment({
        tenantId: clinic.tenantId,
        patientPhone: uniquePhone(),
        patientName: "Reminder Sandbox",
        doctorId: clinic.doctorId,
        date: "2026-09-11",
        timeSlot: "10:30 AM",
      });
      const run = await runAppointmentReminders({
        tenantId: clinic.tenantId,
        appointmentId: booked.appointment.id,
        now: new Date("2026-09-10T06:00:00.000Z"),
      });
      assert.equal(run.sent.length, 1, JSON.stringify(run));
      assert.equal(run.sent[0].window, "24h");
      assert.equal(run.sent[0].result.ok, true);
      if (run.sent[0].result.ok) {
        assert.equal(run.sent[0].result.channel, "sandbox");
        assert.equal(run.sent[0].result.messageId, undefined);
      }

      const event = getDb()
        .prepare("SELECT status, details, action_payload FROM whatsapp_outbound_events WHERE id = ?")
        .get(run.sent[0].result.ok ? run.sent[0].result.eventId : "") as {
        status: string;
        details: string;
        action_payload: string;
      };
      assert.equal(event.status, "sandbox_recorded");
      assert.match(event.details, /SANDBOX/i);
      assert.match(event.action_payload, /"sandbox":true/);
      assert.equal(event.action_payload.includes("wamid"), false);
    } finally {
      if (prevToken === undefined) delete process.env.META_ACCESS_TOKEN;
      else process.env.META_ACCESS_TOKEN = prevToken;
      if (prevPhone === undefined) delete process.env.META_PHONE_NUMBER_ID;
      else process.env.META_PHONE_NUMBER_ID = prevPhone;
    }
  });

  it("Graph reminder path is used when Meta secrets are present", async () => {
    const prevToken = process.env.META_ACCESS_TOKEN;
    const prevPhone = process.env.META_PHONE_NUMBER_ID;
    process.env.META_ACCESS_TOKEN = "EAAGisAlongEnoughTokenWithoutEllipsis0123456789abcdef";
    process.env.META_PHONE_NUMBER_ID = "123456789012345";

    try {
      const clinic = createClinicUser("remindG");
      const booked = bookWhatsAppAppointment({
        tenantId: clinic.tenantId,
        patientPhone: uniquePhone(),
        patientName: "Reminder Graph",
        doctorId: clinic.doctorId,
        date: "2026-09-11",
        timeSlot: "10:30 AM",
      });

      const fetchImpl: typeof fetch = async () =>
        new Response(JSON.stringify({ messages: [{ id: "wamid.GRAPH_REMINDER_TEST" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });

      const result = await dispatchAppointmentReminder({
        tenantId: clinic.tenantId,
        appointment: booked.appointment,
        window: "24h",
        fetchImpl,
      });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.channel, "graph");
        assert.equal(result.messageId, "wamid.GRAPH_REMINDER_TEST");
      }

      const confirm = await dispatchWhatsAppBookConfirmation({
        tenantId: clinic.tenantId,
        appointment: booked.appointment,
        fetchImpl,
      });
      assert.equal(confirm.ok, true);
      if (confirm.ok) {
        assert.equal(confirm.channel, "graph");
        assert.equal(confirm.messageId, "wamid.GRAPH_REMINDER_TEST");
      }
    } finally {
      if (prevToken === undefined) delete process.env.META_ACCESS_TOKEN;
      else process.env.META_ACCESS_TOKEN = prevToken;
      if (prevPhone === undefined) delete process.env.META_PHONE_NUMBER_ID;
      else process.env.META_PHONE_NUMBER_ID = prevPhone;
    }
  });

  it("production reminder hard-fails without Meta secrets and does not mint a fake wamid", async () => {
    const prevNode = process.env.NODE_ENV;
    const prevToken = process.env.META_ACCESS_TOKEN;
    const prevPhone = process.env.META_PHONE_NUMBER_ID;

    try {
      const clinic = createClinicUser("remindP");
      const token = await login(clinic.email);
      process.env.NODE_ENV = "production";
      delete process.env.META_ACCESS_TOKEN;
      delete process.env.META_PHONE_NUMBER_ID;
      const booked = bookWhatsAppAppointment({
        tenantId: clinic.tenantId,
        patientPhone: uniquePhone(),
        patientName: "Reminder Prod",
        doctorId: clinic.doctorId,
        date: "2026-09-11",
        timeSlot: "10:30 AM",
      });
      const result = await dispatchAppointmentReminder({
        tenantId: clinic.tenantId,
        appointment: booked.appointment,
        window: "2h",
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.channel, "none");
        assert.match(result.error, /not configured|not delivered/i);
      }
      const http = await jsonRequest(port, "POST", "/api/whatsapp/reminders/run", {
        tenantId: clinic.tenantId,
        appointmentId: booked.appointment.id,
        now: "2026-09-11T03:00:00.000Z",
      }, { Authorization: `Bearer ${token}` });
      assert.equal(http.status, 503);
      assert.equal(http.json.channel, "none");
      assert.equal(JSON.stringify(http.json).includes("wamid"), false);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevToken === undefined) delete process.env.META_ACCESS_TOKEN;
      else process.env.META_ACCESS_TOKEN = prevToken;
      if (prevPhone === undefined) delete process.env.META_PHONE_NUMBER_ID;
      else process.env.META_PHONE_NUMBER_ID = prevPhone;
    }
  });

  it("skips Completed and Cancelled appointments when sending reminders", async () => {
    const prevToken = process.env.META_ACCESS_TOKEN;
    const prevPhone = process.env.META_PHONE_NUMBER_ID;
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_PHONE_NUMBER_ID;
    try {
      const clinic = createClinicUser("skipSt");
      const token = await login(clinic.email);
      const phone = uniquePhone();
      const booked = bookWhatsAppAppointment({
        tenantId: clinic.tenantId,
        patientPhone: phone,
        patientName: "Skip Completed",
        doctorId: clinic.doctorId,
        date: "2026-09-11",
        timeSlot: "10:30 AM",
      });
      await jsonRequest(port, "POST", "/api/whatsapp/emr-action", {
        action: "cancel_appointment",
        tenantId: clinic.tenantId,
        payload: { appointmentId: booked.appointment.id },
        patientPhone: phone,
      }, { Authorization: `Bearer ${token}` });
      const run = await runAppointmentReminders({
        tenantId: clinic.tenantId,
        appointmentId: booked.appointment.id,
        now: new Date("2026-09-10T06:00:00.000Z"),
      });
      assert.equal(run.sent.length, 0);
    } finally {
      if (prevToken === undefined) delete process.env.META_ACCESS_TOKEN;
      else process.env.META_ACCESS_TOKEN = prevToken;
      if (prevPhone === undefined) delete process.env.META_PHONE_NUMBER_ID;
      else process.env.META_PHONE_NUMBER_ID = prevPhone;
    }
  });

  it("booking stores E.164 patient_phone and Reminder matches +919999973271 variants", async () => {
    const saved: Record<string, string | undefined> = {};
    for (const key of ["META_ACCESS_TOKEN", "META_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    try {
      const clinic = createClinicUser("clipA");
      const token = await login(clinic.email);
      const auth = { Authorization: `Bearer ${token}` };
      const spaced = "+91 99999 73271";
      const e164 = "+919999973271";

      const created = await jsonRequest(
        port,
        "POST",
        "/api/patients",
        { name: "A1 Test Recipient", age: 34, gender: "Female", phone: spaced },
        auth
      );
      assert.equal(created.status, 201, String(created.json.error || ""));
      const patientId = String((created.json.patient as { id: string }).id);

      const booked = await jsonRequest(
        port,
        "POST",
        "/api/appointments",
        {
          patientId,
          doctorId: clinic.doctorId,
          date: "2026-10-02",
          timeSlot: "11:15 AM",
          type: "New Consultation",
          source: "Walk-in",
        },
        auth
      );
      assert.equal(booked.status, 201, String(booked.json.error || ""));
      const appointment = booked.json.appointment as { id: string; patientPhone: string };
      assert.equal(appointment.patientPhone, e164);

      for (const variant of [e164, spaced, "9999973271", "91 99999 73271"]) {
        const found = findActiveAppointment({ tenantId: clinic.tenantId, patientPhone: variant });
        assert.equal(found?.id, appointment.id, variant);
        assert.equal(String(found?.patient_phone || ""), e164);
      }

      getDb().prepare("UPDATE appointments SET patient_phone = '' WHERE id = ?").run(appointment.id);
      const recovered = findActiveAppointment({ tenantId: clinic.tenantId, patientPhone: spaced });
      assert.equal(recovered?.id, appointment.id);
      assert.equal(String(recovered?.patient_phone || ""), e164);

      getDb().prepare("UPDATE appointments SET patient_phone = ? WHERE id = ?").run("+910000000000", appointment.id);
      const reminded = await jsonRequest(
        port,
        "POST",
        "/api/whatsapp/outbound/trigger",
        {
          eventType: "appointment_reminder_24h",
          patientPhone: spaced,
          patientName: "A1 Test Recipient",
          tenantId: clinic.tenantId,
        },
        auth
      );
      assert.equal(reminded.status, 201, String(reminded.json.error || ""));
      const healed = getDb()
        .prepare("SELECT patient_phone FROM appointments WHERE id = ?")
        .get(appointment.id) as { patient_phone: string };
      assert.equal(healed.patient_phone, e164);
      const event = getDb()
        .prepare(
          "SELECT patient_phone, event_type FROM whatsapp_outbound_events WHERE id = ?"
        )
        .get(String(reminded.json.eventId || "")) as { patient_phone: string; event_type: string };
      assert.equal(event.event_type, "appointment_reminder");
      assert.equal(event.patient_phone, e164);

      const renamed = await jsonRequest(
        port,
        "PATCH",
        `/api/patients/${patientId}`,
        { phone: "9999900001" },
        auth
      );
      assert.equal(renamed.status, 200, String(renamed.json.error || ""));
      const afterRename = getDb()
        .prepare("SELECT patient_phone FROM appointments WHERE id = ?")
        .get(appointment.id) as { patient_phone: string };
      assert.equal(afterRename.patient_phone, "+919999900001");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("Reminder rejects a phone with no active upcoming appointment and writes no outbound event", async () => {
    const clinic = createClinicUser("noSlot");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "No Slot", age: 40, gender: "Male", phone: "+919999973271" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id: string }).id);
    const booked = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      { patientId, doctorId: clinic.doctorId, date: "2026-10-03", timeSlot: "09:00 AM" },
      auth
    );
    const appointmentId = String((booked.json.appointment as { id: string }).id);
    getDb().prepare("UPDATE appointments SET status = 'Cancelled', patient_phone = '' WHERE id = ?").run(appointmentId);

    const phone = "+91 99999 73271";
    const before = getDb()
      .prepare("SELECT COUNT(*) AS c FROM whatsapp_outbound_events WHERE patient_phone LIKE ?")
      .get("%9999973271%") as { c: number };
    const missed = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/outbound/trigger",
      {
        eventType: "appointment_reminder_24h",
        patientPhone: phone,
        patientName: "No Slot",
        tenantId: clinic.tenantId,
      },
      auth
    );
    assert.equal(missed.status, 404);
    assert.match(String(missed.json.error || ""), /active upcoming appointment/i);
    assert.match(String(missed.json.error || ""), /Book a slot/i);
    const after = getDb()
      .prepare("SELECT COUNT(*) AS c FROM whatsapp_outbound_events WHERE patient_phone LIKE ?")
      .get("%9999973271%") as { c: number };
    assert.equal(after.c, before.c);

    const unknown = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/outbound/trigger",
      {
        eventType: "appointment_reminder",
        patientPhone: "+919111100000",
        patientName: "Nobody",
        tenantId: clinic.tenantId,
      },
      auth
    );
    assert.equal(unknown.status, 404);
    assert.match(String(unknown.json.error || ""), /No active upcoming appointment/);
  });

  it("demo boot seed makes Clip A +919999973271 remindable without a manual booking", () => {
    seedClinicalAndWhatsAppIfMissing(getDb());
    const variants = ["+919999973271", "+91 99999 73271", "9999973271"];
    let appointmentId = "";
    for (const variant of variants) {
      const found = findActiveAppointment({ tenantId: DEMO_TENANT_ID, patientPhone: variant });
      assert.ok(found, variant);
      assert.equal(String(found?.tenant_id || ""), DEMO_TENANT_ID);
      assert.equal(String(found?.patient_phone || ""), "+919999973271");
      assert.ok(["Waiting", "Confirmed"].includes(String(found?.status || "")));
      const hours =
        (appointmentInstantUtc(String(found?.date || ""), String(found?.time_slot || ""), 330).getTime() - Date.now()) /
        3_600_000;
      assert.ok(hours > 0 && hours <= 24, `hours=${hours}`);
      appointmentId = String(found?.id || "");
    }
    const patient = getDb()
      .prepare("SELECT name, tenant_id FROM patients WHERE id = ?")
      .get("pat-a1-clip") as { name: string; tenant_id: string };
    assert.equal(patient.name, "A1 Test Recipient");
    assert.equal(patient.tenant_id, DEMO_TENANT_ID);
    const conv = getDb()
      .prepare("SELECT patient_phone, patient_name FROM whatsapp_conversations WHERE patient_phone = ?")
      .get("+919999973271") as { patient_phone: string; patient_name: string };
    assert.equal(conv.patient_name, "A1 Test Recipient");

    seedClinicalAndWhatsAppIfMissing(getDb());
    const count = getDb()
      .prepare(
        "SELECT COUNT(*) AS c FROM appointments WHERE tenant_id = ? AND patient_id = 'pat-a1-clip' AND status IN ('Waiting', 'Confirmed')"
      )
      .get(DEMO_TENANT_ID) as { c: number };
    assert.equal(count.c, 1);
    assert.equal(
      String(findActiveAppointment({ tenantId: DEMO_TENANT_ID, patientPhone: "+919999973271" })?.id || ""),
      appointmentId
    );
  });

  it("Trigger 24h Reminder for seeded A1 does not require a new booking", async () => {
    const saved: Record<string, string | undefined> = {};
    for (const key of ["META_ACCESS_TOKEN", "META_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    try {
      applyWalletTransaction(DEMO_TENANT_ID, "adjustment", 1000, {
        note: "Clip A reminder test credit",
        createdBy: "system",
      });
      const token = await login("doctor@lumera.me");
      const reminded = await jsonRequest(
        port,
        "POST",
        "/api/whatsapp/outbound/trigger",
        {
          eventType: "appointment_reminder_24h",
          patientPhone: "+919999973271",
          patientName: "A1 Test Recipient",
        },
        { Authorization: `Bearer ${token}` }
      );
      assert.equal(reminded.status, 201, String(reminded.json.error || reminded.json));
      assert.equal(reminded.json.ok, true);
      assert.equal(reminded.json.channel, "sandbox");
      const event = getDb()
        .prepare("SELECT tenant_id, patient_phone, event_type FROM whatsapp_outbound_events WHERE id = ?")
        .get(String(reminded.json.eventId || "")) as { tenant_id: string; patient_phone: string; event_type: string };
      assert.equal(event.tenant_id, DEMO_TENANT_ID);
      assert.equal(event.patient_phone, "+919999973271");
      assert.equal(event.event_type, "appointment_reminder");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("reminder template parameters are patient, clinic, doctor, date, time and stamp tenant_id", async () => {
    const saved: Record<string, string | undefined> = {};
    for (const key of ["META_ACCESS_TOKEN", "META_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "META_REMINDER_TEMPLATE_NAME", "META_UTILITY_TEMPLATE_LANGUAGE"]) {
      saved[key] = process.env[key];
    }
    process.env.META_ACCESS_TOKEN = "EAAGisAlongEnoughTokenWithoutEllipsis0123456789abcdef";
    process.env.META_PHONE_NUMBER_ID = "123456789012345";
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    process.env.META_REMINDER_TEMPLATE_NAME = "lumera_appointment_reminder";
    process.env.META_UTILITY_TEMPLATE_LANGUAGE = "en_US";
    try {
      const clinic = createClinicUser("tplParam");
      const booked = bookWhatsAppAppointment({
        tenantId: clinic.tenantId,
        patientPhone: uniquePhone(),
        patientName: "Param Patient",
        doctorId: clinic.doctorId,
        date: "2026-10-02",
        timeSlot: "11:15 AM",
      });
      const captured: Array<Record<string, unknown>> = [];
      const result = await dispatchAppointmentReminder({
        tenantId: clinic.tenantId,
        appointment: booked.appointment,
        window: "24h",
        fetchImpl: async (_url, init) => {
          captured.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
          return new Response(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: "wamid.CLIP_A" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      if (result.ok) assert.equal(result.messageId, "wamid.CLIP_A");
      const template = captured[0]?.template as {
        name?: string;
        language?: { code?: string };
        components?: Array<{ type?: string; parameters?: Array<{ text?: string }> }>;
      };
      assert.equal(template.name, "lumera_appointment_reminder");
      assert.equal(template.language?.code, "en_US");
      const body = template.components?.find((component) => component.type === "body");
      const clinicRow = getDb().prepare("SELECT name FROM tenants WHERE id = ?").get(clinic.tenantId) as { name: string };
      const parameters = (body?.parameters || []).map((parameter) => parameter.text);
      assert.deepEqual(parameters, [
        "Param Patient",
        clinicRow.name,
        booked.appointment.doctorName,
        "2026-10-02",
        "11:15 AM",
      ]);
      assert.equal(parameters.includes(String(booked.appointment.tokenNumber)), false);
      const event = getDb()
        .prepare("SELECT tenant_id, patient_phone FROM whatsapp_outbound_events WHERE id = ?")
        .get(result.ok ? result.eventId : "") as { tenant_id: string; patient_phone: string };
      assert.equal(event.tenant_id, clinic.tenantId);

      const spacedId = `evt-spaced-${crypto.randomUUID().slice(0, 8)}`;
      getDb()
        .prepare(
          `INSERT INTO whatsapp_outbound_events (id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at, tenant_id)
           VALUES (?, 'appointment_reminder', '+91 99999 73271', 'A1 Test Recipient', 'sent', 'spaced phone', '{}', ?, '')`
        )
        .run(spacedId, new Date().toISOString());
      const listed = listTenantOutboundEvents(DEMO_TENANT_ID);
      assert.ok(listed.some((row) => row.id === spacedId && row.patientPhone === "+91 99999 73271"));
      assert.equal(listed[0] && "patient_phone" in listed[0], false);
      assert.equal(typeof listed.find((row) => row.id === spacedId)?.eventType, "string");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("calendar send path imports Meta Graph helpers instead of a competing Graph POST", () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "whatsapp-calendar.ts"), "utf8");
    assert.match(src, /sendAppointmentReminder/);
    assert.match(src, /sendBookConfirmation/);
    assert.match(src, /dispatchWhatsAppCloudMessage/);
    assert.match(src, /tenantId: opts.tenantId/);
    assert.equal(src.includes("sendWhatsAppGraphCloudMessage"), false);
    assert.equal(src.includes("graph.facebook.com"), false);
  });
});
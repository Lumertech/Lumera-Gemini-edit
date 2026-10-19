import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getDb, initDatabase } from "./db.ts";
import {
  dispatchWhatsAppCloudMessage,
  FAILED_FINAL,
  isDemoWhatsAppAllowlisted,
  maskWhatsAppRecipient,
  sendPaymentReceipt,
  SKIPPED_NOT_ALLOWLISTED,
} from "./graph-whatsapp.ts";
import { hashPassword } from "./password.ts";
import { ensureTenantSubscription } from "./platform-tenants.ts";
import { recordWhatsAppOptIn } from "./whatsapp-opt-in.ts";
import { bookWhatsAppAppointment } from "./whatsapp-calendar.ts";
import {
  appointmentReminderSchedulerActive,
  notifyReceptionBooking,
  REMINDER_RETRY_BACKOFF_MS,
  runAppointmentReminders,
  startAppointmentReminderScheduler,
  stopAppointmentReminderScheduler,
} from "./whatsapp-calendar-reminders.ts";

const LIVE_TOKEN = "EAAGisAlongEnoughTokenWithoutEllipsis0123456789abcdef";
const LIVE_PHONE = "123456789012345";

let phoneSeq = 0;
function uniquePhone(): string {
  phoneSeq += 1;
  const n = `${Date.now()}${phoneSeq}${Math.floor(Math.random() * 900 + 100)}`.replace(/\D/g, "").slice(-10);
  return `+91${n}`;
}

function createDemoClinic(label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const doctorId = `doc-${label}-${suffix}`;
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Cedar ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, 'Dr Iyer', 'doctor', 'active', '+91 90000 11111', ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(userId, tenantId, `${label}.${suffix}@allowlist.example`, hashPassword("Lumera@2026"), `Cedar ${label}`, now, now);
  db.prepare(
    `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
     VALUES (?, ?, 'Dr Iyer', 'MBBS', ?, 'General Medicine', 8, 500, 'OPD-1', '["Mon"]', '09:00 AM - 01:00 PM', '+91 90000 11111', ?, '', '', '', 1)`
  ).run(doctorId, userId, `REG-${suffix}`, `${label}.${suffix}@allowlist.example`);
  ensureTenantSubscription(db, tenantId, { billingSource: "sandbox", status: "active" });
  return { tenantId, doctorId };
}

function captureLogs() {
  const lines: string[] = [];
  const prevWarn = console.warn;
  const prevInfo = console.info;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map((part) => String(part)).join(" "));
  };
  console.info = (...args: unknown[]) => {
    lines.push(args.map((part) => String(part)).join(" "));
  };
  return {
    lines,
    restore() {
      console.warn = prevWarn;
      console.info = prevInfo;
    },
  };
}

describe("demo WhatsApp recipient allowlist", () => {
  const saved: Record<string, string | undefined> = {};

  before(() => {
    initDatabase();
    for (const key of ["META_ACCESS_TOKEN", "META_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "DEMO_WHATSAPP_RECIPIENT_ALLOWLIST"]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    stopAppointmentReminderScheduler();
  });

  it("sends to nobody when the allowlist is unset and matches exact E.164 only", () => {
    delete process.env.DEMO_WHATSAPP_RECIPIENT_ALLOWLIST;
    assert.equal(isDemoWhatsAppAllowlisted("+919000000001"), false);
    assert.equal(isDemoWhatsAppAllowlisted("+91 90000 00001"), false);
    process.env.DEMO_WHATSAPP_RECIPIENT_ALLOWLIST = "+919000000001";
    assert.equal(isDemoWhatsAppAllowlisted("+919000000001"), true);
    assert.equal(isDemoWhatsAppAllowlisted("+91 90000 00001"), true);
    assert.equal(isDemoWhatsAppAllowlisted("+1 9000000001"), false);
    assert.equal(isDemoWhatsAppAllowlisted("9000000001"), false);
    assert.equal(maskWhatsAppRecipient("+919000000001"), "****0001");
    assert.equal(maskWhatsAppRecipient("+919000000001").includes("9000000001"), false);
    delete process.env.DEMO_WHATSAPP_RECIPIENT_ALLOWLIST;
  });

  it("rejects +1 9000000001 when +919000000001 is allowlisted and does not call Graph", async () => {
    process.env.DEMO_WHATSAPP_RECIPIENT_ALLOWLIST = "+919000000001";
    process.env.META_ACCESS_TOKEN = LIVE_TOKEN;
    process.env.META_PHONE_NUMBER_ID = LIVE_PHONE;
    const clinic = createDemoClinic("us");
    recordWhatsAppOptIn(getDb(), { tenantId: clinic.tenantId, phone: "+1 9000000001", optedIn: true, source: "test", actorId: "test" });
    let calls = 0;
    try {
      const sent = await sendPaymentReceipt({
        to: "+1 9000000001",
        patientName: "Asha Rao",
        clinicName: "Cedar us",
        amount: 500,
        invoiceId: `inv-us-${clinic.tenantId}`,
        textBody: "Receipt for Asha Rao",
        db: getDb(),
        tenantId: clinic.tenantId,
        fetchImpl: async () => {
          calls += 1;
          return new Response(JSON.stringify({ messages: [{ id: "wamid.US" }] }), { status: 200 });
        },
      });
      assert.equal(calls, 0);
      assert.equal(sent.ok, false);
      if (!sent.ok) assert.equal(sent.error, SKIPPED_NOT_ALLOWLISTED);
      const row = getDb()
        .prepare(`SELECT status FROM whatsapp_outbound_events WHERE event_type = 'invoice_receipt' AND patient_phone = ?`)
        .get("+1 9000000001") as { status: string };
      assert.equal(row.status, SKIPPED_NOT_ALLOWLISTED);
    } finally {
      delete process.env.DEMO_WHATSAPP_RECIPIENT_ALLOWLIST;
      delete process.env.META_ACCESS_TOKEN;
      delete process.env.META_PHONE_NUMBER_ID;
    }
  });

  it("skips a demo recipient that is not allowlisted and does not call Graph", async () => {
    const clinic = createDemoClinic("skip");
    const phone = uniquePhone();
    const booked = bookWhatsAppAppointment({
      tenantId: clinic.tenantId,
      patientPhone: phone,
      patientName: "Asha Rao",
      doctorId: clinic.doctorId,
      date: "2026-09-11",
      timeSlot: "10:30 AM",
    });
    let calls = 0;
    const logs = captureLogs();
    try {
      const run = await runAppointmentReminders({
        tenantId: clinic.tenantId,
        appointmentId: booked.appointment.id,
        now: new Date("2026-09-10T06:00:00.000Z"),
        fetchImpl: async () => {
          calls += 1;
          return new Response(JSON.stringify({ messages: [{ id: "wamid.SHOULD_NOT_SEND" }] }), { status: 200 });
        },
      });
      assert.equal(calls, 0);
      assert.equal(run.sent.length, 0);
      const row = getDb()
        .prepare(
          `SELECT status, details FROM whatsapp_outbound_events
           WHERE event_type = 'appointment_reminder' AND patient_phone = ?`
        )
        .get(booked.appointment.patientPhone) as { status: string; details: string };
      assert.equal(row.status, SKIPPED_NOT_ALLOWLISTED);
      const text = logs.lines.join("\n");
      assert.match(text, /skipped_not_allowlisted/);
      assert.match(text, new RegExp(`\\*\\*\\*\\*${phone.slice(-4)}`));
      assert.equal(text.includes(phone.replace(/\D/g, "")), false);
      assert.equal(row.details.includes(phone.replace(/\D/g, "")), false);
    } finally {
      logs.restore();
    }

    process.env.META_ACCESS_TOKEN = LIVE_TOKEN;
    process.env.META_PHONE_NUMBER_ID = LIVE_PHONE;
    recordWhatsAppOptIn(getDb(), { tenantId: clinic.tenantId, phone, optedIn: true, source: "test", actorId: "test" });
    let receiptCalls = 0;
    try {
      const receipt = await sendPaymentReceipt({
        to: phone,
        patientName: "Asha Rao",
        clinicName: "Cedar skip",
        amount: 500,
        invoiceId: `inv-${clinic.tenantId}`,
        textBody: "Receipt for Asha Rao",
        db: getDb(),
        tenantId: clinic.tenantId,
        fetchImpl: async () => {
          receiptCalls += 1;
          return new Response(JSON.stringify({ messages: [{ id: "wamid.RECEIPT" }] }), { status: 200 });
        },
      });
      assert.equal(receipt.ok, false);
      if (!receipt.ok) assert.equal(receipt.error, SKIPPED_NOT_ALLOWLISTED);
      assert.equal(receiptCalls, 0);
      const receiptRow = getDb()
        .prepare(
          `SELECT status FROM whatsapp_outbound_events WHERE event_type = 'invoice_receipt' AND patient_phone = ?`
        )
        .get(phone) as { status: string };
      assert.equal(receiptRow.status, SKIPPED_NOT_ALLOWLISTED);
    } finally {
      delete process.env.META_ACCESS_TOKEN;
      delete process.env.META_PHONE_NUMBER_ID;
    }
  });

  it("sends when the demo recipient is on DEMO_WHATSAPP_RECIPIENT_ALLOWLIST", async () => {
    const clinic = createDemoClinic("send");
    const phone = uniquePhone();
    process.env.DEMO_WHATSAPP_RECIPIENT_ALLOWLIST = phone;
    process.env.META_ACCESS_TOKEN = LIVE_TOKEN;
    process.env.META_PHONE_NUMBER_ID = LIVE_PHONE;
    assert.equal(isDemoWhatsAppAllowlisted("+919000000001"), false);
    const booked = bookWhatsAppAppointment({
      tenantId: clinic.tenantId,
      patientPhone: phone,
      patientName: "Asha Rao",
      doctorId: clinic.doctorId,
      date: "2026-09-11",
      timeSlot: "10:30 AM",
    });
    recordWhatsAppOptIn(getDb(), { tenantId: clinic.tenantId, phone, optedIn: true, source: "test", actorId: "test" });
    const stamped = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO meta_templates (id, tenant_id, waba_id, name, category, language, status, components, created_at, updated_at)
         VALUES (?, ?, '204800000000000', ?, 'UTILITY', 'en', 'APPROVED', '[]', ?, ?)`
      )
      .run(`tpl-rem-${clinic.tenantId}`, clinic.tenantId, "clinic_appointment_reminder", stamped, stamped);
    getDb()
      .prepare(
        `INSERT INTO meta_templates (id, tenant_id, waba_id, name, category, language, status, components, created_at, updated_at)
         VALUES (?, ?, '204800000000000', ?, 'UTILITY', 'en', 'APPROVED', '[]', ?, ?)`
      )
      .run(`tpl-book-${clinic.tenantId}`, clinic.tenantId, "clinic_booking_confirmation", stamped, stamped);
    let calls = 0;
    const logs = captureLogs();
    try {
      const run = await runAppointmentReminders({
        tenantId: clinic.tenantId,
        appointmentId: booked.appointment.id,
        now: new Date("2026-09-10T06:00:00.000Z"),
        fetchImpl: async (_input, init) => {
          calls += 1;
          const body = JSON.parse(String(init?.body || "{}")) as { type?: string; text?: unknown };
          assert.equal(body.type, "template");
          assert.equal(body.text, undefined);
          return new Response(JSON.stringify({ messages: [{ id: "wamid.ALLOW_OK" }] }), { status: 200 });
        },
      });
      assert.equal(calls, 1);
      assert.equal(run.sent.length, 1);
      const text = logs.lines.join("\n");
      assert.match(text, /allowlisted/);
      assert.equal(text.includes(phone.replace(/\D/g, "")), false);
      const row = getDb()
        .prepare(`SELECT status, action_payload FROM whatsapp_outbound_events WHERE event_type = 'appointment_reminder' AND patient_phone = ?`)
        .get(booked.appointment.patientPhone) as { status: string; action_payload: string };
      assert.equal(row.status, "sent");
      assert.equal(JSON.parse(row.action_payload).messageId, "wamid.ALLOW_OK");

      const notify = await notifyReceptionBooking({
        tenantId: clinic.tenantId,
        appointment: booked.appointment,
        fetchImpl: async () => {
          calls += 1;
          return new Response(JSON.stringify({ messages: [{ id: "wamid.BOOK_OK" }] }), { status: 200 });
        },
      });
      assert.equal(notify.sent, true);
      assert.equal(notify.wamid, "wamid.BOOK_OK");
      assert.equal(calls, 2);
    } finally {
      logs.restore();
      delete process.env.DEMO_WHATSAPP_RECIPIENT_ALLOWLIST;
      delete process.env.META_ACCESS_TOKEN;
      delete process.env.META_PHONE_NUMBER_ID;
    }
  });

  it("caps demo allowlist skips at 3 per appointment window and then marks failed_final", async () => {
    const clinic = createDemoClinic("cap");
    const phone = uniquePhone();
    const booked = bookWhatsAppAppointment({
      tenantId: clinic.tenantId,
      patientPhone: phone,
      patientName: "Meera Shah",
      doctorId: clinic.doctorId,
      date: "2026-09-11",
      timeSlot: "11:00 AM",
    });
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ messages: [{ id: "wamid.NO" }] }), { status: 200 });
    };
    const t0 = new Date("2026-09-10T06:00:00.000Z");
    const stamps = [
      t0,
      new Date(t0.getTime() + 10 * 60 * 1000),
      new Date(t0.getTime() + REMINDER_RETRY_BACKOFF_MS[0]),
      new Date(t0.getTime() + REMINDER_RETRY_BACKOFF_MS[0] + 30 * 60 * 1000),
      new Date(t0.getTime() + REMINDER_RETRY_BACKOFF_MS[0] + REMINDER_RETRY_BACKOFF_MS[1]),
      new Date(t0.getTime() + REMINDER_RETRY_BACKOFF_MS[0] + REMINDER_RETRY_BACKOFF_MS[1] + REMINDER_RETRY_BACKOFF_MS[2]),
    ];
    for (const now of stamps) {
      await runAppointmentReminders({
        tenantId: clinic.tenantId,
        appointmentId: booked.appointment.id,
        now,
        fetchImpl,
      });
    }
    assert.equal(calls, 0);
    const rows = getDb()
      .prepare(
        `SELECT status, action_payload FROM whatsapp_outbound_events
         WHERE event_type = 'appointment_reminder' AND patient_phone = ?`
      )
      .all(booked.appointment.patientPhone) as { status: string; action_payload: string }[];
    const attempts = rows.filter((row) => {
      const payload = JSON.parse(row.action_payload) as { appointmentId?: string };
      return payload.appointmentId === booked.appointment.id;
    });
    assert.deepEqual(
      attempts.map((row) => row.status),
      [SKIPPED_NOT_ALLOWLISTED, SKIPPED_NOT_ALLOWLISTED, FAILED_FINAL]
    );

    const again = await notifyReceptionBooking({
      tenantId: clinic.tenantId,
      appointment: booked.appointment,
      fetchImpl,
    });
    assert.equal(again.sent, false);
    assert.equal(again.reason, "not allowlisted");
    assert.equal(calls, 0);
    const bookingRows = getDb()
      .prepare(
        `SELECT status FROM whatsapp_outbound_events WHERE event_type = 'book_confirmation' AND patient_phone = ? ORDER BY rowid ASC`
      )
      .all(booked.appointment.patientPhone) as { status: string }[];
    assert.deepEqual(
      bookingRows.map((row) => row.status),
      [SKIPPED_NOT_ALLOWLISTED]
    );
    await notifyReceptionBooking({ tenantId: clinic.tenantId, appointment: booked.appointment, fetchImpl });
    await notifyReceptionBooking({ tenantId: clinic.tenantId, appointment: booked.appointment, fetchImpl });
    await notifyReceptionBooking({ tenantId: clinic.tenantId, appointment: booked.appointment, fetchImpl });
    const capped = getDb()
      .prepare(
        `SELECT status FROM whatsapp_outbound_events WHERE event_type = 'book_confirmation' AND patient_phone = ? ORDER BY rowid ASC`
      )
      .all(booked.appointment.patientPhone) as { status: string }[];
    assert.deepEqual(
      capped.map((row) => row.status),
      [SKIPPED_NOT_ALLOWLISTED, SKIPPED_NOT_ALLOWLISTED, FAILED_FINAL]
    );
    assert.equal(calls, 0);
    const capAudit = getDb()
      .prepare(`SELECT action, details FROM audit_logs WHERE action = 'whatsapp_demo_cap' AND tenant_id = ?`)
      .get(clinic.tenantId) as { action: string; details: string } | undefined;
    assert.equal(capAudit?.action, "whatsapp_demo_cap");
    assert.match(String(capAudit?.details || ""), /failed_final/);
    assert.equal(String(capAudit?.details || "").includes(phone.replace(/\D/g, "")), false);
  });

  it("counts the demo phone cap on the exact number, not the last 10 digits", async () => {
    delete process.env.DEMO_WHATSAPP_RECIPIENT_ALLOWLIST;
    const clinic = createDemoClinic("exact-cap");
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ messages: [{ id: "wamid.CAP" }] }), { status: 200 });
    };
    const india = "+919100000099";
    const statuses: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const sent = await dispatchWhatsAppCloudMessage({
        to: india,
        textBody: "hello",
        kind: "text",
        db: getDb(),
        tenantId: clinic.tenantId,
        fetchImpl,
        patientName: "Cap Patient",
      });
      assert.equal(sent.ok, false);
      if (!sent.ok) statuses.push(sent.error);
    }
    assert.deepEqual(statuses, [SKIPPED_NOT_ALLOWLISTED, SKIPPED_NOT_ALLOWLISTED, FAILED_FINAL, FAILED_FINAL]);
    const cousin = await dispatchWhatsAppCloudMessage({
      to: "+19100000099",
      textBody: "hello",
      kind: "text",
      db: getDb(),
      tenantId: clinic.tenantId,
      fetchImpl,
      patientName: "Cap Patient",
    });
    assert.equal(cousin.ok, false);
    if (!cousin.ok) assert.equal(cousin.error, SKIPPED_NOT_ALLOWLISTED);
    assert.equal(calls, 0);
  });

  it("APPOINTMENT_REMINDER_SCHEDULER off, false, and 0 do not start the scheduler", () => {
    const prevFlag = process.env.APPOINTMENT_REMINDER_SCHEDULER;
    const prevInterval = process.env.APPOINTMENT_REMINDER_INTERVAL_MS;
    process.env.APPOINTMENT_REMINDER_INTERVAL_MS = "3600000";
    try {
      stopAppointmentReminderScheduler();
      for (const flag of ["off", "false", "0"]) {
        process.env.APPOINTMENT_REMINDER_SCHEDULER = flag;
        startAppointmentReminderScheduler();
        assert.equal(appointmentReminderSchedulerActive(), false, flag);
      }
      process.env.APPOINTMENT_REMINDER_SCHEDULER = "true";
      startAppointmentReminderScheduler();
      assert.equal(appointmentReminderSchedulerActive(), true);
      stopAppointmentReminderScheduler();
      assert.equal(appointmentReminderSchedulerActive(), false);
    } finally {
      stopAppointmentReminderScheduler();
      if (prevFlag === undefined) delete process.env.APPOINTMENT_REMINDER_SCHEDULER;
      else process.env.APPOINTMENT_REMINDER_SCHEDULER = prevFlag;
      if (prevInterval === undefined) delete process.env.APPOINTMENT_REMINDER_INTERVAL_MS;
      else process.env.APPOINTMENT_REMINDER_INTERVAL_MS = prevInterval;
    }
  });
});

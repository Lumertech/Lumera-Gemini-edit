import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { ensureTenantSubscription } from "./platform-tenants.ts";
import { hashPassword } from "./password.ts";
import { resetSendOtpRateLimits } from "./otp-rate-limit.ts";
import { jsonRequest, startTestServer, type TestHttpServer } from "./test-http.ts";
import { OTP_PUBLIC_SEND_FAILURE } from "./otp-attempt.ts";
import { bookWhatsAppAppointment, runAppointmentReminders } from "./whatsapp-calendar.ts";
import { REMINDER_RETRY_BACKOFF_MS } from "./whatsapp-calendar-reminders.ts";
import { platformAdminActor, upsertWhatsAppNumber } from "./whatsapp-numbers.ts";
import { recordWhatsAppOptIn } from "./whatsapp-opt-in.ts";

const LIVE_TOKEN = "EAAGisAlongEnoughTokenWithoutEllipsis0123456789abcdef";
const LIVE_PHONE = "123456789012345";

let phoneSeq = 0;
function uniquePhone(): string {
  phoneSeq += 1;
  const n = `${Date.now()}${phoneSeq}${Math.floor(Math.random() * 900 + 100)}`.replace(/\D/g, "").slice(-10);
  return `+91${n}`;
}

function approveTemplate(tenantId: string, name: string, language = "en_US") {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO meta_templates (id, tenant_id, waba_id, name, category, language, status, components, created_at, updated_at)
       VALUES (?, ?, '204800000000000', ?, 'UTILITY', ?, 'APPROVED', '[]', ?, ?)`
    )
    .run(`tpl-${name}-${tenantId}`, tenantId, name, language, now, now);
}

function createClinic(label: string, clinicName = `Cedar ${label}`) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const doctorId = `doc-${label}-${suffix}`;
  const email = `${label}.${suffix}@wa-honesty.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, clinicName, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(userId, tenantId, email, hashPassword("Lumera@2026"), "Dr Iyer", "+91 90000 11111", clinicName, now, now);
  db.prepare(
    `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
     VALUES (?, ?, 'Dr Iyer', 'MBBS', ?, 'General Medicine', 8, 500, 'OPD-1', '["Mon","Tue","Wed","Thu","Fri"]', '09:00 AM - 01:00 PM', ?, ?, '', '', '', 1)`
  ).run(doctorId, userId, `REG-${suffix}`, "+91 90000 11111", email);
  return { tenantId, userId, doctorId, email, clinicName };
}

function connectClinic(tenantId: string) {
  const phoneNumberId = `9${String(Date.now()).slice(-14)}`;
  upsertWhatsAppNumber(platformAdminActor(), {
    ownerType: "tenant",
    ownerId: tenantId,
    wabaId: `2048${phoneNumberId.slice(0, 10)}`,
    phoneNumberId,
    metaAccessToken: "EAATenantHonestyTokenWithoutEllipsis0123456789abcd",
    metaWabaName: "Cedar Clinic",
    status: "connected",
  });
  return phoneNumberId;
}

function templateBodyParameters(payload: Record<string, unknown>): string[] {
  const template = payload.template as {
    components?: Array<{ type?: string; parameters?: Array<{ text?: string }> }>;
  };
  const body = template?.components?.find((component) => component.type === "body");
  return (body?.parameters || []).map((parameter) => String(parameter.text || ""));
}

describe("WhatsApp honesty: booking notify, reminder template, OTP wamid", () => {
  let server: TestHttpServer;
  const realFetch = globalThis.fetch;
  let graphCalls = 0;
  let graphMode: "ok" | "fail" | "empty" = "ok";
  const graphBodies: Array<Record<string, unknown>> = [];

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-whatsapp-honesty";
    initDatabase();
    globalThis.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("graph.facebook.com")) {
        graphCalls += 1;
        graphBodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
        if (graphMode === "fail") {
          return new Response(JSON.stringify({ error: { message: "Template rejected (#131000) META_ACCESS_TOKEN" } }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (graphMode === "empty") {
          return new Response(JSON.stringify({ messages: [{}] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ messages: [{ id: "wamid.HONESTY_OK" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return realFetch(input, init);
    };
    server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
    });
  });

  after(async () => {
    globalThis.fetch = realFetch;
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_PHONE_NUMBER_ID;
    await server.close();
  });

  async function login(email: string): Promise<string> {
    const res = await jsonRequest(server.port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || "login"));
    return String(res.json.token || "");
  }

  async function book(
    auth: Record<string, string>,
    patientId: string,
    doctorId: string,
    opts?: { whatsappOptIn?: boolean }
  ) {
    return jsonRequest(
      server.port,
      "POST",
      "/api/appointments",
      {
        patientId,
        doctorId,
        date: "2026-10-21",
        timeSlot: "09:30 AM",
        type: "New Consultation",
        source: "Walk-in",
        ...(opts?.whatsappOptIn ? { whatsappOptIn: true } : {}),
      },
      auth
    );
  }

  it("books and sends the tenant template, with clinic name in the body and a wamid", async () => {
    graphCalls = 0;
    graphBodies.length = 0;
    graphMode = "ok";
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_PHONE_NUMBER_ID;
    const clinic = createClinic("sent", "Cedar Clinic");
    connectClinic(clinic.tenantId);
    approveTemplate(clinic.tenantId, "clinic_booking_confirmation", "en");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const patientRes = await jsonRequest(
      server.port,
      "POST",
      "/api/patients",
      { name: "Asha Rao", phone: uniquePhone(), age: 34, gender: "Female" },
      auth
    );
    assert.equal(patientRes.status, 201, String(patientRes.json.error || ""));
    const patientId = String((patientRes.json.patient as { id: string }).id);
    const created = await book(auth, patientId, clinic.doctorId, { whatsappOptIn: true });
    assert.equal(created.status, 201, String(created.json.error || ""));
    const notify = created.json.notify as { sent?: boolean; wamid?: string; reason?: string };
    assert.equal(notify.sent, true);
    assert.equal(notify.wamid, "wamid.HONESTY_OK");
    assert.equal(graphCalls, 1);
    const parameters = templateBodyParameters(graphBodies[0]);
    assert.equal(parameters[0], "Asha");
    assert.equal(parameters[1], "Cedar Clinic");
    assert.equal(parameters[2], "Dr Iyer");
    for (const value of parameters) assert.equal(/lumera/i.test(value), false, value);
    assert.equal(graphBodies[0].type, "template");
    assert.equal(graphBodies[0].text, undefined);
    const template = graphBodies[0].template as { name?: string };
    assert.equal(template.name, "clinic_booking_confirmation");
    const phone = String((created.json.appointment as { patientPhone: string }).patientPhone);
    const event = getDb()
      .prepare(
        `SELECT status, action_payload, event_type FROM whatsapp_outbound_events
         WHERE event_type = 'book_confirmation' AND patient_phone = ? ORDER BY sent_at DESC LIMIT 1`
      )
      .get(phone) as { status: string; action_payload: string; event_type: string };
    assert.equal(event.event_type, "book_confirmation");
    assert.equal(event.status, "sent");
    const payload = JSON.parse(event.action_payload) as { messageId?: string };
    assert.equal(payload.messageId, "wamid.HONESTY_OK");
    assert.equal(bookingCopy(notify), "Booked, WhatsApp sent");
  });

  it("keeps the appointment when WhatsApp is not connected and says so", async () => {
    graphCalls = 0;
    graphBodies.length = 0;
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_PHONE_NUMBER_ID;
    const clinic = createClinic("offline", "Cedar Clinic");
    approveTemplate(clinic.tenantId, "clinic_booking_confirmation", "en");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const patientRes = await jsonRequest(
      server.port,
      "POST",
      "/api/patients",
      { name: "Asha Rao", phone: uniquePhone(), age: 34, gender: "Female" },
      auth
    );
    const patientId = String((patientRes.json.patient as { id: string }).id);
    const created = await book(auth, patientId, clinic.doctorId, { whatsappOptIn: true });
    assert.equal(created.status, 201, String(created.json.error || ""));
    assert.ok((created.json.appointment as { id: string }).id);
    const notify = created.json.notify as { sent?: boolean; wamid?: string; reason?: string };
    assert.equal(notify.sent, false);
    assert.equal(notify.wamid, undefined);
    assert.equal(notify.reason, "not connected");
    assert.equal(graphCalls, 0);
    const phone = String((created.json.appointment as { patientPhone: string }).patientPhone);
    const event = getDb()
      .prepare(
        `SELECT status, action_payload FROM whatsapp_outbound_events
         WHERE event_type = 'book_confirmation' AND patient_phone = ? ORDER BY sent_at DESC LIMIT 1`
      )
      .get(phone) as { status: string; action_payload: string };
    assert.equal(event.status, "failed");
    assert.equal(event.action_payload.includes("wamid"), false);
    assert.equal(bookingCopy(notify), "Booked, WhatsApp not sent: not connected");
  });

  it("keeps the appointment when Graph fails and does not claim the message was sent", async () => {
    graphCalls = 0;
    graphMode = "fail";
    const clinic = createClinic("gfail", "Cedar Clinic");
    connectClinic(clinic.tenantId);
    approveTemplate(clinic.tenantId, "clinic_booking_confirmation", "en");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const patientRes = await jsonRequest(
      server.port,
      "POST",
      "/api/patients",
      { name: "Asha Rao", phone: uniquePhone(), age: 34, gender: "Female" },
      auth
    );
    const patientId = String((patientRes.json.patient as { id: string }).id);
    const created = await book(auth, patientId, clinic.doctorId, { whatsappOptIn: true });
    graphMode = "ok";
    assert.equal(created.status, 201, String(created.json.error || ""));
    assert.ok((created.json.appointment as { id: string }).id);
    const notify = created.json.notify as { sent?: boolean; wamid?: string; reason?: string };
    assert.equal(notify.sent, false);
    assert.equal(notify.reason, "Graph error");
    assert.equal(notify.wamid, undefined);
    assert.equal(graphCalls, 1);
    const phone = String((created.json.appointment as { patientPhone: string }).patientPhone);
    const event = getDb()
      .prepare(
        `SELECT status FROM whatsapp_outbound_events
         WHERE event_type = 'book_confirmation' AND patient_phone = ? ORDER BY sent_at DESC LIMIT 1`
      )
      .get(phone) as { status: string };
    assert.equal(event.status, "failed");
    assert.equal(bookingCopy(notify), "Booked, WhatsApp not sent: Graph error");
  });

  it("reports no template and no phone without calling Graph", async () => {
    graphCalls = 0;
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_PHONE_NUMBER_ID;
    const clinic = createClinic("notpl", "Cedar Clinic");
    connectClinic(clinic.tenantId);
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const patientRes = await jsonRequest(
      server.port,
      "POST",
      "/api/patients",
      { name: "Asha Rao", phone: uniquePhone(), age: 34, gender: "Female" },
      auth
    );
    const patientId = String((patientRes.json.patient as { id: string }).id);
    const noTemplate = await book(auth, patientId, clinic.doctorId);
    assert.equal(noTemplate.status, 201, String(noTemplate.json.error || ""));
    const notify = noTemplate.json.notify as { sent?: boolean; reason?: string; wamid?: string };
    assert.equal(notify.sent, false);
    assert.equal(notify.reason, "no template");
    assert.equal(notify.wamid, undefined);
    assert.equal(graphCalls, 0);
    assert.equal(bookingCopy(notify), "Booked, WhatsApp not sent: no template");

    getDb().prepare("UPDATE patients SET phone = '' WHERE id = ?").run(patientId);
    approveTemplate(clinic.tenantId, "clinic_booking_confirmation", "en");
    const noPhone = await book(auth, patientId, clinic.doctorId);
    assert.equal(noPhone.status, 201, String(noPhone.json.error || ""));
    const phoneNotify = noPhone.json.notify as { sent?: boolean; reason?: string };
    assert.equal(phoneNotify.sent, false);
    assert.equal(phoneNotify.reason, "no phone");
    assert.equal(graphCalls, 0);
    assert.equal(bookingCopy(phoneNotify), "Booked, WhatsApp not sent: no phone");
  });

  it("demo clinics use lumera_appointment_booked and the clinic display name, not a hardcoded clinic", async () => {
    graphCalls = 0;
    graphBodies.length = 0;
    graphMode = "ok";
    process.env.META_ACCESS_TOKEN = LIVE_TOKEN;
    process.env.META_PHONE_NUMBER_ID = LIVE_PHONE;
    process.env.META_BOOK_CONFIRMATION_TEMPLATE_NAME = "lumera_appointment_booked";
    process.env.META_UTILITY_TEMPLATE_LANGUAGE = "en_US";
    const clinic = createClinic("demo", "Cedar Clinic");
    ensureTenantSubscription(getDb(), clinic.tenantId, { billingSource: "demo" });
    const phone = uniquePhone();
    process.env.DEMO_WHATSAPP_RECIPIENT_ALLOWLIST = phone;
    let created: Awaited<ReturnType<typeof book>>;
    try {
      const token = await login(clinic.email);
      const auth = { Authorization: `Bearer ${token}` };
      const patientRes = await jsonRequest(
        server.port,
        "POST",
        "/api/patients",
        { name: "Asha Rao", phone, age: 34, gender: "Female" },
        auth
      );
      const patientId = String((patientRes.json.patient as { id: string }).id);
      created = await book(auth, patientId, clinic.doctorId, { whatsappOptIn: true });
    } finally {
      delete process.env.META_ACCESS_TOKEN;
      delete process.env.META_PHONE_NUMBER_ID;
      delete process.env.META_BOOK_CONFIRMATION_TEMPLATE_NAME;
      delete process.env.META_UTILITY_TEMPLATE_LANGUAGE;
      delete process.env.DEMO_WHATSAPP_RECIPIENT_ALLOWLIST;
    }
    assert.equal(created.status, 201, String(created.json.error || ""));
    const notify = created.json.notify as { sent?: boolean; wamid?: string };
    assert.equal(notify.sent, true);
    assert.equal(notify.wamid, "wamid.HONESTY_OK");
    const template = graphBodies[0].template as { name?: string; language?: { code?: string } };
    assert.equal(template.name, "lumera_appointment_booked");
    assert.equal(template.language?.code, "en_US");
    const parameters = templateBodyParameters(graphBodies[0]);
    assert.equal(parameters[0], "Asha");
    assert.equal(parameters[1], "Cedar Clinic");
    for (const value of parameters) assert.equal(/lumera/i.test(value), false, value);
  });

  it("reminders send only an approved template and stop after 3 failures", async () => {
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_PHONE_NUMBER_ID;
    const clinic = createClinic("rem", "Cedar Clinic");
    const booked = bookWhatsAppAppointment({
      tenantId: clinic.tenantId,
      patientPhone: uniquePhone(),
      patientName: "Asha Rao",
      doctorId: clinic.doctorId,
      date: "2026-09-11",
      timeSlot: "10:30 AM",
    });
    let calls = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      assert.equal(body.type, "template");
      assert.equal(body.text, undefined);
      assert.equal(JSON.stringify(body).includes("Appointment reminder"), false);
      return new Response(JSON.stringify({ error: { message: "Graph down" } }), { status: 500 });
    };
    const bare = await runAppointmentReminders({
      tenantId: clinic.tenantId,
      appointmentId: booked.appointment.id,
      now: new Date("2026-09-10T06:00:00.000Z"),
      fetchImpl,
    });
    assert.equal(calls, 0);
    assert.equal(bare.failed.length, 1);
    assert.equal(bare.failed[0].result.ok, false);
    if (!bare.failed[0].result.ok) assert.equal(bare.failed[0].result.error, "no_approved_template");

    approveTemplate(clinic.tenantId, "clinic_appointment_reminder", "en");
    connectClinic(clinic.tenantId);
    const retryPhone = uniquePhone();
    recordWhatsAppOptIn(getDb(), { tenantId: clinic.tenantId, phone: retryPhone, optedIn: true, source: "test", actorId: "test" });
    const retryTarget = bookWhatsAppAppointment({
      tenantId: clinic.tenantId,
      patientPhone: retryPhone,
      patientName: "Meera Shah",
      doctorId: clinic.doctorId,
      date: "2026-09-11",
      timeSlot: "11:00 AM",
    });
    const t0 = new Date("2026-09-10T06:00:00.000Z");
    const stamps = [
      t0,
      new Date(t0.getTime() + 10 * 60 * 1000),
      new Date(t0.getTime() + REMINDER_RETRY_BACKOFF_MS[0]),
      new Date(t0.getTime() + REMINDER_RETRY_BACKOFF_MS[0] + 30 * 60 * 1000),
      new Date(t0.getTime() + REMINDER_RETRY_BACKOFF_MS[0] + REMINDER_RETRY_BACKOFF_MS[1]),
      new Date(t0.getTime() + REMINDER_RETRY_BACKOFF_MS[0] + REMINDER_RETRY_BACKOFF_MS[1] + REMINDER_RETRY_BACKOFF_MS[2]),
    ];
    const callsAt: number[] = [];
    for (const now of stamps) {
      await runAppointmentReminders({
        tenantId: clinic.tenantId,
        appointmentId: retryTarget.appointment.id,
        now,
        fetchImpl,
      });
      callsAt.push(calls);
    }
    assert.deepEqual(callsAt, [1, 1, 2, 2, 3, 3]);
    const rows = getDb()
      .prepare(
        `SELECT status, action_payload FROM whatsapp_outbound_events
         WHERE event_type = 'appointment_reminder' AND patient_phone = ? AND status = 'failed'`
      )
      .all(retryTarget.appointment.patientPhone) as { status: string; action_payload: string }[];
    const attempts = rows.filter((row) => {
      const payload = JSON.parse(row.action_payload) as { appointmentId?: string; reason?: string; permanent?: boolean };
      return payload.appointmentId === retryTarget.appointment.id && payload.reason !== "no_approved_template";
    });
    assert.equal(attempts.length, 3);
    assert.equal(attempts.some((row) => JSON.parse(row.action_payload).permanent === true), true);
  });

  it("a successful reminder template carries clinic and doctor names and no plain text", async () => {
    const clinic = createClinic("remok", "Cedar Clinic");
    connectClinic(clinic.tenantId);
    approveTemplate(clinic.tenantId, "clinic_appointment_reminder", "en_US");
    const reminderPhone = uniquePhone();
    recordWhatsAppOptIn(getDb(), { tenantId: clinic.tenantId, phone: reminderPhone, optedIn: true, source: "test", actorId: "test" });
    const booked = bookWhatsAppAppointment({
      tenantId: clinic.tenantId,
      patientPhone: reminderPhone,
      patientName: "Asha Rao",
      doctorId: clinic.doctorId,
      date: "2026-09-11",
      timeSlot: "10:30 AM",
    });
    const bodies: Array<Record<string, unknown>> = [];
    const run = await runAppointmentReminders({
      tenantId: clinic.tenantId,
      appointmentId: booked.appointment.id,
      now: new Date("2026-09-10T06:00:00.000Z"),
      fetchImpl: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
        return new Response(JSON.stringify({ messages: [{ id: "wamid.REMIND_OK" }] }), { status: 200 });
      },
    });
    assert.equal(run.sent.length, 1);
    assert.equal(bodies[0].type, "template");
    assert.equal(bodies[0].text, undefined);
    const template = bodies[0].template as { name?: string; language?: { code?: string } };
    assert.equal(template.name, "clinic_appointment_reminder");
    assert.equal(template.language?.code, "en_US");
    const parameters = templateBodyParameters(bodies[0]);
    assert.equal(parameters[0], "Asha");
    assert.equal(parameters[1], "Cedar Clinic");
    assert.equal(parameters[2], "Dr Iyer");
    for (const value of parameters) assert.equal(/lumera/i.test(value), false, value);
    assert.equal(JSON.stringify(bodies[0]).includes("lumera_appointment_reminder"), false);
  });

  it("a failed OTP is consumed, and the retry makes a fresh Graph call that needs a wamid", async () => {
    resetSendOtpRateLimits();
    graphCalls = 0;
    graphMode = "fail";
    process.env.META_ACCESS_TOKEN = LIVE_TOKEN;
    process.env.META_PHONE_NUMBER_ID = LIVE_PHONE;
    const phone = `+91 97${String(Date.now()).slice(-8)}`;
    const email = `otp.${phone.replace(/\D/g, "")}@wa-honesty.example`;
    const first = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/send-otp", {
      phone,
      email,
      purpose: "login",
      name: "Dr Iyer",
    });
    assert.equal(first.status, 503, String(first.json.error || ""));
    assert.equal(first.json.error, OTP_PUBLIC_SEND_FAILURE);
    assert.equal(first.json.otpDelivered, false);
    assert.equal(JSON.stringify(first.json).includes("Template rejected"), false);
    assert.equal(JSON.stringify(first.json).includes("META_ACCESS_TOKEN"), false);
    assert.equal(JSON.stringify(first.json).includes("META_PHONE_NUMBER_ID"), false);
    assert.notEqual(first.json.message, "Pending verification reused.");
    assert.equal(first.json.wamid, undefined);
    assert.equal(/sent via WhatsApp/i.test(String(first.json.message || first.json.error || "")), false);
    const failedId = String(first.json.verificationId || "");
    const row = getDb()
      .prepare("SELECT otp, failed_attempts, verified_at FROM otp_verifications WHERE phone = ? ORDER BY created_at DESC LIMIT 1")
      .get(phone) as { otp: string; failed_attempts: number; verified_at: string | null };
    assert.equal(String(row.otp || ""), "");
    assert.ok(Number(row.failed_attempts) >= 5);
    assert.ok(row.verified_at);
    assert.equal(graphCalls, 1);

    graphMode = "ok";
    const second = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/send-otp", {
      phone,
      email,
      purpose: "login",
      name: "Dr Iyer",
    });
    assert.equal(second.status, 200, String(second.json.error || ""));
    assert.notEqual(second.json.reused, true);
    assert.notEqual(second.json.message, "Pending verification reused.");
    assert.notEqual(String(second.json.verificationId || ""), failedId);
    assert.equal(second.json.wamid, "wamid.HONESTY_OK");
    assert.match(String(second.json.message || ""), /sent via WhatsApp Cloud API/i);
    assert.equal(graphCalls, 2);

    const reused = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/send-otp", {
      phone,
      email,
      purpose: "login",
      name: "Dr Iyer",
    });
    assert.equal(reused.status, 200, String(reused.json.error || ""));
    assert.equal(reused.json.reused, true);
    assert.equal(graphCalls, 2);

    resetSendOtpRateLimits();
    graphMode = "empty";
    const emptyPhone = `+91 96${String(Date.now()).slice(-8)}`;
    const empty = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/send-otp", {
      phone: emptyPhone,
      email: `empty.${emptyPhone.replace(/\D/g, "")}@wa-honesty.example`,
      purpose: "login",
    });
    assert.equal(empty.status, 503);
    assert.equal(empty.json.error, OTP_PUBLIC_SEND_FAILURE);
    assert.equal(empty.json.wamid, undefined);
    assert.equal(/6-digit OTP sent/i.test(JSON.stringify(empty.json)), false);
    assert.equal(JSON.stringify(empty.json).includes("message id"), false);
    const noWamidAudit = getDb()
      .prepare(`SELECT action FROM audit_logs WHERE action = 'whatsapp_otp_no_wamid' ORDER BY timestamp DESC LIMIT 1`)
      .get() as { action: string } | undefined;
    assert.equal(noWamidAudit?.action, "whatsapp_otp_no_wamid");
    graphMode = "ok";
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_PHONE_NUMBER_ID;
    const prevNode = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    resetSendOtpRateLimits();
    const barePhone = `+91 95${String(Date.now()).slice(-8)}`;
    const bare = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/send-otp", {
      phone: barePhone,
      email: `bare.${barePhone.replace(/\D/g, "")}@wa-honesty.example`,
      purpose: "login",
    });
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    assert.equal(bare.status, 503, String(bare.json.error || ""));
    assert.equal(bare.json.error, OTP_PUBLIC_SEND_FAILURE);
    assert.equal(JSON.stringify(bare.json).includes("META_ACCESS_TOKEN"), false);
    assert.equal(JSON.stringify(bare.json).includes("META_PHONE_NUMBER_ID"), false);
    resetSendOtpRateLimits();
  });

  it("does not send a booking or reminder without WhatsApp opt-in, including after STOP", async () => {
    graphCalls = 0;
    graphBodies.length = 0;
    graphMode = "ok";
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_PHONE_NUMBER_ID;
    const clinic = createClinic("optin", "Cedar Clinic");
    connectClinic(clinic.tenantId);
    approveTemplate(clinic.tenantId, "clinic_booking_confirmation", "en");
    approveTemplate(clinic.tenantId, "clinic_appointment_reminder", "en");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const phone = uniquePhone();
    const patientRes = await jsonRequest(
      server.port,
      "POST",
      "/api/patients",
      { name: "Asha Rao", phone, age: 34, gender: "Female" },
      auth
    );
    const patientId = String((patientRes.json.patient as { id: string }).id);
    const created = await book(auth, patientId, clinic.doctorId);
    assert.equal(created.status, 201, String(created.json.error || ""));
    assert.ok((created.json.appointment as { id: string }).id);
    const notify = created.json.notify as { sent?: boolean; wamid?: string; reason?: string };
    assert.equal(notify.sent, false);
    assert.equal(notify.wamid, undefined);
    assert.equal(notify.reason, "no WhatsApp opt-in");
    assert.equal(graphCalls, 0);
    assert.equal(bookingCopy(notify), "Booked, WhatsApp not sent: no WhatsApp opt-in");

    const stoppedPhone = uniquePhone();
    recordWhatsAppOptIn(getDb(), {
      tenantId: clinic.tenantId,
      phone: stoppedPhone,
      optedIn: false,
      source: "stop",
      actorId: "test",
    });
    const stopped = bookWhatsAppAppointment({
      tenantId: clinic.tenantId,
      patientPhone: stoppedPhone,
      patientName: "Meera Shah",
      doctorId: clinic.doctorId,
      date: "2026-09-11",
      timeSlot: "10:30 AM",
    });
    let reminderCalls = 0;
    const run = await runAppointmentReminders({
      tenantId: clinic.tenantId,
      appointmentId: stopped.appointment.id,
      now: new Date("2026-09-10T06:00:00.000Z"),
      fetchImpl: async () => {
        reminderCalls += 1;
        return new Response(JSON.stringify({ messages: [{ id: "wamid.SHOULD_NOT" }] }), { status: 200 });
      },
    });
    assert.equal(reminderCalls, 0);
    assert.equal(run.sent.length, 0);
    assert.equal(run.failed.length, 1);
    assert.equal(run.failed[0].result.ok, false);
    if (!run.failed[0].result.ok) assert.equal(run.failed[0].result.error, "no WhatsApp opt-in");
  });
});

function bookingCopy(notify: { sent?: boolean; wamid?: string; reason?: string }): string {
  const wamid = String(notify.wamid || "").trim();
  if (notify.sent === true && wamid) return "Booked, WhatsApp sent";
  return `Booked, WhatsApp not sent: ${notify.reason || "Graph error"}`;
}

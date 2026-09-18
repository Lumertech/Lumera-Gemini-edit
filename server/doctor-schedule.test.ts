import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createApiRouter } from "./api.ts";
import { createDoctorScheduleRouter } from "./doctor-schedule-api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { decryptSecret, encryptSecret } from "./token-crypto.ts";
import {
  generateAvailableSlots,
  parseTimeToMinutes,
  replaceWeeklySchedule,
  type DoctorOverrideRow,
  type ScheduleShift,
} from "./doctor-schedule.ts";
import {
  googleCalendarDialogUrl,
  googleCalendarRedirectUri,
  signGoogleCalendarOAuthState,
  verifyGoogleCalendarOAuthState,
} from "./google-calendar-oauth.ts";
import {
  GOOGLE_CALENDAR_TEST_CLIENT_ID,
  GOOGLE_CALENDAR_TEST_EMAIL,
  installGoogleCalendarNetworkGuard,
  setGoogleCalendarFetchImpl,
} from "./google-calendar-http.ts";
import {
  getGoogleCalendarIntegration,
  saveGoogleCalendarTokens,
  syncGoogleBusyBlocks,
} from "./google-calendar-sync.ts";

function saveEnv(names: string[]): () => void {
  const prev: Record<string, string | undefined> = {};
  for (const name of names) prev[name] = process.env[name];
  return () => {
    for (const name of names) {
      if (prev[name] === undefined) delete process.env[name];
      else process.env[name] = prev[name];
    }
  };
}

function createClinic(label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const doctorId = `doc-${label}-${suffix}`;
  const email = `${label}.${suffix}@schedule-test.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Clinic ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(userId, tenantId, email, hashPassword("Lumera@2026"), `Dr ${label}`, "+91 90000 11111", `Clinic ${label}`, now, now);
  db.prepare(
    `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
     VALUES (?, ?, ?, '', '', 'General Medicine', 0, 500, '', '["Mon","Tue","Wed","Thu","Fri"]', '09:00 AM - 01:00 PM, 05:00 PM - 08:00 PM', ?, ?, '', '', '', 1)`
  ).run(doctorId, userId, `Dr ${label}`, "+91 90000 11111", email);
  return { tenantId, userId, doctorId, email };
}

describe("doctor schedule slot engine", () => {
  it("subtracts blocked windows, Google busy, and booked appointments from recurring shifts", () => {
    const monday = "2026-09-14";
    const schedules: ScheduleShift[] = [
      { dayOfWeek: 1, startTime: "09:00", endTime: "13:00", slotDurationMinutes: 30, isActive: true },
      { dayOfWeek: 1, startTime: "17:00", endTime: "20:00", slotDurationMinutes: 30, isActive: true },
    ];
    const overrides: DoctorOverrideRow[] = [
      {
        id: "ov-1",
        doctorId: "doc-1",
        overrideDate: monday,
        overrideType: "BLOCKED",
        customStartTime: "09:00",
        customEndTime: "10:00",
        reason: "CME",
        source: "manual",
        googleEventId: null,
      },
      {
        id: "ov-2",
        doctorId: "doc-1",
        overrideDate: monday,
        overrideType: "BLOCKED",
        customStartTime: "17:00",
        customEndTime: "18:00",
        reason: "Personal",
        source: "google_busy",
        googleEventId: "evt-1",
      },
    ];
    const slots = generateAvailableSlots({
      date: monday,
      schedules,
      overrides,
      doctorId: "doc-1",
      appointments: [{ date: monday, timeSlot: "10:30 AM", doctorId: "doc-1", status: "Waiting" }],
    });
    const available = slots.filter((s) => s.available).map((s) => s.timeSlot);
    assert.equal(available.includes("09:00 AM"), false);
    assert.equal(available.includes("09:30 AM"), false);
    assert.equal(available.includes("10:30 AM"), false);
    assert.equal(available.includes("10:00 AM"), true);
    assert.equal(available.includes("05:00 PM"), false);
    assert.equal(available.includes("05:30 PM"), false);
    assert.equal(available.includes("06:00 PM"), true);
    assert.ok(parseTimeToMinutes("13:00") === 13 * 60);
  });

  it("full-day BLOCKED leave yields no slots; CUSTOM_HOURS replaces the weekly template", () => {
    const date = "2026-09-15";
    const schedules: ScheduleShift[] = [
      { dayOfWeek: 2, startTime: "09:00", endTime: "13:00", slotDurationMinutes: 20, isActive: true },
    ];
    const leave = generateAvailableSlots({
      date,
      schedules,
      doctorId: "doc-1",
      overrides: [
        {
          id: "leave",
          doctorId: "doc-1",
          overrideDate: date,
          overrideType: "BLOCKED",
          customStartTime: null,
          customEndTime: null,
          reason: "Holiday",
          source: "manual",
          googleEventId: null,
        },
      ],
    });
    assert.deepEqual(leave, []);

    const custom = generateAvailableSlots({
      date,
      schedules,
      doctorId: "doc-1",
      overrides: [
        {
          id: "custom",
          doctorId: "doc-1",
          overrideDate: date,
          overrideType: "CUSTOM_HOURS",
          customStartTime: "11:00",
          customEndTime: "12:00",
          reason: "Half day",
          source: "manual",
          googleEventId: null,
        },
      ],
    });
    assert.deepEqual(
      custom.filter((s) => s.available).map((s) => s.startTime),
      ["11:00", "11:20", "11:40"]
    );
  });
});

describe("Google Calendar OAuth helpers", () => {
  const restore = saveEnv(["APP_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_CALENDAR_REDIRECT_URI", "JWT_SECRET"]);
  after(restore);

  it("documents the Calendar callback URI and requests event scopes with offline access", () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const envEx = fs.readFileSync(path.join(root, ".env.example"), "utf8");
    assert.match(envEx, /\/api\/tenant\/doctor\/google-calendar\/callback/);
    assert.match(envEx, /calendar\.events/);
    process.env.APP_URL = "https://www.mylumera.in";
    delete process.env.GOOGLE_CALENDAR_REDIRECT_URI;
    assert.equal(
      googleCalendarRedirectUri(),
      "https://www.mylumera.in/api/tenant/doctor/google-calendar/callback"
    );
    process.env.GOOGLE_CLIENT_ID = "1234567890-abc.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-unit-test-not-a-real-secret";
    const url = new URL(
      googleCalendarDialogUrl({
        redirectUri: googleCalendarRedirectUri(),
        state: "unit-state",
      })
    );
    assert.match(url.searchParams.get("scope") || "", /calendar\.events\.readonly/);
    assert.match(url.searchParams.get("scope") || "", /calendar\.events/);
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
  });

  it("round-trips encrypted tokens and Calendar OAuth state", () => {
    process.env.JWT_SECRET = "test-jwt-secret-gcal-crypto";
    const enc = encryptSecret("ya29.access-token");
    assert.notEqual(enc, "ya29.access-token");
    assert.equal(decryptSecret(enc), "ya29.access-token");
    const state = signGoogleCalendarOAuthState({ doctorId: "doc-1", userId: "user-1", tenantId: "tenant-1" });
    assert.deepEqual(verifyGoogleCalendarOAuthState(state), {
      doctorId: "doc-1",
      userId: "user-1",
      tenantId: "tenant-1",
    });
  });
});

describe("doctor schedule HTTP + Google Calendar sync", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  const restore = saveEnv(["JWT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "APP_URL", "NODE_ENV", "CI"]);

  before(async () => {
    process.env.NODE_ENV = process.env.NODE_ENV || "test";
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-doctor-schedule";
    process.env.GOOGLE_CLIENT_ID = "1234567890-abc.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-unit-test-not-a-real-secret";
    process.env.APP_URL = "http://127.0.0.1";
    installGoogleCalendarNetworkGuard();
    setGoogleCalendarFetchImpl(null);
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const server = await startTestServer((app) => {
      app.use("/api", createDoctorScheduleRouter());
      app.use("/api", createApiRouter());
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    setGoogleCalendarFetchImpl(null);
    restore();
    await close?.();
  });

  async function login(email: string): Promise<string> {
    const loginRes = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(loginRes.status, 200, String(loginRes.json.error || "login failed"));
    return String(loginRes.json.token || "");
  }

  it("rejects unauthenticated schedule reads", async () => {
    const res = await jsonRequest(port, "GET", "/api/tenant/doctor/schedule");
    assert.equal(res.status, 401);
  });

  it("saves weekly shifts, leaves, and generates slots minus booked appointments", async () => {
    const clinic = createClinic("sched");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };

    const saved = await jsonRequest(
      port,
      "PUT",
      "/api/tenant/doctor/schedule",
      {
        doctorId: clinic.doctorId,
        slotDurationMinutes: 15,
        days: [
          { dayOfWeek: 1, isActive: true, shifts: [{ startTime: "09:00", endTime: "11:00" }] },
          { dayOfWeek: 2, isActive: false, shifts: [] },
        ],
      },
      auth
    );
    assert.equal(saved.status, 200, String(saved.json.error || ""));
    const days = saved.json.days as Array<{ dayOfWeek: number; isActive: boolean; shifts: unknown[] }>;
    const monday = days.find((d) => d.dayOfWeek === 1);
    assert.equal(monday?.isActive, true);
    assert.equal(monday?.shifts.length, 1);

    const leave = await jsonRequest(
      port,
      "POST",
      "/api/tenant/doctor/overrides",
      {
        doctorId: clinic.doctorId,
        startDate: "2026-09-21",
        endDate: "2026-09-21",
        overrideType: "BLOCKED",
        reason: "Festival",
      },
      auth
    );
    assert.equal(leave.status, 201, String(leave.json.error || ""));

    const closed = await jsonRequest(
      port,
      "GET",
      `/api/tenant/doctor/schedule/slots?doctorId=${clinic.doctorId}&date=2026-09-21`,
      undefined,
      auth
    );
    assert.equal(closed.status, 200);
    assert.deepEqual(closed.json.slots, []);

    const open = await jsonRequest(
      port,
      "GET",
      `/api/tenant/doctor/schedule/slots?doctorId=${clinic.doctorId}&date=2026-09-14`,
      undefined,
      auth
    );
    assert.equal(open.status, 200);
    const slots = open.json.slots as Array<{ timeSlot: string; available: boolean }>;
    assert.ok(slots.length >= 4);
    assert.equal(slots[0].timeSlot, "09:00 AM");
  });

  it("redirects Calendar connect to Google with calendar.events scopes", async () => {
    const clinic = createClinic("gcalauth");
    const token = await login(clinic.email);
    const res = await fetch(
      `http://127.0.0.1:${port}/api/tenant/doctor/google-calendar/auth?doctorId=${clinic.doctorId}`,
      { redirect: "manual", headers: { Authorization: `Bearer ${token}` } }
    );
    assert.equal(res.status, 302);
    const location = res.headers.get("location") || "";
    assert.match(location, /accounts\.google\.com\/o\/oauth2\/v2\/auth/);
    assert.match(location, /calendar\.events/);
    assert.match(location, /access_type=offline/);
  });

  it("starts Calendar OAuth with dummy client id when GOOGLE_CLIENT_* are unset", async () => {
    const prevId = process.env.GOOGLE_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    try {
      const clinic = createClinic("gcaldummy");
      const token = await login(clinic.email);
      const res = await fetch(
        `http://127.0.0.1:${port}/api/tenant/doctor/google-calendar/auth?doctorId=${clinic.doctorId}`,
        { redirect: "manual", headers: { Authorization: `Bearer ${token}` } }
      );
      assert.equal(res.status, 302);
      const location = res.headers.get("location") || "";
      assert.match(location, /accounts\.google\.com\/o\/oauth2\/v2\/auth/);
      assert.match(location, new RegExp(GOOGLE_CALENDAR_TEST_CLIENT_ID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    } finally {
      if (prevId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = prevId;
      if (prevSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = prevSecret;
    }
  });

  it("exchanges a Calendar callback code through the mock without calling Google", async () => {
    setGoogleCalendarFetchImpl(null);
    const clinic = createClinic("gcalcb");
    const state = signGoogleCalendarOAuthState({
      doctorId: clinic.doctorId,
      userId: clinic.userId,
      tenantId: clinic.tenantId,
    });
    const res = await fetch(
      `http://127.0.0.1:${port}/api/tenant/doctor/google-calendar/callback?code=unit-code&state=${encodeURIComponent(state)}`,
      { redirect: "manual" }
    );
    assert.equal(res.status, 302);
    const location = res.headers.get("location") || "";
    assert.match(location, /gcal=connected/);
    const row = getGoogleCalendarIntegration(clinic.doctorId);
    assert.equal(row?.connected, true);
    assert.equal(row?.connectedEmail, GOOGLE_CALENDAR_TEST_EMAIL);
  });

  it("webhook resyncs FreeBusy blocks and outbound booking pushes a Calendar event", async () => {
    const clinic = createClinic("gcalpush");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    replaceWeeklySchedule({
      doctorId: clinic.doctorId,
      slotDurationMinutes: 15,
      days: [{ dayOfWeek: 1, isActive: true, shifts: [{ startTime: "09:00", endTime: "12:00" }] }],
    });
    await saveGoogleCalendarTokens({
      doctorId: clinic.doctorId,
      accessToken: "ya29.test-access",
      refreshToken: "1//test-refresh",
      expiresIn: 3600,
      email: "dr.smith@gmail.com",
    });
    getDb()
      .prepare("UPDATE google_calendar_integrations SET channel_id = ?, resource_id = ? WHERE doctor_id = ?")
      .run("channel-1", "resource-1", clinic.doctorId);

    const calls: Array<{ url: string; method: string; body: string }> = [];
    setGoogleCalendarFetchImpl(async (input, init) => {
      const url = String(input);
      const method = String(init?.method || "GET");
      const body = typeof init?.body === "string" ? init.body : "";
      calls.push({ url, method, body });
      if (url.includes("/freeBusy")) {
        return new Response(
          JSON.stringify({
            calendars: {
              primary: {
                busy: [{ start: "2026-09-14T04:00:00Z", end: "2026-09-14T05:00:00Z" }],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes("/events") && method === "POST") {
        return new Response(JSON.stringify({ id: "gcal-evt-99" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const hook = await jsonRequest(port, "POST", "/api/webhooks/google-calendar", {}, {
      "X-Goog-Channel-ID": "channel-1",
      "X-Goog-Resource-ID": "resource-1",
      "X-Goog-Resource-State": "exists",
    });
    assert.equal(hook.status, 200, String(hook.json.error || ""));
    await syncGoogleBusyBlocks(clinic.doctorId);
    const slots = await jsonRequest(
      port,
      "GET",
      `/api/tenant/doctor/schedule/slots?doctorId=${clinic.doctorId}&date=2026-09-14`,
      undefined,
      auth
    );
    const available = (slots.json.slots as Array<{ timeSlot: string; available: boolean }>)
      .filter((s) => s.available)
      .map((s) => s.timeSlot);
    assert.equal(available.includes("09:30 AM"), false);

    const patient = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Kiran Shah", phone: "+91 98200 44001", age: 38, gender: "Female" },
      auth
    );
    assert.equal(patient.status, 201, String(patient.json.error || ""));
    const patientId = (patient.json.patient as { id: string }).id;
    const booked = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      {
        patientId,
        doctorId: clinic.doctorId,
        date: "2026-09-14",
        timeSlot: "10:00 AM",
        type: "New Consultation",
      },
      auth
    );
    assert.equal(booked.status, 201, String(booked.json.error || ""));
    const appointmentId = (booked.json.appointment as { id: string }).id;
    let mapped: { google_event_id?: string } | undefined;
    for (let i = 0; i < 40; i++) {
      mapped = getDb()
        .prepare("SELECT google_event_id FROM google_calendar_event_map WHERE appointment_id = ?")
        .get(appointmentId) as { google_event_id?: string } | undefined;
      if (mapped?.google_event_id) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(calls.some((c) => c.url.includes("/calendars/primary/events") && c.method === "POST"));
    assert.equal(mapped?.google_event_id, "gcal-evt-99");
    setGoogleCalendarFetchImpl(null);
  });
});

describe("doctor schedule founder docs", () => {
  it("keeps Connect Google Calendar in clinic settings", () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const ui = fs.readFileSync(path.join(root, "src/components/DoctorScheduleSettings.tsx"), "utf8");
    const clinic = fs.readFileSync(path.join(root, "src/components/ClinicProfileSettings.tsx"), "utf8");
    const serverSrc = fs.readFileSync(path.join(root, "server.ts"), "utf8");
    assert.match(ui, /Connect Google Calendar/);
    assert.match(ui, /Block OPD slots for personal Google Calendar events/);
    assert.match(ui, /Push Lumera appointments to Google Calendar/);
    assert.match(clinic, /DoctorScheduleSettings/);
    const scheduleMount = serverSrc.indexOf("createDoctorScheduleRouter()");
    const apiMount = serverSrc.indexOf("createApiRouter()");
    assert.ok(scheduleMount >= 0, "server.ts must mount createDoctorScheduleRouter()");
    assert.ok(scheduleMount < apiMount, "doctor schedule must mount before createApiRouter()");
  });
});

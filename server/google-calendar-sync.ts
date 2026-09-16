import { getDb, mapAppointment } from "./db.ts";
import { reportCaughtError } from "./error-tracker.ts";
import { appPublicUrl, isProduction, sandboxSimulatorsEnabled } from "./runtime.ts";
import { decryptSecret, encryptSecret } from "./token-crypto.ts";
import { ensureDoctorScheduleSchema } from "./doctor-schedule-schema.ts";
import { replaceGoogleBusyOverrides } from "./doctor-schedule.ts";
import {
  GoogleOAuthError,
  fetchGoogleCalendarUserEmail,
  googleCalendarRedirectUri,
  refreshGoogleCalendarAccessToken,
} from "./google-calendar-oauth.ts";

const CLINIC_TZ = "Asia/Kolkata";

export type GoogleCalendarIntegration = {
  id: string;
  doctorId: string;
  calendarId: string;
  syncEnabled: boolean;
  blockOpdSlots: boolean;
  pushAppointments: boolean;
  connectedEmail: string;
  channelId: string;
  resourceId: string;
  watchExpiration: string;
  tokenExpiry: string;
  connected: boolean;
};

let calendarFetchImpl: typeof fetch | null = null;

export function setGoogleCalendarFetchImpl(impl: typeof fetch | null) {
  calendarFetchImpl = impl;
}

function calendarFetch(): typeof fetch {
  return calendarFetchImpl || fetch;
}

function db() {
  const database = getDb();
  ensureDoctorScheduleSchema(database);
  return database;
}

function mapIntegration(row: Record<string, unknown> | undefined): GoogleCalendarIntegration | null {
  if (!row) return null;
  return {
    id: String(row.id),
    doctorId: String(row.doctor_id),
    calendarId: String(row.calendar_id || "primary"),
    syncEnabled: Number(row.sync_enabled) !== 0,
    blockOpdSlots: Number(row.block_opd_slots ?? 1) !== 0,
    pushAppointments: Number(row.push_appointments ?? 1) !== 0,
    connectedEmail: String(row.connected_email || ""),
    channelId: String(row.channel_id || ""),
    resourceId: String(row.resource_id || ""),
    watchExpiration: String(row.watch_expiration || ""),
    tokenExpiry: String(row.token_expiry || ""),
    connected: Boolean(String(row.access_token || "").trim()),
  };
}

export function getGoogleCalendarIntegration(doctorId: string): GoogleCalendarIntegration | null {
  const row = db()
    .prepare("SELECT * FROM google_calendar_integrations WHERE doctor_id = ?")
    .get(doctorId) as Record<string, unknown> | undefined;
  return mapIntegration(row);
}

export function publicCalendarStatus(doctorId: string) {
  const row = getGoogleCalendarIntegration(doctorId);
  if (!row) {
    return {
      connected: false,
      connectedEmail: null as string | null,
      calendarId: "primary",
      syncEnabled: false,
      blockOpdSlots: true,
      pushAppointments: true,
    };
  }
  return {
    connected: row.connected,
    connectedEmail: row.connectedEmail || null,
    calendarId: row.calendarId,
    syncEnabled: row.syncEnabled,
    blockOpdSlots: row.blockOpdSlots,
    pushAppointments: row.pushAppointments,
  };
}

export function updateCalendarToggles(
  doctorId: string,
  patch: { blockOpdSlots?: boolean; pushAppointments?: boolean; syncEnabled?: boolean }
): GoogleCalendarIntegration | null {
  const existing = db()
    .prepare("SELECT * FROM google_calendar_integrations WHERE doctor_id = ?")
    .get(doctorId) as Record<string, unknown> | undefined;
  if (!existing) return null;
  const blockOpd =
    patch.blockOpdSlots === undefined ? Number(existing.block_opd_slots ?? 1) : patch.blockOpdSlots ? 1 : 0;
  const push =
    patch.pushAppointments === undefined ? Number(existing.push_appointments ?? 1) : patch.pushAppointments ? 1 : 0;
  const sync =
    patch.syncEnabled === undefined ? Number(existing.sync_enabled ?? 1) : patch.syncEnabled ? 1 : 0;
  db()
    .prepare(
      `UPDATE google_calendar_integrations
       SET block_opd_slots = ?, push_appointments = ?, sync_enabled = ?, updated_at = ?
       WHERE doctor_id = ?`
    )
    .run(blockOpd, push, sync, new Date().toISOString(), doctorId);
  return getGoogleCalendarIntegration(doctorId);
}

export function disconnectGoogleCalendar(doctorId: string): void {
  db().prepare("DELETE FROM google_calendar_integrations WHERE doctor_id = ?").run(doctorId);
  db()
    .prepare("DELETE FROM doctor_overrides WHERE doctor_id = ? AND source = 'google_busy'")
    .run(doctorId);
}

async function googleJson(url: string, init: RequestInit): Promise<any> {
  const res = await calendarFetch()(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    const message =
      data?.error_description ||
      (typeof data?.error === "string" ? data.error : data?.error?.message) ||
      `Google Calendar API failed (HTTP ${res.status}).`;
    throw new GoogleOAuthError(message, res.status >= 400 && res.status < 600 ? res.status : 502);
  }
  return data;
}

function tokenExpiryIso(expiresIn: number): string {
  return new Date(Date.now() + Math.max(30, Number(expiresIn) || 3600) * 1000).toISOString();
}

export async function saveGoogleCalendarTokens(opts: {
  doctorId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  email?: string;
  calendarId?: string;
}): Promise<GoogleCalendarIntegration> {
  const now = new Date().toISOString();
  const existing = db()
    .prepare("SELECT * FROM google_calendar_integrations WHERE doctor_id = ?")
    .get(opts.doctorId) as Record<string, unknown> | undefined;
  const refreshToken = opts.refreshToken || (existing ? decryptSecret(String(existing.refresh_token || "")) : "");
  if (!refreshToken) {
    throw new GoogleOAuthError(
      "Google did not return a refresh token. Disconnect and reconnect Calendar, approving offline access.",
      400
    );
  }
  const accessEnc = encryptSecret(opts.accessToken);
  const refreshEnc = encryptSecret(refreshToken);
  const expiry = tokenExpiryIso(opts.expiresIn);
  const email = String(opts.email || existing?.connected_email || "");
  const calendarId = String(opts.calendarId || existing?.calendar_id || "primary");
  if (existing) {
    db()
      .prepare(
        `UPDATE google_calendar_integrations
         SET access_token = ?, refresh_token = ?, token_expiry = ?, calendar_id = ?,
             connected_email = COALESCE(NULLIF(?, ''), connected_email),
             sync_enabled = 1, updated_at = ?
         WHERE doctor_id = ?`
      )
      .run(accessEnc, refreshEnc, expiry, calendarId, email, now, opts.doctorId);
  } else {
    db()
      .prepare(
        `INSERT INTO google_calendar_integrations (
          id, doctor_id, access_token, refresh_token, token_expiry, calendar_id,
          sync_enabled, block_opd_slots, push_appointments, connected_email,
          channel_id, resource_id, watch_expiration, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 1, ?, '', '', '', ?, ?)`
      )
      .run(crypto.randomUUID(), opts.doctorId, accessEnc, refreshEnc, expiry, calendarId, email, now, now);
  }
  return getGoogleCalendarIntegration(opts.doctorId)!;
}

async function accessTokenForDoctor(doctorId: string): Promise<{
  accessToken: string;
  calendarId: string;
  integration: GoogleCalendarIntegration;
} | null> {
  const row = db()
    .prepare("SELECT * FROM google_calendar_integrations WHERE doctor_id = ?")
    .get(doctorId) as Record<string, unknown> | undefined;
  const integration = mapIntegration(row);
  if (!row || !integration?.connected || !integration.syncEnabled) return null;
  let access = decryptSecret(String(row.access_token || ""));
  const refresh = decryptSecret(String(row.refresh_token || ""));
  const expiryMs = Date.parse(String(row.token_expiry || "")) || 0;
  if (!access) return null;
  if (expiryMs && expiryMs < Date.now() + 60_000) {
    if (!refresh) return null;
    const refreshed = await refreshGoogleCalendarAccessToken({
      refreshToken: refresh,
      fetchImpl: calendarFetch(),
    });
    access = refreshed.accessToken;
    db()
      .prepare(
        `UPDATE google_calendar_integrations
         SET access_token = ?, token_expiry = ?, updated_at = ?
         WHERE doctor_id = ?`
      )
      .run(encryptSecret(access), tokenExpiryIso(refreshed.expiresIn), new Date().toISOString(), doctorId);
  }
  return { accessToken: access, calendarId: integration.calendarId, integration };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Interpret a clinic-local civil datetime as Asia/Kolkata ISO with offset +05:30. */
export function kolkataDateTime(date: string, hhmmOrClock: string): string {
  const minutesMod = (() => {
    const raw = String(hhmmOrClock || "").trim();
    const hhmm = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (hhmm) return Number(hhmm[1]) * 60 + Number(hhmm[2]);
    const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!ampm) return 9 * 60;
    let hours = Number(ampm[1]);
    const minutes = Number(ampm[2]);
    if (hours === 12) hours = 0;
    if (ampm[3].toUpperCase() === "PM") hours += 12;
    return hours * 60 + minutes;
  })();
  const hours = Math.floor(minutesMod / 60);
  const minutes = minutesMod % 60;
  return `${date}T${pad(hours)}:${pad(minutes)}:00+05:30`;
}

function busyToLocalBlocks(
  busy: Array<{ start?: string; end?: string }>
): Array<{ date: string; startTime: string; endTime: string }> {
  const blocks: Array<{ date: string; startTime: string; endTime: string }> = [];
  for (const item of busy) {
    const start = item.start ? new Date(item.start) : null;
    const end = item.end ? new Date(item.end) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    // Convert to IST by adding 5.5h offset from the UTC instant via locale-independent math.
    const startIst = new Date(start.getTime() + 5.5 * 60 * 60 * 1000);
    const endIst = new Date(end.getTime() + 5.5 * 60 * 60 * 1000);
    const date = startIst.toISOString().slice(0, 10);
    const endDate = endIst.toISOString().slice(0, 10);
    const startTime = `${pad(startIst.getUTCHours())}:${pad(startIst.getUTCMinutes())}`;
    const endTime = date === endDate ? `${pad(endIst.getUTCHours())}:${pad(endIst.getUTCMinutes())}` : "23:59";
    if (startTime === endTime) continue;
    blocks.push({ date, startTime, endTime });
    if (endDate > date) {
      blocks.push({
        date: endDate,
        startTime: "00:00",
        endTime: `${pad(endIst.getUTCHours())}:${pad(endIst.getUTCMinutes())}`,
      });
    }
  }
  return blocks;
}

export async function syncGoogleBusyBlocks(doctorId: string, horizonDays = 28): Promise<number> {
  const creds = await accessTokenForDoctor(doctorId);
  if (!creds) return 0;
  if (!creds.integration.blockOpdSlots) {
    replaceGoogleBusyOverrides(doctorId, []);
    return 0;
  }
  const timeMin = new Date();
  const timeMax = new Date(Date.now() + horizonDays * 24 * 60 * 60 * 1000);
  const data = await googleJson("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: CLINIC_TZ,
      items: [{ id: creds.calendarId }],
    }),
  });
  const busy = (data?.calendars?.[creds.calendarId]?.busy || data?.calendars?.primary?.busy || []) as Array<{
    start?: string;
    end?: string;
  }>;
  const blocks = busyToLocalBlocks(busy);
  replaceGoogleBusyOverrides(doctorId, blocks);
  return blocks.length;
}

export async function startGoogleCalendarWatch(doctorId: string, reqHost?: string, reqProto?: string): Promise<void> {
  if (sandboxSimulatorsEnabled() && !isProduction()) {
    return;
  }
  const creds = await accessTokenForDoctor(doctorId);
  if (!creds) return;
  const address = `${appPublicUrl(reqHost, reqProto)}/api/webhooks/google-calendar`;
  if (!address.startsWith("https://")) return;
  const channelId = crypto.randomUUID();
  const data = await googleJson(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(creds.calendarId)}/events/watch`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address,
        token: doctorId,
      }),
    }
  );
  db()
    .prepare(
      `UPDATE google_calendar_integrations
       SET channel_id = ?, resource_id = ?, watch_expiration = ?, updated_at = ?
       WHERE doctor_id = ?`
    )
    .run(
      String(data?.id || channelId),
      String(data?.resourceId || ""),
      data?.expiration ? new Date(Number(data.expiration)).toISOString() : "",
      new Date().toISOString(),
      doctorId
    );
}

export function findDoctorIdByChannel(channelId: string, resourceId?: string): string | null {
  if (!channelId) return null;
  const row = (
    resourceId
      ? db()
          .prepare(
            `SELECT doctor_id FROM google_calendar_integrations
             WHERE channel_id = ? AND (resource_id = ? OR resource_id = '')`
          )
          .get(channelId, resourceId)
      : db()
          .prepare("SELECT doctor_id FROM google_calendar_integrations WHERE channel_id = ?")
          .get(channelId)
  ) as { doctor_id?: string } | undefined;
  return row?.doctor_id ? String(row.doctor_id) : null;
}

function slotDurationForDoctor(doctorId: string): number {
  const row = db()
    .prepare(
      `SELECT slot_duration_minutes FROM doctor_schedules WHERE doctor_id = ? LIMIT 1`
    )
    .get(doctorId) as { slot_duration_minutes?: number } | undefined;
  if (row?.slot_duration_minutes) return Number(row.slot_duration_minutes);
  const doctor = db()
    .prepare("SELECT slot_duration_minutes FROM doctors WHERE id = ?")
    .get(doctorId) as { slot_duration_minutes?: number } | undefined;
  return Number(doctor?.slot_duration_minutes || 15);
}

export async function pushAppointmentToGoogle(appointment: Record<string, unknown>): Promise<void> {
  const mapped = mapAppointment(appointment);
  const doctorId = String(mapped.doctorId || "");
  if (!doctorId) return;
  const creds = await accessTokenForDoctor(doctorId);
  if (!creds?.integration.pushAppointments) return;
  const status = String(mapped.status || "");
  const existing = db()
    .prepare("SELECT google_event_id, calendar_id FROM google_calendar_event_map WHERE appointment_id = ?")
    .get(String(mapped.id)) as { google_event_id?: string; calendar_id?: string } | undefined;

  if (status === "Cancelled" || status === "No-Show") {
    if (existing?.google_event_id) {
      try {
        await calendarFetch()(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(existing.calendar_id || creds.calendarId)}/events/${encodeURIComponent(existing.google_event_id)}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${creds.accessToken}` } }
        );
      } catch (err) {
        reportCaughtError(err, "googleCalendar.deleteEvent");
      }
      db().prepare("DELETE FROM google_calendar_event_map WHERE appointment_id = ?").run(String(mapped.id));
    }
    return;
  }

  const duration = slotDurationForDoctor(doctorId);
  const start = kolkataDateTime(String(mapped.date), String(mapped.timeSlot || "09:00"));
  const startParts = start.match(/T(\d{2}):(\d{2})/);
  const startMin = startParts ? Number(startParts[1]) * 60 + Number(startParts[2]) : 9 * 60;
  const endMin = startMin + duration;
  const endHours = Math.floor(endMin / 60);
  const endMinutes = endMin % 60;
  const end = `${String(mapped.date)}T${pad(endHours)}:${pad(endMinutes)}:00+05:30`;

  const body = {
    summary: `OPD: ${mapped.patientName || "Patient"}`,
    description: `Lumera appointment ${mapped.id} · token ${mapped.tokenNumber ?? ""}`.trim(),
    start: { dateTime: start, timeZone: CLINIC_TZ },
    end: { dateTime: end, timeZone: CLINIC_TZ },
    extendedProperties: { private: { lumeraAppointmentId: String(mapped.id) } },
  };

  if (existing?.google_event_id) {
    await googleJson(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(existing.calendar_id || creds.calendarId)}/events/${encodeURIComponent(existing.google_event_id)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );
    return;
  }

  const created = await googleJson(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(creds.calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  const eventId = String(created?.id || "").trim();
  if (!eventId) return;
  db()
    .prepare(
      `INSERT INTO google_calendar_event_map (appointment_id, doctor_id, google_event_id, calendar_id, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(String(mapped.id), doctorId, eventId, creds.calendarId, new Date().toISOString());
}

export function scheduleOutboundAppointmentSync(appointment: Record<string, unknown>): void {
  void pushAppointmentToGoogle(appointment).catch((err) => reportCaughtError(err, "googleCalendar.outboundSync"));
}

export async function completeGoogleCalendarConnect(opts: {
  doctorId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  fetchImpl?: typeof fetch;
  reqHost?: string;
  reqProto?: string;
}): Promise<GoogleCalendarIntegration> {
  if (opts.fetchImpl) setGoogleCalendarFetchImpl(opts.fetchImpl);
  let email = "";
  try {
    email = await fetchGoogleCalendarUserEmail({
      accessToken: opts.accessToken,
      fetchImpl: calendarFetch(),
    });
  } catch {
    email = "";
  }
  const saved = await saveGoogleCalendarTokens({
    doctorId: opts.doctorId,
    accessToken: opts.accessToken,
    refreshToken: opts.refreshToken,
    expiresIn: opts.expiresIn,
    email,
  });
  try {
    await startGoogleCalendarWatch(opts.doctorId, opts.reqHost, opts.reqProto);
  } catch (err) {
    reportCaughtError(err, "googleCalendar.watch");
  }
  try {
    await syncGoogleBusyBlocks(opts.doctorId);
  } catch (err) {
    reportCaughtError(err, "googleCalendar.freeBusy");
  }
  return saved;
}

export { googleCalendarRedirectUri };

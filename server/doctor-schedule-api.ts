import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth.ts";
import { getDb } from "./db.ts";
import { reportCaughtError } from "./error-tracker.ts";
import { appPublicUrl, isProduction } from "./runtime.ts";
import { ensureDoctorScheduleSchema } from "./doctor-schedule-schema.ts";
import {
  addOverrides,
  groupWeeklySchedule,
  listOverrides,
  listSchedules,
  removeOverride,
  replaceWeeklySchedule,
  resolveDoctorId,
  seedScheduleFromDoctorProfile,
  slotsForDoctorDate,
  OVERRIDE_TYPES,
} from "./doctor-schedule.ts";
import {
  GoogleOAuthError,
  exchangeGoogleCalendarAuthorizationCode,
  googleCalendarDialogUrl,
  googleCalendarOAuthConfigured,
  googleCalendarRedirectUri,
  signGoogleCalendarOAuthState,
  verifyGoogleCalendarOAuthState,
} from "./google-calendar-oauth.ts";
import {
  completeGoogleCalendarConnect,
  disconnectGoogleCalendar,
  findDoctorIdByChannel,
  publicCalendarStatus,
  syncGoogleBusyBlocks,
  updateCalendarToggles,
} from "./google-calendar-sync.ts";

const WRITE_ROLES = new Set([
  "doctor",
  "CLINIC_ADMIN",
  "polyclinic_admin",
  "clinic_admin",
  "super_admin",
]);

function tenantIdOf(req: Request): string {
  return String(req.user?.tenantId || "").trim();
}

function requireTenant(req: Request, res: Response): string | null {
  const tenantId = tenantIdOf(req);
  if (!tenantId) {
    res.status(400).json({ error: "No tenant associated with this account." });
    return null;
  }
  return tenantId;
}

function canWriteSchedule(req: Request): boolean {
  return WRITE_ROLES.has(String(req.user?.role || ""));
}

function doctorIdFrom(req: Request, tenantId: string): string {
  const body = (req.body || {}) as Record<string, unknown>;
  const requested = String(req.query.doctorId || req.query.doctor_id || body.doctorId || body.doctor_id || "").trim();
  return resolveDoctorId({
    userId: String(req.user?.id || ""),
    tenantId,
    requestedDoctorId: requested,
  });
}

function settingsRedirect(req: Request, extra: Record<string, string>): string {
  const host = req.get("host") || undefined;
  const proto = req.get("x-forwarded-proto") || req.protocol;
  const params = new URLSearchParams(extra);
  const qs = params.toString();
  return `${appPublicUrl(host, proto)}/app/settings${qs ? `?${qs}` : ""}`;
}

export function createDoctorScheduleRouter(): Router {
  const api = Router();

  api.use((req, _res, next) => {
    try {
      ensureDoctorScheduleSchema(getDb());
    } catch {
      /* initDatabase may not have run yet in some tests */
    }
    next();
  });

  api.get("/tenant/doctor/schedule", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    try {
      const doctorId = doctorIdFrom(req, tenantId);
      const shifts = seedScheduleFromDoctorProfile(doctorId);
      const duration = shifts[0]?.slotDurationMinutes || 15;
      const days = groupWeeklySchedule(shifts, duration);
      const overrides = listOverrides(doctorId, { includeGoogleBusy: false });
      res.json({
        doctorId,
        slotDurationMinutes: duration,
        days,
        schedules: shifts,
        overrides,
        googleCalendar: publicCalendarStatus(doctorId),
      });
    } catch (err: unknown) {
      const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 500;
      const message = err instanceof Error ? err.message : "Failed to load schedule";
      if (status >= 500) reportCaughtError(err, "doctorSchedule.get");
      res.status(status || 500).json({ error: message });
    }
  });

  api.get("/tenant/doctor/schedule/slots", requireAuth, async (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    try {
      const doctorId = doctorIdFrom(req, tenantId);
      const date = String(req.query.date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "date is required (YYYY-MM-DD)." });
      }
      const status = publicCalendarStatus(doctorId);
      if (status.connected && status.blockOpdSlots) {
        try {
          await syncGoogleBusyBlocks(doctorId);
        } catch (err) {
          reportCaughtError(err, "doctorSchedule.slots.freeBusy");
        }
      }
      const slots = slotsForDoctorDate({
        tenantId,
        doctorId,
        date,
        includeGoogleBusy: status.blockOpdSlots !== false,
      });
      res.json({ doctorId, date, slots });
    } catch (err: unknown) {
      const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 500;
      const message = err instanceof Error ? err.message : "Failed to generate slots";
      if (status >= 500) reportCaughtError(err, "doctorSchedule.slots");
      res.status(status || 500).json({ error: message });
    }
  });

  api.put("/tenant/doctor/schedule", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    if (!canWriteSchedule(req)) return res.status(403).json({ error: "Insufficient permissions" });
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const doctorId = doctorIdFrom(req, tenantId);
      const days = Array.isArray(body.days) ? (body.days as Array<Record<string, unknown>>) : [];
      const grouped = replaceWeeklySchedule({
        doctorId,
        slotDurationMinutes: Number(body.slotDurationMinutes || body.slot_duration_minutes || 15),
        days: days.map((day) => ({
          dayOfWeek: Number(day.dayOfWeek ?? day.day_of_week),
          isActive: day.isActive !== false && day.is_active !== 0 && day.is_active !== false,
          shifts: Array.isArray(day.shifts)
            ? (day.shifts as Array<Record<string, unknown>>).map((shift) => ({
                startTime: String(shift.startTime || shift.start_time || ""),
                endTime: String(shift.endTime || shift.end_time || ""),
              }))
            : [],
        })),
      });
      const gcal = (body.googleCalendar || body.google_calendar) as Record<string, unknown> | undefined;
      if (gcal && typeof gcal === "object") {
        updateCalendarToggles(doctorId, {
          blockOpdSlots: gcal.blockOpdSlots ?? gcal.block_opd_slots,
          pushAppointments: gcal.pushAppointments ?? gcal.push_appointments,
          syncEnabled: gcal.syncEnabled ?? gcal.sync_enabled,
        } as { blockOpdSlots?: boolean; pushAppointments?: boolean; syncEnabled?: boolean });
      }
      const shifts = listSchedules(doctorId);
      res.json({
        doctorId,
        slotDurationMinutes: grouped[0]?.slotDurationMinutes || Number(body.slotDurationMinutes || 15),
        days: grouped,
        schedules: shifts,
        overrides: listOverrides(doctorId),
        googleCalendar: publicCalendarStatus(doctorId),
      });
    } catch (err: unknown) {
      const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 500;
      const message = err instanceof Error ? err.message : "Failed to save schedule";
      if (status >= 500) reportCaughtError(err, "doctorSchedule.put");
      res.status(status || 500).json({ error: message });
    }
  });

  api.post("/tenant/doctor/overrides", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    if (!canWriteSchedule(req)) return res.status(403).json({ error: "Insufficient permissions" });
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const doctorId = doctorIdFrom(req, tenantId);
      const action = String(body.action || "add").toLowerCase();
      if (action === "remove" || action === "delete") {
        const removed = removeOverride({
          doctorId,
          id: body.id ? String(body.id) : undefined,
          startDate: body.startDate || body.overrideDate || body.override_date ? String(body.startDate || body.overrideDate || body.override_date) : undefined,
          endDate: body.endDate ? String(body.endDate) : undefined,
        });
        return res.json({
          doctorId,
          removed,
          overrides: listOverrides(doctorId),
        });
      }
      const typeRaw = String(body.overrideType || body.override_type || "BLOCKED").toUpperCase();
      if (!OVERRIDE_TYPES.includes(typeRaw as (typeof OVERRIDE_TYPES)[number])) {
        return res.status(400).json({ error: "overrideType must be BLOCKED or CUSTOM_HOURS." });
      }
      const created = addOverrides({
        doctorId,
        startDate: String(body.startDate || body.overrideDate || body.override_date || ""),
        endDate: body.endDate ? String(body.endDate) : undefined,
        overrideType: typeRaw as "BLOCKED" | "CUSTOM_HOURS",
        customStartTime: body.customStartTime || body.custom_start_time ? String(body.customStartTime || body.custom_start_time) : null,
        customEndTime: body.customEndTime || body.custom_end_time ? String(body.customEndTime || body.custom_end_time) : null,
        reason: body.reason ? String(body.reason) : null,
      });
      res.status(201).json({
        doctorId,
        overrides: listOverrides(doctorId),
        created,
      });
    } catch (err: unknown) {
      const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 500;
      const message = err instanceof Error ? err.message : "Failed to save override";
      if (status >= 500) reportCaughtError(err, "doctorSchedule.overrides");
      res.status(status || 500).json({ error: message });
    }
  });

  const startCalendarOAuth = (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    if (!canWriteSchedule(req)) return res.status(403).json({ error: "Insufficient permissions" });
    if (!googleCalendarOAuthConfigured()) {
      if (isProduction()) {
        return res.status(503).json({
          error: "Google Calendar is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
        });
      }
      return res.redirect(settingsRedirect(req, { gcal: "not_configured" }));
    }
    try {
      const doctorId = doctorIdFrom(req, tenantId);
      const host = req.get("host") || undefined;
      const proto = req.get("x-forwarded-proto") || req.protocol;
      const redirectUri = googleCalendarRedirectUri(host, proto);
      const state = signGoogleCalendarOAuthState({
        doctorId,
        userId: String(req.user?.id || ""),
        tenantId,
      });
      return res.redirect(googleCalendarDialogUrl({ redirectUri, state }));
    } catch (err: unknown) {
      const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 500;
      const message = err instanceof Error ? err.message : "Failed to start Google Calendar OAuth";
      res.status(status || 500).json({ error: message });
    }
  };

  api.get("/tenant/doctor/google-calendar/auth", requireAuth, startCalendarOAuth);
  api.get("/tenant/doctor/google-calendar/connect", requireAuth, startCalendarOAuth);

  api.get("/tenant/doctor/google-calendar/callback", async (req, res) => {
    const fail = (reason: string) => res.redirect(settingsRedirect(req, { gcal: "error", reason }));
    const errorParam = String(req.query.error || "").trim();
    if (errorParam) return fail(errorParam);
    const code = String(req.query.code || "").trim();
    const state = String(req.query.state || "").trim();
    if (!code) return fail("missing_code");
    let claims: { doctorId: string; userId: string; tenantId: string };
    try {
      claims = verifyGoogleCalendarOAuthState(state);
    } catch {
      return fail("invalid_state");
    }
    try {
      const host = req.get("host") || undefined;
      const proto = req.get("x-forwarded-proto") || req.protocol;
      const tokens = await exchangeGoogleCalendarAuthorizationCode({
        code,
        redirectUri: googleCalendarRedirectUri(host, proto),
      });
      await completeGoogleCalendarConnect({
        doctorId: claims.doctorId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        reqHost: host,
        reqProto: proto,
      });
      return res.redirect(settingsRedirect(req, { gcal: "connected" }));
    } catch (err) {
      const message = err instanceof GoogleOAuthError ? err.message : "google_calendar_oauth_failed";
      return fail(message);
    }
  });

  api.post("/tenant/doctor/google-calendar/disconnect", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    if (!canWriteSchedule(req)) return res.status(403).json({ error: "Insufficient permissions" });
    try {
      const doctorId = doctorIdFrom(req, tenantId);
      disconnectGoogleCalendar(doctorId);
      res.json({ doctorId, googleCalendar: publicCalendarStatus(doctorId) });
    } catch (err: unknown) {
      const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 500;
      const message = err instanceof Error ? err.message : "Failed to disconnect Google Calendar";
      res.status(status || 500).json({ error: message });
    }
  });

  api.post("/webhooks/google-calendar", async (req, res) => {
    const channelId = String(req.get("x-goog-channel-id") || req.get("X-Goog-Channel-ID") || "").trim();
    const resourceId = String(req.get("x-goog-resource-id") || "").trim();
    const resourceState = String(req.get("x-goog-resource-state") || "").trim().toLowerCase();
    const tokenDoctor = String(req.get("x-goog-channel-token") || "").trim();
    if (resourceState === "sync") {
      return res.status(200).json({ ok: true });
    }
    const doctorId = findDoctorIdByChannel(channelId, resourceId) || tokenDoctor || "";
    if (!doctorId) {
      return res.status(404).json({ error: "Unknown Google Calendar channel." });
    }
    try {
      await syncGoogleBusyBlocks(doctorId);
      res.status(200).json({ ok: true, doctorId });
    } catch (err) {
      reportCaughtError(err, "googleCalendar.webhook");
      res.status(200).json({ ok: true, doctorId, warning: "resync deferred" });
    }
  });

  return api;
}

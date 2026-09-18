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

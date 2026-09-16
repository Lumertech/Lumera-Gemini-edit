import type { SqlDatabase } from "./sql-engine.ts";

/** Additive doctor weekly shifts, date overrides, and Google Calendar OAuth tokens. */
export function ensureDoctorScheduleSchema(database: SqlDatabase) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS doctor_schedules (
      id TEXT PRIMARY KEY,
      doctor_id TEXT NOT NULL,
      day_of_week INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      slot_duration_minutes INTEGER NOT NULL DEFAULT 15,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_doctor_schedules_doctor_day
      ON doctor_schedules (doctor_id, day_of_week);

    CREATE TABLE IF NOT EXISTS doctor_overrides (
      id TEXT PRIMARY KEY,
      doctor_id TEXT NOT NULL,
      override_date TEXT NOT NULL,
      override_type TEXT NOT NULL,
      custom_start_time TEXT,
      custom_end_time TEXT,
      reason TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      google_event_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_doctor_overrides_doctor_date
      ON doctor_overrides (doctor_id, override_date);
    CREATE INDEX IF NOT EXISTS idx_doctor_overrides_source
      ON doctor_overrides (doctor_id, source);

    CREATE TABLE IF NOT EXISTS google_calendar_integrations (
      id TEXT PRIMARY KEY,
      doctor_id TEXT NOT NULL UNIQUE,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expiry TEXT NOT NULL,
      calendar_id TEXT NOT NULL DEFAULT 'primary',
      sync_enabled INTEGER NOT NULL DEFAULT 1,
      block_opd_slots INTEGER NOT NULL DEFAULT 1,
      push_appointments INTEGER NOT NULL DEFAULT 1,
      connected_email TEXT NOT NULL DEFAULT '',
      channel_id TEXT NOT NULL DEFAULT '',
      resource_id TEXT NOT NULL DEFAULT '',
      watch_expiration TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS google_calendar_event_map (
      appointment_id TEXT PRIMARY KEY,
      doctor_id TEXT NOT NULL,
      google_event_id TEXT NOT NULL,
      calendar_id TEXT NOT NULL DEFAULT 'primary',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gcal_event_map_doctor
      ON google_calendar_event_map (doctor_id);
  `);

  const integrationCols: [string, string][] = [
    ["block_opd_slots", "INTEGER NOT NULL DEFAULT 1"],
    ["push_appointments", "INTEGER NOT NULL DEFAULT 1"],
    ["connected_email", "TEXT NOT NULL DEFAULT ''"],
    ["watch_expiration", "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [col, ddl] of integrationCols) {
    try {
      database.exec(`ALTER TABLE google_calendar_integrations ADD COLUMN ${col} ${ddl}`);
    } catch {
      /* already present */
    }
  }
  const overrideCols: [string, string][] = [
    ["source", "TEXT NOT NULL DEFAULT 'manual'"],
    ["google_event_id", "TEXT"],
  ];
  for (const [col, ddl] of overrideCols) {
    try {
      database.exec(`ALTER TABLE doctor_overrides ADD COLUMN ${col} ${ddl}`);
    } catch {
      /* already present */
    }
  }
}

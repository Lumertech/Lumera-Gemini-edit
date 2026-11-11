import { getDb } from "./db.ts";
import type { SqlDatabase } from "./sql-engine.ts";

export function ensureVoiceCallbackTasks(db: SqlDatabase = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_callback_tasks (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      patient_name TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    );
  `);
}

/** Staff follow-up when a voice escalation has no clinic number to offer. */
export function createVoiceCallbackTask(
  opts: { tenantId: string; patientPhone: string; patientName?: string; reason: string },
  db: SqlDatabase = getDb()
): string {
  ensureVoiceCallbackTasks(db);
  const id = `vcb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO voice_callback_tasks (id, tenant_id, patient_phone, patient_name, reason, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?)`
  ).run(
    id,
    String(opts.tenantId || "").trim(),
    String(opts.patientPhone || "").trim(),
    String(opts.patientName || "").trim(),
    String(opts.reason || "Voice caller needs a callback").trim(),
    now
  );
  return id;
}

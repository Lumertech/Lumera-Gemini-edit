/**
 * Stored safety-check payload for the WhatsApp send gate.
 * The decision function is safetyGateBlocksActions from #156 (src/lib/safetyCheckGate.ts).
 * This file does not reimplement that decision.
 */

import type { DatabaseSync } from "node:sqlite";
import {
  RULE_BASED_SAFETY_SOURCE,
  buildSafetyListSignature,
  interpretSafetyCheckResponse,
  safetyGateBlocksActions,
} from "../src/lib/safetyCheckGate.ts";

export const SAFETY_REVIEW_REQUIRED = "SAFETY_REVIEW_REQUIRED";
export const SAFETY_OVERRIDE_REASON_MIN = 20;

type StoredCheck = {
  signature: string;
  safety_status: string;
  has_high_risk: number;
  source: string;
  alert_count: number;
  acknowledged_signature: string | null;
};

function addColumn(db: DatabaseSync, table: string, definition: string) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  } catch {
    /* column already present */
  }
}

export function ensureRxSafetySchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rx_safety_checks (
      tenant_id TEXT NOT NULL,
      signature TEXT NOT NULL,
      safety_status TEXT NOT NULL,
      has_high_risk INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT '',
      alert_count INTEGER NOT NULL DEFAULT 0,
      acknowledged_signature TEXT,
      updated_at TEXT NOT NULL,
      patient_id TEXT NOT NULL DEFAULT '',
      patient_age TEXT NOT NULL DEFAULT '',
      patient_gender TEXT NOT NULL DEFAULT '',
      alerts_json TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (tenant_id, signature)
    )
  `);
  addColumn(db, "rx_safety_checks", "patient_id TEXT NOT NULL DEFAULT ''");
  addColumn(db, "rx_safety_checks", "patient_age TEXT NOT NULL DEFAULT ''");
  addColumn(db, "rx_safety_checks", "patient_gender TEXT NOT NULL DEFAULT ''");
  addColumn(db, "rx_safety_checks", "alerts_json TEXT NOT NULL DEFAULT '[]'");
}

export function rememberSafetyCheckResponse(
  db: DatabaseSync,
  opts: {
    tenantId: string;
    patientId?: string;
    age?: unknown;
    gender?: unknown;
    medicines: unknown;
    allergies?: unknown;
    chronicConditions?: unknown;
    status: number;
    body: unknown;
  }
): void {
  const decision = interpretSafetyCheckResponse(opts.status, opts.body);
  if (decision.accepted === false) return;
  const medicines = parseMedicines(opts.medicines);
  const identity = {
    patientId: String(opts.patientId || "").trim(),
    age: normalizeAge(opts.age),
    gender: normalizeGender(opts.gender),
  };
  const signature = safetySignature({
    medicines,
    allergies: Array.isArray(opts.allergies) ? (opts.allergies as string[]) : [],
    chronicConditions: Array.isArray(opts.chronicConditions) ? (opts.chronicConditions as string[]) : [],
    ...identity,
  });
  const alerts = Array.isArray(decision.result.alerts) ? decision.result.alerts : [];
  ensureRxSafetySchema(db);
  db.prepare(
    `INSERT INTO rx_safety_checks
      (tenant_id, signature, safety_status, has_high_risk, source, alert_count, acknowledged_signature, updated_at,
       patient_id, patient_age, patient_gender, alerts_json)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, signature) DO UPDATE SET
       safety_status = excluded.safety_status,
       has_high_risk = excluded.has_high_risk,
       source = excluded.source,
       alert_count = excluded.alert_count,
       acknowledged_signature = NULL,
       updated_at = excluded.updated_at,
       patient_id = excluded.patient_id,
       patient_age = excluded.patient_age,
       patient_gender = excluded.patient_gender,
       alerts_json = excluded.alerts_json`
  ).run(
    opts.tenantId,
    signature,
    String(decision.result.safetyStatus || ""),
    decision.result.hasHighRiskAlert ? 1 : 0,
    String(decision.result.source || ""),
    alerts.length,
    new Date().toISOString(),
    identity.patientId,
    identity.age,
    identity.gender,
    JSON.stringify(alerts)
  );
}

function parseMedicines(raw: unknown): Array<{ id: string; drugName: string; dosage: string; frequency: string; durationDays: number | string }> {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  return list.map((item, index) => {
    const med = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      id: String(med.id || `med-${index}`),
      drugName: String(med.drugName || med.drug_name || ""),
      dosage: String(med.dosage || ""),
      frequency: String(med.frequency || ""),
      durationDays: (med.durationDays ?? med.duration_days ?? "") as number | string,
    };
  });
}

function normalizeAge(value: unknown): string {
  if (value == null || value === "") return "";
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return String(numeric);
  return String(value).trim();
}

function normalizeGender(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

type PatientIdentity = { patientId: string; age: string; gender: string; updatedAt: string };

function patientIdentity(db: DatabaseSync, tenantId: string, patientId: string): PatientIdentity {
  const row = db
    .prepare(`SELECT id, age, gender FROM patients WHERE id = ? AND tenant_id = ?`)
    .get(patientId, tenantId) as { id?: string; age?: unknown; gender?: string } | undefined;
  return {
    patientId: String(row?.id || "").trim(),
    age: normalizeAge(row?.age),
    gender: normalizeGender(row?.gender),
    updatedAt: "",
  };
}

type RxVersion = PatientIdentity & { createdAt: string };

function rxIdentity(db: DatabaseSync, tenantId: string, rxNumber: string): RxVersion | null {
  const rx = db
    .prepare(`SELECT patient_id, created_at, updated_at FROM prescriptions WHERE tenant_id = ? AND rx_number = ?`)
    .get(tenantId, rxNumber) as { patient_id?: string; created_at?: string; updated_at?: string } | undefined;
  if (!rx) return null;
  const identity = patientIdentity(db, tenantId, String(rx.patient_id || ""));
  const createdAt = String(rx.created_at || "").trim();
  identity.updatedAt = String(rx.updated_at || "").trim() || createdAt;
  return { ...identity, createdAt };
}

function timestampMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The live row is newer than the audit snapshot or the signature time. Missing clocks fail closed. */
function rxChangedAfterAuditOrSignature(liveUpdatedAt: string, auditStamp: string, signedAt: string): boolean {
  const live = timestampMs(liveUpdatedAt);
  const audited = timestampMs(auditStamp);
  const signed = timestampMs(signedAt);
  if (live == null || audited == null || signed == null) return true;
  return live > audited || live > signed;
}

function safetySignature(input: {
  medicines: ReturnType<typeof parseMedicines>;
  allergies?: string[];
  chronicConditions?: string[];
  patientId: string;
  age: string;
  gender: string;
}): string {
  const list = buildSafetyListSignature({
    medicines: input.medicines,
    allergies: input.allergies || [],
    chronicConditions: input.chronicConditions || [],
  });
  return `${list}||patient:${input.patientId}||age:${input.age}||gender:${input.gender}`;
}

type SignedSafetyRow = StoredCheck & {
  rx_number?: string;
  patient_id?: string;
  patient_age?: string;
  patient_gender?: string;
  override_user_id?: string | null;
  override_user_name?: string | null;
  override_at?: string | null;
  override_reason?: string | null;
  override_alerts_json?: string | null;
  rx_updated_at?: string | null;
};

function parseStringList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((item) => String(item || "").trim()).filter(Boolean);
  const text = String(raw || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed.map((item) => String(item || "").trim()).filter(Boolean);
  } catch {
    return text.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export function patientSafetyLists(
  db: DatabaseSync,
  tenantId: string,
  patientId: string
): { allergies: string[]; chronicConditions: string[] } {
  try {
    const row = db
      .prepare(`SELECT allergies, chronic_conditions FROM patients WHERE id = ? AND tenant_id = ?`)
      .get(patientId, tenantId) as { allergies?: string; chronic_conditions?: string } | undefined;
    return {
      allergies: parseStringList(row?.allergies),
      chronicConditions: parseStringList(row?.chronic_conditions),
    };
  } catch {
    return { allergies: [], chronicConditions: [] };
  }
}

function ensureSignedSafetySchema(db: DatabaseSync) {
  ensureRxSafetySchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS rx_signed_safety (
      tenant_id TEXT NOT NULL,
      rx_number TEXT NOT NULL,
      signature TEXT NOT NULL,
      safety_status TEXT NOT NULL,
      has_high_risk INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT '',
      alert_count INTEGER NOT NULL DEFAULT 0,
      override_user_id TEXT,
      override_user_name TEXT,
      override_at TEXT,
      override_reason TEXT,
      override_alerts_json TEXT NOT NULL DEFAULT '[]',
      rx_updated_at TEXT NOT NULL DEFAULT '',
      patient_id TEXT NOT NULL DEFAULT '',
      patient_age TEXT NOT NULL DEFAULT '',
      patient_gender TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, rx_number)
    )
  `);
  addColumn(db, "rx_signed_safety", "override_alerts_json TEXT NOT NULL DEFAULT '[]'");
  addColumn(db, "rx_signed_safety", "rx_updated_at TEXT NOT NULL DEFAULT ''");
  addColumn(db, "rx_signed_safety", "patient_id TEXT NOT NULL DEFAULT ''");
  addColumn(db, "rx_signed_safety", "patient_age TEXT NOT NULL DEFAULT ''");
  addColumn(db, "rx_signed_safety", "patient_gender TEXT NOT NULL DEFAULT ''");
}

function upsertSignedSafety(
  db: DatabaseSync,
  row: {
    tenantId: string;
    rxNumber: string;
    signature: string;
    safetyStatus: string;
    hasHighRisk: boolean;
    source: string;
    alertCount: number;
    overrideUserId?: string | null;
    overrideUserName?: string | null;
    overrideAt?: string | null;
    overrideReason?: string | null;
    overrideAlertsJson?: string | null;
    rxUpdatedAt?: string | null;
    patientId?: string;
    patientAge?: string;
    patientGender?: string;
  }
) {
  ensureSignedSafetySchema(db);
  db.prepare(
    `INSERT INTO rx_signed_safety (
       tenant_id, rx_number, signature, safety_status, has_high_risk, source, alert_count,
       override_user_id, override_user_name, override_at, override_reason, override_alerts_json,
       rx_updated_at, patient_id, patient_age, patient_gender, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, rx_number) DO UPDATE SET
       signature = excluded.signature,
       safety_status = excluded.safety_status,
       has_high_risk = excluded.has_high_risk,
       source = excluded.source,
       alert_count = excluded.alert_count,
       override_user_id = excluded.override_user_id,
       override_user_name = excluded.override_user_name,
       override_at = excluded.override_at,
       override_reason = excluded.override_reason,
       override_alerts_json = excluded.override_alerts_json,
       rx_updated_at = excluded.rx_updated_at,
       patient_id = excluded.patient_id,
       patient_age = excluded.patient_age,
       patient_gender = excluded.patient_gender,
       updated_at = excluded.updated_at`
  ).run(
    row.tenantId,
    row.rxNumber,
    row.signature,
    row.safetyStatus,
    row.hasHighRisk ? 1 : 0,
    row.source,
    row.alertCount,
    row.overrideUserId || null,
    row.overrideUserName || null,
    row.overrideAt || null,
    row.overrideReason || null,
    row.overrideAlertsJson || "[]",
    row.rxUpdatedAt || "",
    row.patientId || "",
    row.patientAge || "",
    row.patientGender || "",
    new Date().toISOString()
  );
}

/** Copy a stored safety-check onto the signed prescription when the medicine list and the patient row still match. */
export function bindStoredSafetyCheckToRx(
  db: DatabaseSync,
  opts: {
    tenantId: string;
    rxNumber: string;
    patientId: string;
    medicines: unknown;
    allergies?: string[];
    chronicConditions?: string[];
  }
): boolean {
  const identity = patientIdentity(db, opts.tenantId, opts.patientId);
  if (!identity.patientId) return false;
  const medicines = parseMedicines(opts.medicines);
  const signature = safetySignature({
    medicines,
    allergies: opts.allergies || [],
    chronicConditions: opts.chronicConditions || [],
    patientId: identity.patientId,
    age: identity.age,
    gender: identity.gender,
  });
  ensureSignedSafetySchema(db);
  const check = db
    .prepare(`SELECT * FROM rx_safety_checks WHERE tenant_id = ? AND signature = ? AND patient_id = ?`)
    .get(opts.tenantId, signature, identity.patientId) as (StoredCheck & {
      patient_id?: string;
      patient_age?: string;
      patient_gender?: string;
    }) | undefined;
  if (!check) return false;
  if (normalizeAge(check.patient_age) !== identity.age || normalizeGender(check.patient_gender) !== identity.gender) {
    return false;
  }
  const rx = rxIdentity(db, opts.tenantId, opts.rxNumber);
  const existing = db
    .prepare(`SELECT * FROM rx_signed_safety WHERE tenant_id = ? AND rx_number = ?`)
    .get(opts.tenantId, opts.rxNumber) as SignedSafetyRow | undefined;
  upsertSignedSafety(db, {
    tenantId: opts.tenantId,
    rxNumber: opts.rxNumber,
    signature,
    safetyStatus: check.safety_status,
    hasHighRisk: Number(check.has_high_risk) === 1,
    source: check.source,
    alertCount: Number(check.alert_count) || 0,
    overrideUserId: existing?.override_user_id,
    overrideUserName: existing?.override_user_name,
    overrideAt: existing?.override_at,
    overrideReason: existing?.override_reason,
    overrideAlertsJson: existing?.override_alerts_json,
    rxUpdatedAt: rx?.updatedAt || existing?.rx_updated_at || "",
    patientId: identity.patientId,
    patientAge: identity.age,
    patientGender: identity.gender,
  });
  return true;
}

/** Audited doctor override stored with the signed Rx: who, when, and why. */
export function recordSignedRxSafetyOverride(
  db: DatabaseSync,
  opts: {
    tenantId: string;
    rxNumber: string;
    userId: string;
    userName: string;
    reason: string;
    medicines: unknown;
    allergies?: string[];
    chronicConditions?: string[];
  }
): boolean {
  const userId = String(opts.userId || "").trim();
  const reason = String(opts.reason || "").trim();
  const rxNumber = String(opts.rxNumber || "").trim();
  if (!opts.tenantId || !rxNumber || !userId || reason.length < SAFETY_OVERRIDE_REASON_MIN) return false;
  const identity = rxIdentity(db, opts.tenantId, rxNumber);
  if (!identity?.patientId) return false;
  const medicines = parseMedicines(opts.medicines);
  const signature = safetySignature({
    medicines,
    allergies: opts.allergies || [],
    chronicConditions: opts.chronicConditions || [],
    patientId: identity.patientId,
    age: identity.age,
    gender: identity.gender,
  });
  ensureSignedSafetySchema(db);
  const existing = db
    .prepare(`SELECT * FROM rx_signed_safety WHERE tenant_id = ? AND rx_number = ?`)
    .get(opts.tenantId, rxNumber) as SignedSafetyRow | undefined;
  if (!existing || existing.signature !== signature) return false;
  if (String(existing.patient_id || "") !== identity.patientId) return false;
  if (normalizeAge(existing.patient_age) !== identity.age || normalizeGender(existing.patient_gender) !== identity.gender) {
    return false;
  }
  const check = db
    .prepare(`SELECT alerts_json FROM rx_safety_checks WHERE tenant_id = ? AND signature = ? AND patient_id = ?`)
    .get(opts.tenantId, signature, identity.patientId) as { alerts_json?: string } | undefined;
  upsertSignedSafety(db, {
    tenantId: opts.tenantId,
    rxNumber,
    signature,
    safetyStatus: existing.safety_status,
    hasHighRisk: Number(existing.has_high_risk) === 1,
    source: existing.source || "",
    alertCount: Number(existing.alert_count) || 0,
    overrideUserId: userId,
    overrideUserName: String(opts.userName || "").trim(),
    overrideAt: new Date().toISOString(),
    overrideReason: reason,
    overrideAlertsJson: String(check?.alerts_json || existing.override_alerts_json || "[]"),
    rxUpdatedAt: identity.updatedAt,
    patientId: identity.patientId,
    patientAge: identity.age,
    patientGender: identity.gender,
  });
  return true;
}

/** Test and sign-time helper: a SAFE audit bound to the prescription's current medicine list. */
export function recordPassingSafetyAuditForStoredRx(db: DatabaseSync, tenantId: string, rxNumber: string): boolean {
  const rx = db
    .prepare(`SELECT patient_id, medicines FROM prescriptions WHERE tenant_id = ? AND rx_number = ?`)
    .get(tenantId, rxNumber) as { patient_id?: string; medicines?: string } | undefined;
  if (!rx) return false;
  const lists = patientSafetyLists(db, tenantId, String(rx.patient_id || ""));
  const identity = patientIdentity(db, tenantId, String(rx.patient_id || ""));
  if (!identity.patientId) return false;
  const medicines = parseMedicines(rx.medicines);
  const signature = safetySignature({ medicines, ...lists, patientId: identity.patientId, age: identity.age, gender: identity.gender });
  const version = rxIdentity(db, tenantId, rxNumber);
  upsertSignedSafety(db, {
    tenantId,
    rxNumber,
    signature,
    safetyStatus: "SAFE",
    hasHighRisk: false,
    source: "test-audit",
    alertCount: 0,
    rxUpdatedAt: version?.updatedAt || "",
    patientId: identity.patientId,
    patientAge: identity.age,
    patientGender: identity.gender,
  });
  return true;
}

/**
 * True unless the signed Rx has a passing audit or a complete doctor override
 * for the current medicine list. Uses #156's safetyGateBlocksActions for HIGH_RISK
 * and rule-based REVIEW. Also blocks REVIEW results that still have alerts.
 */
export function signedRxSafetyRefusal(
  db: DatabaseSync,
  tenantId: string,
  rxNumber: string,
  medicinesRaw: unknown,
  allergies: string[] = [],
  chronicConditions: string[] = []
): boolean {
  ensureSignedSafetySchema(db);
  const row = db
    .prepare(`SELECT * FROM rx_signed_safety WHERE tenant_id = ? AND rx_number = ?`)
    .get(tenantId, rxNumber) as SignedSafetyRow | undefined;
  if (!row) return true;
  const identity = rxIdentity(db, tenantId, rxNumber);
  if (!identity?.patientId) return true;
  if (rxChangedAfterAuditOrSignature(identity.updatedAt, String(row.rx_updated_at || ""), identity.createdAt)) {
    return true;
  }
  if (
    String(row.patient_id || "") !== identity.patientId ||
    normalizeAge(row.patient_age) !== identity.age ||
    normalizeGender(row.patient_gender) !== identity.gender
  ) {
    return true;
  }
  const medicines = parseMedicines(medicinesRaw);
  const signature = safetySignature({
    medicines,
    allergies,
    chronicConditions,
    patientId: identity.patientId,
    age: identity.age,
    gender: identity.gender,
  });
  const overrideComplete = Boolean(
    String(row.override_user_id || "").trim() &&
      String(row.override_at || "").trim() &&
      String(row.override_reason || "").trim() &&
      row.signature === signature
  );
  const blocked = safetyGateBlocksActions({
    medicineCount: medicines.length,
    checkedSignature: row.signature,
    medicinesSignature: signature,
    safetyStatus: row.safety_status,
    hasHighRiskAlert: Number(row.has_high_risk) === 1,
    source: row.source || null,
    overrideSignature: overrideComplete ? signature : null,
  });
  const reviewWithAlerts =
    row.safety_status === "REVIEW" &&
    Number(row.alert_count) > 0 &&
    !overrideComplete &&
    row.source !== RULE_BASED_SAFETY_SOURCE;
  if (blocked || reviewWithAlerts) return true;
  if (overrideComplete) return false;
  const passing =
    row.signature === signature &&
    (row.safety_status === "SAFE" || (row.safety_status === "REVIEW" && Number(row.alert_count) === 0));
  return !passing;
}

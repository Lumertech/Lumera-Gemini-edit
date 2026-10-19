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

type StoredCheck = {
  signature: string;
  safety_status: string;
  has_high_risk: number;
  source: string;
  alert_count: number;
  acknowledged_signature: string | null;
};

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
      PRIMARY KEY (tenant_id, signature)
    )
  `);
}

export function rememberSafetyCheckResponse(
  db: DatabaseSync,
  opts: {
    tenantId: string;
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
  const signature = buildSafetyListSignature({
    medicines,
    allergies: Array.isArray(opts.allergies) ? (opts.allergies as string[]) : [],
    chronicConditions: Array.isArray(opts.chronicConditions) ? (opts.chronicConditions as string[]) : [],
  });
  const alerts = Array.isArray(decision.result.alerts) ? decision.result.alerts.length : 0;
  ensureRxSafetySchema(db);
  db.prepare(
    `INSERT INTO rx_safety_checks
      (tenant_id, signature, safety_status, has_high_risk, source, alert_count, acknowledged_signature, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT(tenant_id, signature) DO UPDATE SET
       safety_status = excluded.safety_status,
       has_high_risk = excluded.has_high_risk,
       source = excluded.source,
       alert_count = excluded.alert_count,
       acknowledged_signature = NULL,
       updated_at = excluded.updated_at`
  ).run(
    opts.tenantId,
    signature,
    String(decision.result.safetyStatus || ""),
    decision.result.hasHighRiskAlert ? 1 : 0,
    String(decision.result.source || ""),
    alerts,
    new Date().toISOString()
  );
}

export function acknowledgeSafetyCheck(db: DatabaseSync, tenantId: string, signature: string): boolean {
  ensureRxSafetySchema(db);
  const sig = String(signature || "").trim();
  if (!tenantId || !sig) return false;
  const result = db
    .prepare(
      `UPDATE rx_safety_checks SET acknowledged_signature = ?, updated_at = ? WHERE tenant_id = ? AND signature = ?`
    )
    .run(sig, new Date().toISOString(), tenantId, sig);
  return Number(result.changes || 0) > 0;
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

type SignedSafetyRow = StoredCheck & {
  rx_number?: string;
  override_user_id?: string | null;
  override_user_name?: string | null;
  override_at?: string | null;
  override_reason?: string | null;
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
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, rx_number)
    )
  `);
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
  }
) {
  ensureSignedSafetySchema(db);
  db.prepare(
    `INSERT INTO rx_signed_safety (
       tenant_id, rx_number, signature, safety_status, has_high_risk, source, alert_count,
       override_user_id, override_user_name, override_at, override_reason, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    new Date().toISOString()
  );
}

/** Copy a stored safety-check onto the signed prescription when the medicine list still matches. */
export function bindStoredSafetyCheckToRx(
  db: DatabaseSync,
  opts: {
    tenantId: string;
    rxNumber: string;
    medicines: unknown;
    allergies?: string[];
    chronicConditions?: string[];
  }
): boolean {
  const medicines = parseMedicines(opts.medicines);
  const signature = buildSafetyListSignature({
    medicines,
    allergies: opts.allergies || [],
    chronicConditions: opts.chronicConditions || [],
  });
  ensureSignedSafetySchema(db);
  const check = db
    .prepare(`SELECT * FROM rx_safety_checks WHERE tenant_id = ? AND signature = ?`)
    .get(opts.tenantId, signature) as StoredCheck | undefined;
  if (!check) return false;
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
  if (!opts.tenantId || !rxNumber || !userId || !reason) return false;
  const medicines = parseMedicines(opts.medicines);
  const signature = buildSafetyListSignature({
    medicines,
    allergies: opts.allergies || [],
    chronicConditions: opts.chronicConditions || [],
  });
  ensureSignedSafetySchema(db);
  const existing = db
    .prepare(`SELECT * FROM rx_signed_safety WHERE tenant_id = ? AND rx_number = ?`)
    .get(opts.tenantId, rxNumber) as SignedSafetyRow | undefined;
  upsertSignedSafety(db, {
    tenantId: opts.tenantId,
    rxNumber,
    signature,
    safetyStatus: existing?.safety_status || "HIGH_RISK",
    hasHighRisk: existing ? Number(existing.has_high_risk) === 1 : true,
    source: existing?.source || "",
    alertCount: existing ? Number(existing.alert_count) || 0 : 1,
    overrideUserId: userId,
    overrideUserName: String(opts.userName || "").trim(),
    overrideAt: new Date().toISOString(),
    overrideReason: reason,
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
  const medicines = parseMedicines(rx.medicines);
  const signature = buildSafetyListSignature({ medicines, ...lists });
  upsertSignedSafety(db, {
    tenantId,
    rxNumber,
    signature,
    safetyStatus: "SAFE",
    hasHighRisk: false,
    source: "test-audit",
    alertCount: 0,
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
  const medicines = parseMedicines(medicinesRaw);
  const signature = buildSafetyListSignature({ medicines, allergies, chronicConditions });
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

/** True when #156's gate blocks, or a REVIEW result still has unacknowledged alerts. */
export function safetyReviewBlocksWhatsAppSend(
  db: DatabaseSync,
  tenantId: string,
  medicinesRaw: unknown,
  allergies: string[] = [],
  chronicConditions: string[] = []
): boolean {
  const medicines = parseMedicines(medicinesRaw);
  if (medicines.length === 0) return false;
  const signature = buildSafetyListSignature({ medicines, allergies, chronicConditions });
  ensureRxSafetySchema(db);
  const row = db
    .prepare(`SELECT * FROM rx_safety_checks WHERE tenant_id = ? AND signature = ?`)
    .get(tenantId, signature) as StoredCheck | undefined;
  const blocked = safetyGateBlocksActions({
    medicineCount: medicines.length,
    checkedSignature: row ? row.signature : null,
    medicinesSignature: signature,
    safetyStatus: row?.safety_status,
    hasHighRiskAlert: Number(row?.has_high_risk) === 1,
    source: row?.source || null,
    overrideSignature: row?.acknowledged_signature || null,
  });
  const reviewWithAlerts =
    row?.safety_status === "REVIEW" &&
    Number(row.alert_count) > 0 &&
    row.acknowledged_signature !== signature &&
    row.source !== RULE_BASED_SAFETY_SOURCE;
  return blocked || Boolean(reviewWithAlerts);
}

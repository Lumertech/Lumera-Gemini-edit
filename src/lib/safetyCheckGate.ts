import type { SafetyCheckResult } from "../types.ts";

export const SAFETY_CHECK_FAILED_COPY = "Safety check didn't run. Try again before printing or signing.";
export const SAFETY_CHECK_RATE_LIMIT_COPY = "Too many checks right now. Wait a minute and run the safety check again.";
export const RULE_BASED_SAFETY_SOURCE = "rule-based fallback";

export function safetyCheckFailureCopy(status: number): string {
  return status === 429 ? SAFETY_CHECK_RATE_LIMIT_COPY : SAFETY_CHECK_FAILED_COPY;
}

export function formatSafetyCheckTime(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function lastSuccessfulCheckCopy(time: string | null): string | null {
  if (!time) return null;
  return `Last successful check at ${time} IST`;
}

export function buildSafetyListSignature(input: {
  medicines: Array<{ id: string; drugName: string; dosage: string; frequency: string; durationDays: number | string }>;
  allergies?: string[] | null;
  chronicConditions?: string[] | null;
}): string {
  const meds = input.medicines
    .map((m) => `${m.id}:${m.drugName}:${m.dosage}:${m.frequency}:${m.durationDays}`)
    .join("|");
  const allergies = (input.allergies || []).join(",");
  const conditions = (input.chronicConditions || []).join(",");
  return `${meds}||allergies:${allergies}||conditions:${conditions}`;
}

export class SafetyCheckShapeError extends Error {
  constructor() {
    super("safety check reply was not usable");
    this.name = "SafetyCheckShapeError";
  }
}

function alertIsHighRisk(alerts: unknown[]): boolean {
  return alerts.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const severity = String((item as { severity?: unknown }).severity || "").trim().toLowerCase();
    return severity === "severe" || severity === "critical" || severity === "high" || severity === "high-risk" || severity === "high risk";
  });
}

/**
 * Status comes from the alerts, not from a model-supplied safetyStatus.
 * A missing alerts array or a non-boolean hasHighRiskAlert throws.
 */
export function pulseSafetyFromModel(raw: unknown): SafetyCheckResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SafetyCheckShapeError();
  const record = raw as { hasHighRiskAlert?: unknown; alerts?: unknown };
  if (!Array.isArray(record.alerts) || typeof record.hasHighRiskAlert !== "boolean") {
    throw new SafetyCheckShapeError();
  }
  const high = record.hasHighRiskAlert || alertIsHighRisk(record.alerts);
  const safetyStatus = high ? "HIGH_RISK" : record.alerts.length > 0 ? "REVIEW" : "SAFE";
  return {
    safetyStatus,
    source: "Pulse AI",
    hasHighRiskAlert: high,
    alerts: record.alerts as SafetyCheckResult["alerts"],
  };
}

/** True only for a derived HIGH_RISK or REVIEW status. SAFE is not a safety payload. */
export function hasSafetyPayload(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const status = (body as { safetyStatus?: unknown }).safetyStatus;
  return status === "HIGH_RISK" || status === "REVIEW";
}

/** A check is stored only when the HTTP call succeeded and the reply has a usable shape. */
export function interpretSafetyCheckResponse(
  status: number,
  body: unknown
): { accepted: true; result: SafetyCheckResult } | { accepted: false; message: string } {
  if (status < 200 || status >= 300) {
    return { accepted: false, message: safetyCheckFailureCopy(status) };
  }
  try {
    const result = pulseSafetyFromModel(body);
    if (result.safetyStatus !== "SAFE" && !hasSafetyPayload(result)) {
      return { accepted: false, message: safetyCheckFailureCopy(status) };
    }
    return { accepted: true, result };
  } catch {
    return { accepted: false, message: safetyCheckFailureCopy(status) };
  }
}

/** REVIEW with at least one alert stays blocked until the clinician acknowledges it. */
export function reviewNeedsAcknowledgement(opts: {
  safetyStatus?: string | null;
  alerts?: unknown;
}): boolean {
  return opts.safetyStatus === "REVIEW" && Array.isArray(opts.alerts) && opts.alerts.length > 0;
}

/** Print, Sign, and WhatsApp stay disabled until this is false. */
export function safetyGateBlocksActions(opts: {
  medicineCount: number;
  checkedSignature: string | null;
  medicinesSignature: string;
  safetyStatus?: string | null;
  hasHighRiskAlert?: boolean | null;
  alerts?: unknown;
  source?: string | null;
  overrideSignature: string | null;
}): boolean {
  if (opts.medicineCount <= 0) return false;
  if (opts.checkedSignature !== opts.medicinesSignature) return true;
  const highRisk = opts.safetyStatus === "HIGH_RISK" || opts.hasHighRiskAlert === true;
  if (highRisk && opts.overrideSignature !== opts.medicinesSignature) return true;
  if (reviewNeedsAcknowledgement(opts) && opts.overrideSignature !== opts.medicinesSignature) return true;
  return false;
}

export type SafetyGateState = {
  result: SafetyCheckResult | null;
  checkedSignature: string | null;
  overrideSignature: string | null;
  error: string | null;
  lastSuccessfulCheckAt: string | null;
};

export const EMPTY_SAFETY_GATE: SafetyGateState = {
  result: null,
  checkedSignature: null,
  overrideSignature: null,
  error: null,
  lastSuccessfulCheckAt: null,
};

/** Applies one safety-check response. A failure clears the previous pass and leaves the gate closed. */
export function reduceSafetyCheck(
  prev: SafetyGateState,
  status: number,
  body: unknown,
  medicinesSignature: string,
  checkedAt: string
): SafetyGateState {
  const decision = interpretSafetyCheckResponse(status, body);
  if (decision.accepted === false) {
    return {
      result: null,
      checkedSignature: null,
      overrideSignature: null,
      error: decision.message,
      lastSuccessfulCheckAt: prev.lastSuccessfulCheckAt,
    };
  }
  return {
    result: decision.result,
    checkedSignature: medicinesSignature,
    overrideSignature: null,
    error: null,
    lastSuccessfulCheckAt: checkedAt,
  };
}

export function safetyGateFromState(
  state: SafetyGateState,
  medicineCount: number,
  medicinesSignature: string
): boolean {
  return safetyGateBlocksActions({
    medicineCount,
    checkedSignature: state.checkedSignature,
    medicinesSignature,
    safetyStatus: state.result?.safetyStatus,
    hasHighRiskAlert: state.result?.hasHighRiskAlert,
    alerts: state.result?.alerts,
    source: state.result?.source,
    overrideSignature: state.overrideSignature,
  });
}

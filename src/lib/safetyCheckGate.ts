import type { SafetyCheckResult } from "../types.ts";

export const SAFETY_CHECK_FAILED_COPY = "Safety check didn't run. Try again before printing or signing.";
export const SAFETY_CHECK_RATE_LIMIT_COPY = "Too many checks right now. Wait a minute and run the safety check again.";
export const RULE_BASED_SAFETY_SOURCE = "rule-based fallback";

export function safetyCheckFailureCopy(status: number): string {
  return status === 429 ? SAFETY_CHECK_RATE_LIMIT_COPY : SAFETY_CHECK_FAILED_COPY;
}

export function formatSafetyCheckTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
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

function alertIsSevere(alerts: unknown): boolean {
  if (!Array.isArray(alerts)) return false;
  return alerts.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const severity = String((item as { severity?: unknown }).severity || "").trim().toLowerCase();
    return severity === "severe" || severity === "critical";
  });
}

function hasSafetyPayload(body: unknown): body is SafetyCheckResult {
  if (!body || typeof body !== "object") return false;
  const status = (body as { safetyStatus?: unknown }).safetyStatus;
  return typeof status === "string" && status.trim() !== "";
}

/** A check is stored only when the HTTP call succeeded and named a safety status. */
export function interpretSafetyCheckResponse(
  status: number,
  body: unknown
): { accepted: true; result: SafetyCheckResult } | { accepted: false; message: string } {
  if (status < 200 || status >= 300 || !body || typeof body !== "object" || Array.isArray(body)) {
    return { accepted: false, message: safetyCheckFailureCopy(status) };
  }
  const result: SafetyCheckResult = { ...(body as SafetyCheckResult) };
  if (result.hasHighRiskAlert === true || alertIsSevere(result.alerts)) {
    result.safetyStatus = "HIGH_RISK";
    result.hasHighRiskAlert = true;
  }
  if (!hasSafetyPayload(result)) {
    return { accepted: false, message: safetyCheckFailureCopy(status) };
  }
  return { accepted: true, result };
}

/** Print, Sign, and WhatsApp stay disabled until this is false. */
export function safetyGateBlocksActions(opts: {
  medicineCount: number;
  checkedSignature: string | null;
  medicinesSignature: string;
  safetyStatus?: string | null;
  hasHighRiskAlert?: boolean | null;
  source?: string | null;
  overrideSignature: string | null;
}): boolean {
  if (opts.medicineCount <= 0) return false;
  if (opts.checkedSignature !== opts.medicinesSignature) return true;
  const highRisk = opts.safetyStatus === "HIGH_RISK" || opts.hasHighRiskAlert === true;
  if (highRisk && opts.overrideSignature !== opts.medicinesSignature) return true;
  const manualReview =
    opts.source === RULE_BASED_SAFETY_SOURCE && opts.safetyStatus === "REVIEW" && !highRisk;
  if (manualReview && opts.overrideSignature !== opts.medicinesSignature) return true;
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
    source: state.result?.source,
    overrideSignature: state.overrideSignature,
  });
}

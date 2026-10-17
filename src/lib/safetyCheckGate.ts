import type { SafetyCheckResult } from "../types.ts";

export const SAFETY_CHECK_FAILED_COPY = "Safety check didn't run. Try again before printing or signing.";
export const SAFETY_CHECK_RATE_LIMIT_COPY = "Too many checks right now. Wait a minute and run the safety check again.";

export function safetyCheckFailureCopy(status: number): string {
  return status === 429 ? SAFETY_CHECK_RATE_LIMIT_COPY : SAFETY_CHECK_FAILED_COPY;
}

function hasSafetyPayload(body: unknown): body is SafetyCheckResult {
  if (!body || typeof body !== "object") return false;
  const record = body as { safetyStatus?: unknown; alerts?: unknown };
  const status = typeof record.safetyStatus === "string" && record.safetyStatus.trim() !== "";
  return status || Array.isArray(record.alerts);
}

/** A check opens the gate only when the HTTP call succeeded and returned a status or alerts. */
export function interpretSafetyCheckResponse(
  status: number,
  body: unknown
): { accepted: true; result: SafetyCheckResult } | { accepted: false; message: string } {
  if (status < 200 || status >= 300 || !hasSafetyPayload(body)) {
    return { accepted: false, message: safetyCheckFailureCopy(status) };
  }
  return { accepted: true, result: body };
}

/** Print, Sign, and WhatsApp stay disabled until this is false. */
export function safetyGateBlocksActions(opts: {
  medicineCount: number;
  checkedSignature: string | null;
  medicinesSignature: string;
  safetyStatus?: string | null;
  overrideSignature: string | null;
}): boolean {
  if (opts.medicineCount <= 0) return false;
  const stale = opts.checkedSignature !== opts.medicinesSignature;
  const highRisk = opts.safetyStatus === "HIGH_RISK" && opts.overrideSignature !== opts.medicinesSignature;
  return stale || highRisk;
}

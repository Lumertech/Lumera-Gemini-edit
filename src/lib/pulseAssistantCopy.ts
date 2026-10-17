export const PULSE_ASSISTANT_HEADER = "Clinical reference assistant";
export const PULSE_ASSISTANT_DISCLAIMER =
  "Pulse AI suggestions can be wrong. Verify against current guidelines before acting.";
export const PULSE_PRESCRIBER_ONLY_COPY = "Pulse AI is available to prescribing clinicians only.";
export const PULSE_RATE_LIMIT_COPY = "Too many requests. Try again in a few minutes.";
export const PULSE_GENERIC_ERROR_COPY = "Pulse AI couldn't answer. Try again.";

export function pulseAssistantErrorCopy(status: number): string {
  if (status === 403) return PULSE_PRESCRIBER_ONLY_COPY;
  if (status === 429) return PULSE_RATE_LIMIT_COPY;
  return PULSE_GENERIC_ERROR_COPY;
}

/** Reception and every other non-prescriber stay out. Admins may open it. */
export function canOpenClinicalAssistant(role: string | undefined | null): boolean {
  const value = String(role || "");
  return (
    value === "doctor" ||
    value === "polyclinic_admin" ||
    value === "CLINIC_ADMIN" ||
    value === "super_admin" ||
    value === "admin"
  );
}

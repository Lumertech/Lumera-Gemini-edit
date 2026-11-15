/**
 * Due-dose WhatsApp reminder hook.
 *
 * DISABLED. No approved Meta template in this product is a vaccination-due
 * reminder, so this hook does not send and does not submit a template.
 *
 * Reviewed approved (or seeded) templates that do not fit:
 * - appointment_reminder_v1 — visit confirmation, token, doctor, date, time
 * - appointment_confirmation_v1 — the same visit facts
 * - follow_up_consultation_reminder — a booked clinical follow-up, not a vaccine dose
 * - post_consultation_rx — prescription PDF
 * - opd_queue_token_alert — live queue
 * - lumera_appointment_reminder (META_REMINDER_TEMPLATE_NAME) — appointment reminder
 *
 * Reusing any of those would put vaccine copy into a visit template, which
 * Meta does not allow. Leave this hook disabled until a founder approves a
 * dedicated utility template. Do not call the Graph send path from here.
 */

export const VACCINE_DUE_REMINDER_HOOK = {
  enabled: false as const,
  sends: false as const,
  reason:
    "No approved WhatsApp template is a vaccination-due reminder. Appointment and follow-up templates are visit copy and must not be reused. No new Meta template is submitted and nothing is sent.",
  reviewedTemplates: [
    "appointment_reminder_v1",
    "appointment_confirmation_v1",
    "follow_up_consultation_reminder",
    "post_consultation_rx",
    "opd_queue_token_alert",
    "lumera_appointment_reminder",
  ],
};

export interface VaccineDueReminderResult {
  enabled: false;
  sent: false;
  reason: string;
  reviewedTemplates: readonly string[];
}

/** Pure status check. It has no send function and does not touch Meta. */
export function vaccineDueReminderHook(): VaccineDueReminderResult {
  return {
    enabled: false,
    sent: false,
    reason: VACCINE_DUE_REMINDER_HOOK.reason,
    reviewedTemplates: VACCINE_DUE_REMINDER_HOOK.reviewedTemplates,
  };
}

/**
 * Card-free clinic trial length. Signup day is day 1 in IST.
 * The day after TRIAL_DAYS is read-only.
 *
 * This file has no Node imports so the browser and the server share one number.
 * server/trial-lifecycle.ts re-exports these bindings; import them from there
 * in server code, and from here in client code.
 */

/** Founder decision 2026-11-14: the free trial is 30 days. */
export const TRIAL_DAYS = 30;

/** First calendar day the clinic is read-only. */
export const TRIAL_READ_ONLY_DAY = TRIAL_DAYS + 1;

/** Reminders fall on the last three days of the trial. */
export const TRIAL_REMINDER_DAYS = [TRIAL_DAYS - 2, TRIAL_DAYS - 1, TRIAL_DAYS] as const;

/** "days 28, 29 and 30" */
export function trialReminderPhrase(days: readonly number[] = TRIAL_REMINDER_DAYS): string {
  const prior = days.slice(0, -1).join(", ");
  const last = days[days.length - 1];
  return `days ${prior} and ${last}`;
}

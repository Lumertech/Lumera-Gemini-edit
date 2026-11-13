export type TrialCountdownStatus = "none" | "pending_whatsapp" | "active" | "read_only";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Header copy for an in-progress or lapsed 7-day trial. Null when the clinic is not on a trial. */
export function trialCountdownLabel(input: {
  status: TrialCountdownStatus;
  trialEndsAt: string | null;
  now?: number;
}): string | null {
  if (input.status === "none") return null;
  if (input.status === "pending_whatsapp") return "Verify WhatsApp to start the 7-day trial";
  if (input.status === "read_only") return "Trial ended";
  if (!input.trialEndsAt) return null;
  const ends = Date.parse(input.trialEndsAt);
  const now = input.now ?? Date.now();
  if (!Number.isFinite(ends) || ends <= now) return "Trial ended";
  const ms = ends - now;
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  return `${days}d ${hours}h left`;
}

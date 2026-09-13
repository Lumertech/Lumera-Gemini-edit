/**
 * Static Meta WhatsApp Cloud API rate catalog (same spirit as PLAN_CATALOG).
 *
 * Source: Meta WhatsApp Business Platform pricing (per-message model since
 * 1 July 2025; India billed in INR from 1 January 2026). Captured 13 Sep 2026
 * from Meta's published India rate card as relayed by Meta's pricing page and
 * contemporaneous BSP summaries. **Rates must be re-verified** against
 * https://developers.facebook.com/docs/whatsapp/pricing — they changed in
 * July 2025 and change again on **1 October 2026**.
 *
 * These figures are exclusive of 18% GST. Wallet raw_cost is stored in INR.
 *
 * PLACEHOLDER / FALLBACK: non-India destinations use a documented "OTHER"
 * INR estimate derived from published USD utility/marketing bands (~₹83/USD).
 * That OTHER row is not an official Meta INR card — re-verify before using
 * it for production invoicing.
 *
 * Lumera is not a certified Meta Tech Provider. This table is a cost estimate
 * for platform-to-tenant usage billing, not a Meta partnership claim.
 */

export const USAGE_RESOURCES = ["ai_scribe_minutes", "whatsapp_message"] as const;
export type UsageResource = (typeof USAGE_RESOURCES)[number];

export const WHATSAPP_CATEGORIES = ["marketing", "utility", "authentication", "service"] as const;
export type WhatsAppCategory = (typeof WHATSAPP_CATEGORIES)[number];

export const META_RATE_CAPTURED_ON = "2026-09-13";
export const META_RATE_SOURCE =
  "Meta WhatsApp Business Platform pricing (India INR rate card; per-message since 2025-07-01)";

/** Default cutover: service/utility replies inside the 24h window become billed. */
export const META_SERVICE_WINDOW_CUTOVER_ISO = "2026-10-01T00:00:00.000Z";

export interface MetaMessageRateRow {
  country: "IN" | "OTHER";
  countryLabel: string;
  category: WhatsAppCategory;
  /** INR per delivered message, exclusive of GST. */
  rateInr: number;
  notes: string;
}

export const META_MESSAGE_RATES: MetaMessageRateRow[] = [
  {
    country: "IN",
    countryLabel: "India (+91)",
    category: "marketing",
    rateInr: 0.8631,
    notes: "India marketing template, INR card as of 2026-07-01 band.",
  },
  {
    country: "IN",
    countryLabel: "India (+91)",
    category: "utility",
    rateInr: 0.115,
    notes: "India utility template. Free inside 24h customer-service window until 2026-10-01.",
  },
  {
    country: "IN",
    countryLabel: "India (+91)",
    category: "authentication",
    rateInr: 0.115,
    notes: "India authentication / OTP template. Billed outside the service window; not a free service reply.",
  },
  {
    country: "IN",
    countryLabel: "India (+91)",
    category: "service",
    rateInr: 0.115,
    notes: "Non-template service reply. raw_cost=0 before 2026-10-01 when inside the 24h window; then billed at utility rate (Meta also publishes 1,000 free service msgs/number/month — not modeled here).",
  },
  {
    country: "OTHER",
    countryLabel: "Other (fallback, not an official INR card)",
    category: "marketing",
    rateInr: 2.5,
    notes: "FALLBACK ≈ USD $0.03 marketing × ₹83. Re-verify Meta's destination-country card.",
  },
  {
    country: "OTHER",
    countryLabel: "Other (fallback, not an official INR card)",
    category: "utility",
    rateInr: 0.28,
    notes: "FALLBACK ≈ USD $0.0034 utility × ₹83. Re-verify Meta's destination-country card.",
  },
  {
    country: "OTHER",
    countryLabel: "Other (fallback, not an official INR card)",
    category: "authentication",
    rateInr: 0.28,
    notes: "FALLBACK ≈ USD $0.0034 authentication × ₹83.",
  },
  {
    country: "OTHER",
    countryLabel: "Other (fallback, not an official INR card)",
    category: "service",
    rateInr: 0.28,
    notes: "FALLBACK: same as OTHER utility after the Oct 2026 cutover.",
  },
];

const RATE_INDEX = new Map(
  META_MESSAGE_RATES.map((row) => [`${row.country}:${row.category}`, row])
);

export function lookupMetaRate(country: "IN" | "OTHER", category: WhatsAppCategory): MetaMessageRateRow {
  return RATE_INDEX.get(`${country}:${category}`) || META_MESSAGE_RATES.find((r) => r.country === "OTHER" && r.category === category)!;
}

export function recipientCountryFromPhone(phone: string): "IN" | "OTHER" {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length >= 12) return "IN";
  return "OTHER";
}

/**
 * Gemini / ambient-scribe raw_cost is intentionally null in code.
 * This repo has no reliable per-minute Gemini figure (billing is per-token, not
 * per consult-minute). Do not invent a rupee-per-minute number.
 *
 * Optional `GEMINI_SCRIBE_RAW_COST_INR` env (INR per successful scribe session,
 * not a token rate) lets operators/tests supply a real figure. When set,
 * `recordAiScribeUsage` stores it on `usage_events` and `usage_debit`s the
 * wallet after markup. Unset/invalid → null, event recorded, no debit.
 */
export const GEMINI_SCRIBE_RAW_COST_INR: number | null = null;
export const GEMINI_SCRIBE_RAW_COST_NOTE =
  "raw_cost left null unless GEMINI_SCRIBE_RAW_COST_INR is set — no per-minute Gemini figure in this repo (Gemini is token-priced). Wallet debit applies only when a numeric session raw_cost exists.";

/** Code default is null. Env override is an INR session cost, not an invented per-minute rate. */
export function resolveGeminiScribeRawCostInr(): number | null {
  const envVal = String(process.env.GEMINI_SCRIBE_RAW_COST_INR ?? "").trim();
  if (envVal !== "") {
    const n = Number(envVal);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return GEMINI_SCRIBE_RAW_COST_INR;
}

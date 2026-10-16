import { formatInr } from "./money.ts";
import {
  ANNUAL_REFUND,
  CONTACT_EMAIL,
  MONTHLY_BILLING_CONTACT,
  MONTHLY_REFUND,
  TRIAL_LEAD,
  TRIAL_REFUND,
  TRIAL_WHATSAPP_INR,
  TRIAL_WHATSAPP_SIGNUP,
  WHATSAPP_BILLED_BY_META,
  WHATSAPP_INR_PAYMENT,
  WHATSAPP_TRADEMARK,
} from "./pricingCopy.ts";

export type BillingCycle = "annual" | "monthly";
export type BillingPlanCode = "individual" | "polyclinic";
export type FeatureStatus = "live" | "sandbox" | "coming_soon";

export interface PublicPlan {
  code: BillingPlanCode;
  name: string;
  summary: string;
  annualPaise: number;
  monthlyPaise: number;
  includes: { label: string; status: FeatureStatus }[];
}

export interface PublicPlans {
  gstMode: "exclusive";
  gstRateBps: number;
  polyclinicMonthlyEnabled: boolean;
  contactEmail: string;
  whatsappCopy: string;
  whatsappInrCopy: string;
  trademarkCopy: string;
  extraDoctor: {
    fromNth: number;
    selfServeCap: number;
    annualPaise: number;
    monthlyPaise: number;
  };
  plans: PublicPlan[];
  trial: {
    days: number;
    reminderDays: number[];
    readOnlyDay: number;
    cardRequired: false;
  };
  refund: {
    annualWindowDays: number;
    businessDays: number;
  };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export function formatInrPaise(paise: number): string {
  return formatInr(paise / 100);
}

export function gstOnPaise(basePaise: number, gstRateBps: number): { gstPaise: number; totalPaise: number } {
  const gstPaise = Math.round((basePaise * gstRateBps) / 10000);
  return { gstPaise, totalPaise: basePaise + gstPaise };
}

export function exclusiveGstLine(basePaise: number, gstRateBps: number, period: "yr" | "mo"): string {
  const { totalPaise } = gstOnPaise(basePaise, gstRateBps);
  const percent = gstRateBps / 100;
  return `${formatInrPaise(basePaise)} + ${percent}% GST = ${formatInrPaise(totalPaise)}/${period}`;
}

export function annualSavingPaise(monthlyPaise: number, annualPaise: number): number {
  return monthlyPaise * 12 - annualPaise;
}

export interface BillingSelection {
  plan: BillingPlanCode;
  cycle: BillingCycle;
}

/** Reads `plan` and `cycle` only. Other query keys cannot change the practice type. */
export function billingSelectionFromSearch(search?: string | null): BillingSelection {
  const raw = String(search || "");
  const params = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  const plan = params.get("plan")?.trim().toLowerCase() === "polyclinic" ? "polyclinic" : "individual";
  const cycleRaw = params.get("cycle")?.trim().toLowerCase();
  const cycle: BillingCycle = cycleRaw === "monthly" || cycleRaw === "month" ? "monthly" : "annual";
  return { plan, cycle };
}

function istYmd(from: Date): { y: number; m: number; d: number } {
  const shifted = new Date(from.getTime() + IST_OFFSET_MS);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate() };
}

function addCalendarDays(y: number, m: number, d: number, days: number): { y: number; m: number; d: number } {
  const utc = new Date(Date.UTC(y, m, d + days));
  return { y: utc.getUTCFullYear(), m: utc.getUTCMonth(), d: utc.getUTCDate() };
}

function formatYmd(part: { y: number; m: number; d: number }): string {
  return `${part.d} ${MONTHS[part.m]} ${part.y}`;
}

/** Day 1 is the signup day in IST. The trial ends at 11:59 pm IST on day 30. */
export function trialSchedule(from = new Date()): { trialEndLabel: string; day31Label: string } {
  const start = istYmd(from);
  return {
    trialEndLabel: formatYmd(addCalendarDays(start.y, start.m, start.d, 29)),
    day31Label: formatYmd(addCalendarDays(start.y, start.m, start.d, 30)),
  };
}

export function planByCode(plans: PublicPlans, code: BillingPlanCode): PublicPlan {
  const found = plans.plans.find((plan) => plan.code === code);
  if (!found) throw new Error(`Unknown plan ${code}`);
  return found;
}

export function monthlyOffered(plans: PublicPlans, code: BillingPlanCode): boolean {
  if (code === "individual") return true;
  return plans.polyclinicMonthlyEnabled;
}

export function effectiveCycle(plans: PublicPlans, code: BillingPlanCode, cycle: BillingCycle): BillingCycle {
  if (cycle === "monthly" && !monthlyOffered(plans, code)) return "annual";
  return cycle;
}

export interface MoneyQuote {
  base: string;
  total: string;
  line: string;
  period: "month" | "year";
  cycle: BillingCycle;
}

export function quoteFor(plans: PublicPlans, code: BillingPlanCode, cycle: BillingCycle): MoneyQuote {
  const plan = planByCode(plans, code);
  const used = effectiveCycle(plans, code, cycle);
  const annual = used === "annual";
  const basePaise = annual ? plan.annualPaise : plan.monthlyPaise;
  const { totalPaise } = gstOnPaise(basePaise, plans.gstRateBps);
  return {
    base: formatInrPaise(basePaise),
    total: formatInrPaise(totalPaise),
    line: exclusiveGstLine(basePaise, plans.gstRateBps, annual ? "yr" : "mo"),
    period: annual ? "year" : "month",
    cycle: used,
  };
}

export function trialIntro(planName: string, cycle: BillingCycle, trialEndLabel: string): string {
  const cycleWord = cycle === "monthly" ? "monthly" : "annual";
  return `${TRIAL_LEAD} Your trial of the ${planName} ${cycleWord} plan ends at 11:59 pm IST on ${trialEndLabel}. We won't charge you anything unless you add a payment method. We'll remind you in the app, on WhatsApp and by email on days 20, 25, 28 and 30. If you don't add one, your account becomes read-only on day 31: your records stay safe and exportable, and nothing is charged. Read-only clinics can still reply to patients on WhatsApp manually within Meta's 24-hour window.`;
}

export function planAfterTrial(quote: MoneyQuote): string {
  return `Plan after trial: ${quote.base} + 18% GST = ${quote.total} per ${quote.period}.`;
}

export function monthlyAutopayCopy(planName: string, quote: MoneyQuote, day31Label: string): string {
  return `Set up AutoPay now (₹0 today) so there's no interruption. On ${day31Label} we'll charge ${quote.base} + 18% GST = ${quote.total} for the ${planName} monthly plan, then every month until you cancel. We'll remind you on WhatsApp and email 3 days and 1 day before the first charge, and your bank or UPI app will notify you at least 24 hours before every debit. Cancel any time on the Billing page before ${day31Label} and you won't be charged.`;
}

export function annualApprovalCopy(quote: MoneyQuote, day31Label: string): string {
  return `Add a payment method now (₹0 today). Your annual plan renews with your approval. On ${day31Label} we'll ask you to approve ${quote.base} + 18% GST = ${quote.total} with your UPI PIN or card OTP, and again at each yearly renewal. We'll remind you on WhatsApp and email 7, 3 and 1 day before. Cancel any time on the Billing page before ${day31Label} and you won't be charged. ${ANNUAL_REFUND}`;
}

export function featureLine(label: string, status: FeatureStatus): string {
  if (status === "coming_soon") return `${label} (coming soon)`;
  if (status === "sandbox" && !/sandbox/i.test(label)) return `${label} (sandbox)`;
  return label;
}

export interface PricingCardModel {
  code: BillingPlanCode;
  name: string;
  summary: string;
  annualPrice: string;
  annualDetail: string;
  saving: string;
  monthlyPrice: string | null;
  monthlyDetail: string | null;
  monthlyFallback: string | null;
  includes: string[];
  signupAnnual: string;
  signupMonthly: string;
}

export interface PricingPageModel {
  title: string;
  description: string;
  gstNote: string;
  cards: PricingCardModel[];
  extraDoctor: string;
  whatsapp: string;
  whatsappInr: string;
  trademark: string;
  trial: string;
  refund: string;
  faqs: { q: string; a: string }[];
  contactEmail: string;
}

export function buildPricingPageModel(plans: PublicPlans): PricingPageModel {
  const cards = plans.plans.map((plan): PricingCardModel => {
    const saving = annualSavingPaise(plan.monthlyPaise, plan.annualPaise);
    const monthlyOn = monthlyOffered(plans, plan.code);
    return {
      code: plan.code,
      name: plan.name,
      summary: plan.summary,
      annualPrice: `${formatInrPaise(plan.annualPaise)}/yr`,
      annualDetail: exclusiveGstLine(plan.annualPaise, plans.gstRateBps, "yr"),
      saving: `Save ${formatInrPaise(saving)}/yr`,
      monthlyPrice: monthlyOn ? `${formatInrPaise(plan.monthlyPaise)}/mo` : null,
      monthlyDetail: monthlyOn ? exclusiveGstLine(plan.monthlyPaise, plans.gstRateBps, "mo") : null,
      monthlyFallback: monthlyOn ? null : MONTHLY_BILLING_CONTACT,
      includes: plan.includes.map((row) => featureLine(row.label, row.status)),
      signupAnnual: `/signup?plan=${plan.code}&cycle=annual`,
      signupMonthly: `/signup?plan=${plan.code}&cycle=monthly`,
    };
  });

  const extra = plans.extraDoctor;
  const extraAnnual = exclusiveGstLine(extra.annualPaise, plans.gstRateBps, "yr");
  const extraMonthly = exclusiveGstLine(extra.monthlyPaise, plans.gstRateBps, "mo");
  const extraDoctor = `From the ${extra.fromNth}th doctor, each extra doctor is a separate add-on at ${formatInrPaise(extra.annualPaise)}/yr (${extraAnnual}) or ${formatInrPaise(extra.monthlyPaise)}/mo (${extraMonthly}), billed on the same cycle as the plan. Self-serve up to ${extra.selfServeCap} doctors per clinic. Adding a ${extra.selfServeCap + 1}th shows a Contact us path (${plans.contactEmail}).`;

  return {
    title: "Pricing",
    description:
      "Lumera clinic plans for an individual doctor or a polyclinic. Prices exclude GST. 30-day card-free trial. WhatsApp messages are billed by Meta to the clinic.",
    gstNote: "All prices are exclusive of GST.",
    cards,
    extraDoctor,
    whatsapp: plans.whatsappCopy,
    whatsappInr: plans.whatsappInrCopy,
    trademark: plans.trademarkCopy,
    trial: `${TRIAL_LEAD} Optional AutoPay. We'll remind you in the app, on WhatsApp and by email on days 20, 25, 28 and 30. If you don't add a payment method, your account becomes read-only on day 31: your records stay safe and exportable, and nothing is charged. Read-only clinics can still reply to patients on WhatsApp manually within Meta's 24-hour window.`,
    refund: `${ANNUAL_REFUND} ${MONTHLY_REFUND} ${TRIAL_REFUND}`,
    contactEmail: plans.contactEmail,
    faqs: [
      {
        q: "How does the free trial work?",
        a: `${TRIAL_LEAD} Optional AutoPay. We'll remind you in the app, on WhatsApp and by email on days 20, 25, 28 and 30. If you don't add a payment method, your account becomes read-only on day 31: your records stay safe and exportable, and nothing is charged. Read-only clinics can still reply to patients on WhatsApp manually within Meta's 24-hour window.`,
      },
      {
        q: "How do I cancel?",
        a: "Cancel any time on the Billing page, in one step. Cancelling is not harder than signing up.",
      },
      {
        q: "Who pays for WhatsApp messages?",
        a: `${plans.whatsappCopy} ${plans.whatsappInrCopy}`,
      },
      {
        q: "What if the Meta payment fails?",
        a: "Messages fail, and we alert the clinic immediately. Lumera does not pay Meta's charges on the clinic's behalf.",
      },
      {
        q: "Does Lumera collect patient payments?",
        a: "No. Patients pay your clinic directly. Lumera never collects or holds patient money.",
      },
      {
        q: "What is the refund window?",
        a: `${ANNUAL_REFUND} ${MONTHLY_REFUND} ${TRIAL_REFUND}`,
      },
      {
        q: "What happens to clinic records?",
        a: "Clinical records stay locked and exportable for 90 days after cancellation, then are deleted. Billing records are kept for 8 years as tax law requires. Contact ravee@lumer.me to transfer or delete records.",
      },
      {
        q: "Do prices include GST?",
        a: `All prices are exclusive of GST. Invoices show the base, 18% GST, and the total. Add your GSTIN for a B2B invoice. Contact ${plans.contactEmail}.`,
      },
    ],
  };
}

export function signupHref(code: BillingPlanCode, cycle: BillingCycle): string {
  return `/signup?plan=${code}&cycle=${cycle}`;
}

export { CONTACT_EMAIL, TRIAL_LEAD, TRIAL_WHATSAPP_INR, TRIAL_WHATSAPP_SIGNUP, WHATSAPP_BILLED_BY_META, WHATSAPP_INR_PAYMENT, WHATSAPP_TRADEMARK };

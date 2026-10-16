import {
  CONTACT_EMAIL,
  WHATSAPP_BILLED_BY_META,
  WHATSAPP_INR_PAYMENT,
  WHATSAPP_TRADEMARK,
} from "../src/lib/pricingCopy.ts";
import type { PublicPlans } from "../src/lib/pricingModel.ts";

/**
 * Locked list prices from issue #119 amendments 2–4 (paise, GST exclusive).
 * Public HTML and GET /api/public/plans both read this catalog.
 */
const INDIVIDUAL_ANNUAL_PAISE = 1_799_900;
const INDIVIDUAL_MONTHLY_PAISE = 199_900;
const POLYCLINIC_ANNUAL_PAISE = 5_999_900;
const POLYCLINIC_MONTHLY_PAISE = 669_900;
const EXTRA_DOCTOR_ANNUAL_PAISE = 999_900;
const EXTRA_DOCTOR_MONTHLY_PAISE = 109_900;

export function polyclinicMonthlyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = String(env.PRICING_POLYCLINIC_MONTHLY_ENABLED ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export function publicPlansResponse(env: NodeJS.ProcessEnv = process.env): PublicPlans {
  return {
    gstMode: "exclusive",
    gstRateBps: 1800,
    polyclinicMonthlyEnabled: polyclinicMonthlyEnabled(env),
    contactEmail: CONTACT_EMAIL,
    whatsappCopy: WHATSAPP_BILLED_BY_META,
    whatsappInrCopy: WHATSAPP_INR_PAYMENT,
    trademarkCopy: WHATSAPP_TRADEMARK,
    extraDoctor: {
      fromNth: 6,
      selfServeCap: 15,
      annualPaise: EXTRA_DOCTOR_ANNUAL_PAISE,
      monthlyPaise: EXTRA_DOCTOR_MONTHLY_PAISE,
    },
    plans: [
      {
        code: "individual",
        name: "Individual",
        summary: "Doctor and receptionist",
        annualPaise: INDIVIDUAL_ANNUAL_PAISE,
        monthlyPaise: INDIVIDUAL_MONTHLY_PAISE,
        includes: [
          { label: "OPD queue, tokens, reception, and patient registration", status: "live" },
          { label: "Appointments calendar", status: "live" },
          { label: "Prescription writer, specialty modules, and clinic letterhead", status: "live" },
          { label: "Doctor and receptionist", status: "live" },
          {
            label: "WhatsApp: connect your clinic's own number (opening after Meta approval)",
            status: "sandbox",
          },
          { label: "ABDM / ABHA sandbox integration", status: "sandbox" },
          { label: "AI Scribe", status: "coming_soon" },
        ],
      },
      {
        code: "polyclinic",
        name: "Polyclinic",
        summary: "Clinic admin, branches, and up to 5 doctors, plus staff",
        annualPaise: POLYCLINIC_ANNUAL_PAISE,
        monthlyPaise: POLYCLINIC_MONTHLY_PAISE,
        includes: [
          { label: "OPD queue, tokens, reception, and patient registration", status: "live" },
          { label: "Appointments calendar", status: "live" },
          { label: "Prescription writer, specialty modules, and clinic letterhead", status: "live" },
          { label: "Clinic admin, branches, and up to 5 doctors, plus staff", status: "live" },
          {
            label: "WhatsApp: connect your clinic's own number (opening after Meta approval)",
            status: "sandbox",
          },
          { label: "ABDM / ABHA sandbox integration", status: "sandbox" },
          { label: "AI Scribe", status: "coming_soon" },
        ],
      },
    ],
    trial: {
      days: 30,
      reminderDays: [20, 25, 28, 30],
      readOnlyDay: 31,
      cardRequired: false,
    },
    refund: {
      annualWindowDays: 7,
      businessDays: 15,
    },
  };
}

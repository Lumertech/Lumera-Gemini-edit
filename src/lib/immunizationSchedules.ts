/**
 * Versioned immunization schedules for Lumera clinics in India.
 *
 * These rows are reminders. A doctor confirms every dose. Nothing here
 * administers a vaccine, and a clinic edit does not change the cited source.
 *
 * Day model: 1 week = 7 days, 1 month = 30 days, 1 year = 365 days.
 * Due dates are anchors for the chart, not a substitute for the visit.
 *
 * Sources (see also docs/immunization-schedules.md):
 *
 * Pediatric default — IAP-ACVIP 2025 (updates the 2023 timetable)
 *   Indian Academy of Pediatrics, Advisory Committee on Vaccines and
 *   Immunization Practices. Recommended Immunization Schedule (2025) and
 *   Update on Immunization for Children Aged 0 Through 18 Years.
 *   Indian Pediatrics. 2026;63:311-324. DOI 10.1007/s13312-026-00311-w.
 *   Tables 1–3 and Figure 1. Finalized 23 November 2025.
 *   https://www.indianpediatrics.net/may2026/311.pdf
 *   The 2025 paper revises the 2023 timetable. Rows below follow 2025.
 *   Prior edition, kept so the 2023 table can be checked against this file:
 *   Indian Pediatrics. 2024;61:113-125. DOI 10.1007/s13312-024-3104-5.
 *   Table I, IAP-ACVIP Immunization Timetable 2023.
 *   https://www.indianpediatrics.net/feb2024/113.pdf
 *
 * Pediatric alternate — Government of India UIP / NIS
 *   Ministry of Health and Family Welfare. Routine Immunization Manual for
 *   Health Workers, 2024. National Immunization Schedule, Table 3.1 and the
 *   infant/child summary (BCG, hepatitis B birth dose, bOPV, pentavalent,
 *   rotavirus, fractional IPV, PCV 2+1, MR, JE in selected districts, DPT
 *   boosters, Td at 10 and 16 years).
 *   https://nccmis.mohfw.gov.in/document/RI_Manual_For_Health_Workers.pdf
 *
 * Dogs and cats — WSAVA 2024 as adapted for Indian practice
 *   WSAVA Vaccination Guidelines Group. 2024 guidelines for the vaccination
 *   of dogs and cats. Journal of Small Animal Practice.
 *   https://wsava.org/wp-content/uploads/2024/04/WSAVA-Vaccination-guidelines-2024.pdf
 *   Core DAP (CDV, CAV, CPV) and core FPV/FCV/FHV: doses every 2–4 weeks with
 *   the last juvenile dose at 16 weeks or older, another dose at or after
 *   26 weeks, then core revaccination no more often than every 3 years.
 *   Leptospirosis is core where it is endemic. Rabies is core in endemic
 *   regions; the interval follows local law and the product leaflet.
 *   This chart's rabies (and the India-practice FVRCP / leptospirosis
 *   boosters) default to annual boosters. The doctor in charge can lengthen
 *   an interval on the clinic template when the leaflet and local rules allow.
 */

export const IMMUNIZATION_CATALOG_VERSION = "2026.11.1";

export const IMMUNIZATION_SAFETY_NOTICE =
  "Schedules are reminders only. A doctor confirms each dose before it is given. Lumera does not administer a vaccine automatically.";

export type ScheduleId = "pediatric_iap" | "pediatric_uip" | "canine" | "feline";

export type DoseStatus =
  | "given"
  | "due"
  | "overdue"
  | "upcoming"
  | "skipped"
  | "contraindicated"
  | "not_indicated";

export type RecordedDoseStatus = "given" | "skipped" | "contraindicated";

export interface ScheduleDose {
  code: string;
  antigen: string;
  doseLabel: string;
  /** Age in days when the dose becomes due. */
  dueAgeDays: number;
  /** Age in days after which a missed dose is overdue. */
  overdueAfterDays: number;
  /** Age in days after which a missed dose is no longer indicated. */
  maxAgeDays?: number;
  recurringEveryDays?: number;
  /** Keep the latest missed interval instead of every historical miss. */
  collapseMissed?: boolean;
  optional?: boolean;
  endemicOnly?: boolean;
  /** If that dose was never given and is past its window, this dose is not indicated. */
  requiresPrior?: string;
  /** Hide this row unless the patient sex matches. A blank sex shows every row. */
  appliesToSex?: "female" | "male";
  /** This dose is timed from `afterCode`, not as its own missed date. */
  afterCode?: string;
  /** Recommended gap, in days, after `afterCode` is given. */
  afterDays?: number;
  /** Shown while the chart is waiting for `afterCode`. */
  afterNote?: string;
  /** A second floor, for example HPV dose 3 at least 3 months after dose 2. */
  alsoAfterCode?: string;
  alsoAfterDays?: number;
  /** Replaces doseLabel when the patient sex is known. The code stays stable for old records. */
  labelForSex?: Partial<Record<"female" | "male", string>>;
  /** After this age, use `catchUpAfterDays` once `afterCode` is given. */
  catchUpAfterAgeDays?: number;
  catchUpAfterDays?: number;
  catchUpAfterNote?: string;
  /** Omit the row until the child reaches this age (the older HPV series). */
  showFromAgeDays?: number;
  /** Omit the row when any of these doses was already given (series already started). */
  omitIfGiven?: string[];
  notes?: string;
}

export interface ScheduleDefinition {
  id: ScheduleId;
  version: string;
  family: "pediatric" | "veterinary";
  species?: "dog" | "cat";
  title: string;
  citation: string;
  doses: ScheduleDose[];
}

export interface DoseEdit {
  scheduleId: string;
  code: string;
  dueAgeDays?: number;
  overdueAfterDays?: number;
  doseLabel?: string;
  antigen?: string;
  recurringEveryDays?: number | null;
  disabled?: boolean;
  notes?: string;
}

export interface ChartRecord {
  id?: string;
  occurrenceKey: string;
  status: RecordedDoseStatus;
  givenOn?: string;
  brand?: string;
  batchNo?: string;
  givenByName?: string;
  reason?: string;
  stockAdministrationId?: string;
}

export interface ChartDose {
  occurrenceKey: string;
  code: string;
  antigen: string;
  doseLabel: string;
  dueOn: string;
  dueAgeDays: number;
  status: DoseStatus;
  catchUp: boolean;
  catchUpNote: string;
  notes: string;
  optional: boolean;
  endemicOnly: boolean;
  givenOn: string;
  brand: string;
  batchNo: string;
  givenByName: string;
  reason: string;
  recordId: string;
  stockAdministrationId: string;
}

const IAP_CITATION =
  "IAP-ACVIP Recommended Immunization Schedule (2025), Tables 1–3 and Figure 1. Indian Pediatrics. 2026;63:311-324. DOI 10.1007/s13312-026-00311-w. https://www.indianpediatrics.net/may2026/311.pdf. Updates IAP-ACVIP 2023, Table I. Indian Pediatrics. 2024;61:113-125. DOI 10.1007/s13312-024-3104-5. https://www.indianpediatrics.net/feb2024/113.pdf.";

const UIP_CITATION =
  "Ministry of Health and Family Welfare, Routine Immunization Manual for Health Workers, 2024. National Immunization Schedule (Table 3.1 and the infant/child summary). https://nccmis.mohfw.gov.in/document/RI_Manual_For_Health_Workers.pdf";

const DOG_CITATION =
  "WSAVA Vaccination Guidelines Group, 2024 guidelines for the vaccination of dogs and cats (https://wsava.org/wp-content/uploads/2024/04/WSAVA-Vaccination-guidelines-2024.pdf), adapted for Indian practice: DHPPiL/DAPP+Lepto puppy series ending at 16 weeks or older, a dose at or after 26 weeks, core DAP no more often than every 3 years, annual leptospirosis where endemic, and annual anti-rabies boosters. The doctor in charge can edit intervals.";

const CAT_CITATION =
  "WSAVA Vaccination Guidelines Group, 2024 guidelines for the vaccination of dogs and cats (https://wsava.org/wp-content/uploads/2024/04/WSAVA-Vaccination-guidelines-2024.pdf), adapted for Indian practice: FVRCP series ending at 16 weeks or older, a dose at or after 26 weeks, then recurring boosters (annual by default; WSAVA allows 3 years or longer for low-risk FPV), and annual anti-rabies boosters. The doctor in charge can edit intervals.";

function row(
  code: string,
  antigen: string,
  doseLabel: string,
  dueAgeDays: number,
  overdueAfterDays: number,
  extra: Partial<ScheduleDose> = {}
): ScheduleDose {
  return { code, antigen, doseLabel, dueAgeDays, overdueAfterDays, ...extra };
}

const W = (weeks: number) => weeks * 7;
const M = (months: number) => months * 30;
const Y = (years: number) => years * 365;

/**
 * IAP-ACVIP 2025 routine table (Table 2 and Figure 1), birth to 18 years.
 * JE is endemic-only (Figure 1, not in the routine table).
 * Meningococcal, nirsevimab, and rabies post-exposure are notes, not routine rows.
 */
const IAP_DOSES: ScheduleDose[] = [
  row("bcg", "BCG", "Birth dose", 0, 28, {
    maxAgeDays: Y(1),
    notes: "Give before discharge. UIP catch-up is up to the first birthday.",
  }),
  row("opv-0", "OPV", "Birth dose (OPV-0)", 0, 14, {
    maxAgeDays: 28,
    notes: "As soon as possible after birth. Later polio doses on this schedule are IPV.",
  }),
  row("hepb-1", "Hepatitis B", "Birth dose", 0, 1, {
    maxAgeDays: 7,
    notes: "Within 24 hours of birth. Later doses cover hepatitis B if the birth dose window has closed.",
  }),
  row("dtwp-1", "DTwP/DTaP", "Dose 1", W(6), W(10), {
    maxAgeDays: Y(7),
    notes: "DTwP or DTaP may be used. Record the brand when the dose is given.",
  }),
  row("ipv-1", "IPV", "Dose 1", W(6), W(10), {
    maxAgeDays: Y(7),
    notes: "IAP recommends full-dose IPV at 6, 10 and 14 weeks, plus boosters at 16–18 months and 4–6 years.",
  }),
  row("hib-1", "Hib", "Dose 1", W(6), W(10), { maxAgeDays: Y(5) }),
  row("hepb-2", "Hepatitis B", "Dose 2", W(6), W(10), { maxAgeDays: Y(18) }),
  row("rv-1", "Rotavirus", "Dose 1", W(6), W(10), {
    maxAgeDays: W(15),
    notes: "Start by 15 weeks. RV1 (for example Rotarix) is a 2-dose series; other brands use 3 doses.",
  }),
  row("pcv-1", "PCV", "Dose 1", W(6), W(10), {
    maxAgeDays: Y(5),
    notes: "IAP routine series is 3 infant doses plus a booster. This is not the UIP 2+1 series.",
  }),
  row("dtwp-2", "DTwP/DTaP", "Dose 2", W(10), W(14), { maxAgeDays: Y(7) }),
  row("ipv-2", "IPV", "Dose 2", W(10), W(14), { maxAgeDays: Y(7) }),
  row("hib-2", "Hib", "Dose 2", W(10), W(14), { maxAgeDays: Y(5) }),
  row("hepb-3", "Hepatitis B", "Dose 3", W(10), W(14), { maxAgeDays: Y(18) }),
  row("rv-2", "Rotavirus", "Dose 2", W(10), W(14), { maxAgeDays: W(32), requiresPrior: "rv-1" }),
  row("pcv-2", "PCV", "Dose 2", W(10), W(14), { maxAgeDays: Y(5) }),
  row("dtwp-3", "DTwP/DTaP", "Dose 3", W(14), W(18), { maxAgeDays: Y(7) }),
  row("ipv-3", "IPV", "Dose 3", W(14), W(18), { maxAgeDays: Y(7) }),
  row("hib-3", "Hib", "Dose 3", W(14), W(18), { maxAgeDays: Y(5) }),
  row("hepb-4", "Hepatitis B", "Dose 4", W(14), W(18), {
    maxAgeDays: Y(18),
    notes: "An additional hepatitis B dose is permitted when it is part of a combination vaccine.",
  }),
  row("rv-3", "Rotavirus", "Dose 3", W(14), W(18), {
    maxAgeDays: W(32),
    optional: true,
    requiresPrior: "rv-1",
    notes: "Omit for a 2-dose rotavirus product (RV1). Finish the series by 32 weeks.",
  }),
  row("pcv-3", "PCV", "Dose 3", W(14), W(18), { maxAgeDays: Y(5) }),
  row("iiv-1", "Influenza", "Dose 1", M(6), M(7), {
    maxAgeDays: Y(5),
    notes: "Inactivated influenza, trivalent (A/H1N1, A/H3N2, B/Victoria), 0.5 ml from 6 months. IAP-ACVIP 2025 replaced the quadrivalent vaccine. Routine doses stop at 5 years.",
  }),
  row("tcv", "Typhoid conjugate", "Single dose", M(6), M(9), {
    maxAgeDays: Y(18),
    notes: "One dose (0.5 ml intramuscular) from 6 months, scheduled at 6–9 months. IAP-ACVIP 2025 continues the single-dose strategy and does not recommend a typhoid booster.",
  }),
  row("iiv-2", "Influenza", "Dose 2", M(7), M(8), {
    maxAgeDays: Y(5),
    notes: "Second priming dose, 4 weeks after dose 1, then a yearly dose until 5 years of age.",
  }),
  row("iiv-annual", "Influenza", "Yearly dose", M(18), M(18) + 60, {
    maxAgeDays: Y(5),
    recurringEveryDays: Y(1),
    notes: "Yearly, usually in the pre-monsoon period, until 5 years of age (IAP-ACVIP 2025 Figure 1). High-risk children continue yearly to 18 years and beyond; that is a note, not an extra routine row.",
  }),
  row("mmr-1", "MMR", "Dose 1", M(9), Y(1), { maxAgeDays: Y(18) }),
  row("je-1", "Japanese Encephalitis", "Dose 1", M(9), M(11), {
    maxAgeDays: Y(2),
    endemicOnly: true,
    notes: "Not in the IAP-ACVIP 2025 routine table. Figure 1 limits JE to endemic areas. Shown only when the clinic marks an endemic district, using UIP ages (9–11 months and 16–24 months).",
  }),
  row("hepa-1", "Hepatitis A", "Dose 1", M(12), M(15), {
    maxAgeDays: Y(18),
    notes: "A live attenuated vaccine may be a single dose. Inactivated vaccine needs dose 2.",
  }),
  row("mmr-2", "MMR", "Dose 2", M(15), M(16), { maxAgeDays: Y(18) }),
  row("vari-1", "Varicella", "Dose 1", M(15), M(16), { maxAgeDays: Y(18) }),
  row("pcv-b", "PCV", "Booster", M(15), M(18), { maxAgeDays: Y(5) }),
  row("dtwp-b1", "DTwP/DTaP", "Booster 1", M(16), M(18), { maxAgeDays: Y(7) }),
  row("hib-b1", "Hib", "Booster", M(16), M(18), { maxAgeDays: Y(5) }),
  row("ipv-b1", "IPV", "Booster 1", M(16), M(18), { maxAgeDays: Y(7) }),
  row("je-2", "Japanese Encephalitis", "Dose 2", M(16), M(23), {
    maxAgeDays: Y(2),
    endemicOnly: true,
    notes: "Endemic districts only. Second dose at 16–23 months, matching UIP.",
  }),
  row("hepa-2", "Hepatitis A", "Dose 2", M(18), M(19), {
    optional: true,
    maxAgeDays: Y(18),
    notes: "Only when inactivated hepatitis A was used. Omit after a single-dose live vaccine.",
  }),
  row("vari-2", "Varicella", "Dose 2", M(18), M(19), {
    maxAgeDays: Y(18),
    afterCode: "vari-1",
    afterDays: M(3),
    afterNote: "Routine second dose is 3–6 months after dose 1 (IAP-ACVIP 2025 Table 2 places it at 18–19 months).",
    catchUpAfterAgeDays: Y(12),
    catchUpAfterDays: 28,
    catchUpAfterNote: "Catch-up after 12 years: the second dose is 4 weeks after dose 1 (IAP-ACVIP 2025 Figure 1).",
    notes: "Give 3–6 months after dose 1. After the 12th birthday the catch-up interval is 4 weeks.",
  }),
  row("dtwp-b2", "DTwP/DTaP", "Booster 2", Y(4), Y(6), { maxAgeDays: Y(7) }),
  row("ipv-b2", "IPV", "Booster 2", Y(4), Y(6), { maxAgeDays: Y(7) }),
  row("mmr-3", "MMR", "Dose 3", Y(4), Y(6), { maxAgeDays: Y(18) }),
  row("hpv-1", "HPV", "Dose 1 (girls: single dose; boys: first of two)", Y(9), Y(15) - 1, {
    maxAgeDays: Y(15) - 1,
    labelForSex: {
      female: "Single dose (immunocompetent girls)",
      male: "Dose 1 (boys, 9 up to 15 years)",
    },
    notes: "IAP-ACVIP 2025: immunocompetent girls get this one intramuscular dose from 9 years up to 15 years. Boys get a second dose 6 months later, not sooner than 5 months. The code stays hpv-1 so a dose recorded on the previous chart still matches. If nothing was given by the 15th birthday, use the 3-dose schedule.",
  }),
  row("hpv-2", "HPV", "Dose 2 (boys, 6 months after dose 1)", Y(9) + M(6), Y(15) - 1, {
    maxAgeDays: Y(19) - 1,
    appliesToSex: "male",
    requiresPrior: "hpv-1",
    afterCode: "hpv-1",
    afterDays: M(6),
    afterNote: "Six months after dose 1. Do not give it sooner than 5 months (IAP-ACVIP 2025).",
    notes: "Boys only, unless this dose was already recorded. Completes the 2-dose series when dose 1 was given before the 15th birthday. The code stays hpv-2 so an earlier record still matches.",
  }),
  row("hpv-15-1", "HPV", "Dose 1 (series started at 15 years or older)", Y(15), Y(15) + 60, {
    maxAgeDays: Y(19) - 1,
    showFromAgeDays: Y(15),
    omitIfGiven: ["hpv-1", "hpv-2"],
    notes: "IAP-ACVIP 2025 Table 2: from 15 years (the paper also cites 15–26 years) the schedule is 3 doses, 0.5 ml at 0, 2 and 6 months. Dose 2 is at least 1 month after dose 1. Dose 3 is 6 months after dose 1 and at least 3 months after dose 2. The same 3-dose schedule is for an immunocompromised child at any age; this chart does not start it early.",
  }),
  row("hpv-15-2", "HPV", "Dose 2 (2 months after dose 1)", Y(15) + M(2), Y(15) + M(2) + 60, {
    maxAgeDays: Y(19) - 1,
    showFromAgeDays: Y(15),
    omitIfGiven: ["hpv-1", "hpv-2"],
    afterCode: "hpv-15-1",
    afterDays: M(2),
    afterNote: "At least 1 month after dose 1. The 2025 table places this dose at 2 months.",
  }),
  row("hpv-15-3", "HPV", "Dose 3 (6 months after dose 1)", Y(15) + M(6), Y(15) + M(6) + 60, {
    maxAgeDays: Y(19) - 1,
    showFromAgeDays: Y(15),
    omitIfGiven: ["hpv-1", "hpv-2"],
    afterCode: "hpv-15-1",
    afterDays: M(6),
    alsoAfterCode: "hpv-15-2",
    alsoAfterDays: M(3),
    afterNote: "Six months after dose 1 (0, 2 and 6 months). Not sooner than 3 months after dose 2.",
  }),
  row("tdap", "Tdap", "10–12 year dose", Y(10), Y(13) - 1, {
    maxAgeDays: Y(19) - 1,
    notes: "IAP-ACVIP 2025 Figure 1: Tdap is necessary at 10–12 years, even if it was given earlier (including an inadvertent DTP booster). It is not the 4–6 year booster. If that booster was delayed, Tdap may be given after 7 years. If Tdap is unavailable or unaffordable, substitute Td. UIP gives Td at 10 years. Catch-up stays on the chart through the 18th year.",
  }),
  row("td", "Td", "16–18 year dose", Y(16), Y(19) - 1, {
    maxAgeDays: Y(19) - 1,
    notes: "IAP-ACVIP 2025 Table 2: Td or Tdap at 16–18 years, meaning through the year the child is 18. It leaves the chart on the 19th anniversary in this 365-day model. UIP gives Td at 16 years.",
  }),
];

/** Government of India national schedule. Vitamin A and antenatal Td are not vaccine rows. */
const UIP_DOSES: ScheduleDose[] = [
  row("bcg", "BCG", "Birth dose", 0, 28, { maxAgeDays: Y(1), notes: "Up to the first birthday if missed." }),
  row("hepb-birth", "Hepatitis B", "Birth dose", 0, 1, {
    maxAgeDays: 1,
    notes: "Within 24 hours of birth. Later hepatitis B is inside pentavalent.",
  }),
  row("bopv-0", "bOPV", "Birth dose", 0, 15, { maxAgeDays: 15, notes: "Within the first 15 days." }),
  row("bopv-1", "bOPV", "Dose 1", W(6), W(10), { maxAgeDays: Y(5) }),
  row("penta-1", "Pentavalent (DPT + Hep B + Hib)", "Dose 1", W(6), W(10), { maxAgeDays: Y(1) }),
  row("rv-1", "Rotavirus", "Dose 1", W(6), W(10), { maxAgeDays: Y(1) }),
  row("fipv-1", "fIPV", "Dose 1", W(6), W(14), { maxAgeDays: Y(1), notes: "Fractional IPV, intradermal, at 6 weeks, 14 weeks and 9–11 months." }),
  row("pcv-1", "PCV", "Dose 1", W(6), W(14), { maxAgeDays: Y(1), notes: "UIP is a 2+1 series: 6 weeks, 14 weeks, and a booster at 9–11 months." }),
  row("bopv-2", "bOPV", "Dose 2", W(10), W(14), { maxAgeDays: Y(5) }),
  row("penta-2", "Pentavalent (DPT + Hep B + Hib)", "Dose 2", W(10), W(14), { maxAgeDays: Y(1) }),
  row("rv-2", "Rotavirus", "Dose 2", W(10), W(14), { maxAgeDays: Y(1) }),
  row("bopv-3", "bOPV", "Dose 3", W(14), W(18), { maxAgeDays: Y(5) }),
  row("penta-3", "Pentavalent (DPT + Hep B + Hib)", "Dose 3", W(14), W(18), { maxAgeDays: Y(1) }),
  row("rv-3", "Rotavirus", "Dose 3", W(14), W(18), { maxAgeDays: Y(1) }),
  row("fipv-2", "fIPV", "Dose 2", W(14), M(9), { maxAgeDays: Y(1) }),
  row("pcv-2", "PCV", "Dose 2", W(14), M(9), { maxAgeDays: Y(1) }),
  row("mr-1", "MR", "Dose 1", M(9), M(11), { maxAgeDays: Y(5), notes: "Measles-rubella, not MMR." }),
  row("je-1", "Japanese Encephalitis", "Dose 1", M(9), M(11), {
    maxAgeDays: Y(2),
    endemicOnly: true,
    notes: "Selected endemic districts only.",
  }),
  row("pcv-b", "PCV", "Booster", M(9), M(11), { maxAgeDays: Y(1) }),
  row("fipv-3", "fIPV", "Dose 3", M(9), M(11), { maxAgeDays: Y(1) }),
  row("bopv-b", "bOPV", "Booster", M(16), M(23), { maxAgeDays: Y(5) }),
  row("mr-2", "MR", "Dose 2", M(16), M(23), { maxAgeDays: Y(5) }),
  row("dpt-b1", "DPT", "Booster 1", M(16), M(23), { maxAgeDays: Y(7) }),
  row("je-2", "Japanese Encephalitis", "Dose 2", M(16), M(23), {
    maxAgeDays: Y(2),
    endemicOnly: true,
    notes: "Selected endemic districts only.",
  }),
  row("dpt-b2", "DPT", "Booster 2", Y(5), Y(6), { maxAgeDays: Y(7), notes: "At 5–6 years." }),
  row("td-10", "Td", "10-year dose", Y(10), Y(11), {
    maxAgeDays: Y(16),
    notes: "Government UIP: Td at 10 years. IAP recommends Tdap across 10–12 years, and Td only if Tdap is unavailable.",
  }),
  row("td-16", "Td", "16-year dose", Y(16), Y(18), {
    maxAgeDays: Y(20),
    notes: "Government UIP: Td at 16 years. IAP recommends Td or Tdap across 16–18 years.",
  }),
];

const DEWORM_NOTE =
  "Optional. Not a vaccine. Common Indian small-animal practice is every 2 weeks until 12 weeks, then about every 3 months. The veterinarian confirms the product.";

function dewormRows(): ScheduleDose[] {
  return [
    row("deworm-puppy", "Deworming", "Juvenile dose", 14, 28, {
      optional: true,
      recurringEveryDays: 14,
      maxAgeDays: W(12),
      collapseMissed: true,
      notes: DEWORM_NOTE,
    }),
    row("deworm-maintain", "Deworming", "Maintenance dose", W(12) + 90, W(12) + 120, {
      optional: true,
      recurringEveryDays: 90,
      collapseMissed: true,
      notes: DEWORM_NOTE,
    }),
  ];
}

const DOG_DOSES: ScheduleDose[] = [
  row("dhppil-1", "DHPPiL (DAPP + Lepto)", "Dose 1", W(8), W(12), {
    notes: "Distemper, adenovirus/hepatitis, parvovirus, parainfluenza, plus leptospirosis. WSAVA core is CDV, CAV and CPV; parainfluenza rides along in Indian DHPPi products. Leptospirosis is treated as core here because it is endemic.",
  }),
  row("dhppil-2", "DHPPiL (DAPP + Lepto)", "Dose 2", W(12), W(16)),
  row("dhppil-3", "DHPPiL (DAPP + Lepto)", "Dose 3 (final puppy dose)", W(16), W(20), {
    notes: "WSAVA 2024: the last puppy dose should be at 16 weeks of age or older.",
  }),
  row("dhppil-26w", "DHPPiL (DAPP + Lepto)", "26-week dose", W(26), W(30), {
    notes: "WSAVA 2024: a further dose at or after 26 weeks, so a puppy that still had maternal antibody at 16 weeks is not left waiting until the first birthday.",
  }),
  row("lepto-annual", "Leptospirosis", "Annual booster", Y(1), Y(1) + 60, {
    recurringEveryDays: Y(1),
    notes: "Bacterin vaccines are boosted about yearly. Core DAP is on its own 3-year row.",
  }),
  row("dap-triennial", "DAP (distemper, adenovirus, parvovirus)", "Core booster", Y(3), Y(3) + 90, {
    recurringEveryDays: Y(3),
    notes: "WSAVA 2024: after a response to core MLV vaccines, revaccinate no more often than every 3 years. Shorten this on the clinic template if the product leaflet says so.",
  }),
  row("rabies-1", "Anti-rabies", "Dose 1", W(12), W(16), {
    notes: "From 12 weeks. Follow the leaflet of the vaccine used in this clinic.",
  }),
  row("rabies-2", "Anti-rabies", "Dose 2", W(16), W(20), {
    notes: "About 4 weeks after dose 1, which is common Indian primary-series practice.",
  }),
  row("rabies-annual", "Anti-rabies", "Annual booster", Y(1), Y(1) + 30, {
    recurringEveryDays: Y(1),
    notes: "India is rabies-endemic. This chart defaults to an annual booster. Many products are licensed for a longer duration of immunity; change the interval only when the leaflet and local rules allow it.",
  }),
  ...dewormRows(),
];

const CAT_DOSES: ScheduleDose[] = [
  row("fvrcp-1", "FVRCP", "Dose 1", W(8), W(12), {
    notes: "Feline viral rhinotracheitis (herpesvirus), calicivirus and panleukopenia.",
  }),
  row("fvrcp-2", "FVRCP", "Dose 2", W(12), W(16)),
  row("fvrcp-3", "FVRCP", "Dose 3 (final kitten dose)", W(16), W(20), {
    notes: "WSAVA 2024: the last kitten dose should be at 16 weeks of age or older.",
  }),
  row("fvrcp-26w", "FVRCP", "26-week dose", W(26), W(30), {
    notes: "WSAVA 2024: a further dose at or after 26 weeks.",
  }),
  row("fvrcp-booster", "FVRCP", "Booster", Y(1), Y(1) + 60, {
    recurringEveryDays: Y(1),
    notes: "Annual by default for Indian practice, especially where cats board or meet other cats. WSAVA allows core FPV revaccination every 3 years or longer in low-risk cats. Edit the interval on the clinic template.",
  }),
  row("rabies-1", "Anti-rabies", "Dose 1", W(12), W(16), {
    notes: "From 12 weeks. Rabies is core in endemic India for cats as well as dogs.",
  }),
  row("rabies-2", "Anti-rabies", "Dose 2", W(16), W(20), {
    notes: "About 4 weeks after dose 1.",
  }),
  row("rabies-annual", "Anti-rabies", "Annual booster", Y(1), Y(1) + 30, {
    recurringEveryDays: Y(1),
    notes: "Annual booster by default. Lengthen it on the clinic template only when the product leaflet and local rules allow.",
  }),
  ...dewormRows(),
];

export const IMMUNIZATION_SCHEDULES: Record<ScheduleId, ScheduleDefinition> = {
  pediatric_iap: {
    id: "pediatric_iap",
    version: "iap-acvip-2025",
    family: "pediatric",
    title: "IAP-ACVIP 2025 (recommended)",
    citation: IAP_CITATION,
    doses: IAP_DOSES,
  },
  pediatric_uip: {
    id: "pediatric_uip",
    version: "uip-nis-2024",
    family: "pediatric",
    title: "India UIP / National Immunization Schedule (2024 manual)",
    citation: UIP_CITATION,
    doses: UIP_DOSES,
  },
  canine: {
    id: "canine",
    version: "wsava-2024-india-dog",
    family: "veterinary",
    species: "dog",
    title: "Dog — WSAVA 2024 adapted for India",
    citation: DOG_CITATION,
    doses: DOG_DOSES,
  },
  feline: {
    id: "feline",
    version: "wsava-2024-india-cat",
    family: "veterinary",
    species: "cat",
    title: "Cat — WSAVA 2024 adapted for India",
    citation: CAT_CITATION,
    doses: CAT_DOSES,
  },
};

export function scheduleById(id: string): ScheduleDefinition | null {
  if (id === "pediatric_iap" || id === "pediatric_uip" || id === "canine" || id === "feline") {
    return IMMUNIZATION_SCHEDULES[id];
  }
  return null;
}

export interface PediatricScheduleContrast {
  topic: string;
  iap: string;
  uip: string;
}

/** Shown on every pediatric chart so a clinic sees both schedules where they differ. */
export const PEDIATRIC_SCHEDULE_CONTRASTS: PediatricScheduleContrast[] = [
  {
    topic: "Polio",
    iap: "OPV at birth, then full-dose IPV at 6, 10 and 14 weeks, with boosters at 16–18 months and 4–6 years.",
    uip: "bOPV at birth, 6, 10 and 14 weeks, plus a booster at 16–24 months. Fractional IPV at 6 weeks, 14 weeks and 9–11 months.",
  },
  {
    topic: "Diphtheria, tetanus, pertussis, hepatitis B, Hib",
    iap: "DTwP or DTaP, hepatitis B and Hib at 6, 10 and 14 weeks, with DTwP/DTaP and Hib boosters at 16–18 months and a DTwP/DTaP booster at 4–6 years.",
    uip: "Pentavalent (DPT + hepatitis B + Hib) at 6, 10 and 14 weeks. DPT boosters at 16–24 months and 5–6 years. No separate Hib booster.",
  },
  {
    topic: "Pneumococcal",
    iap: "PCV at 6, 10 and 14 weeks, plus a booster at 15 months (3+1).",
    uip: "PCV at 6 and 14 weeks, plus a booster at 9–11 months (2+1).",
  },
  {
    topic: "Measles",
    iap: "MMR at 9 months, 15 months and 4–6 years.",
    uip: "MR (measles-rubella, not MMR) at 9–12 months and 16–24 months.",
  },
  {
    topic: "10 years",
    iap: "Tdap at 10–12 years. Use Td only if Tdap is unavailable or unaffordable.",
    uip: "Td at 10 years.",
  },
  {
    topic: "16 years",
    iap: "Td or Tdap at 16–18 years.",
    uip: "Td at 16 years.",
  },
  {
    topic: "HPV, varicella, hepatitis A, influenza, typhoid",
    iap: "On the 2025 routine table. HPV is one dose for immunocompetent girls from 9 up to 15 years, two doses for boys in that age, and three doses when the series starts at 15 or older. Influenza is yearly until 5 years. Typhoid conjugate is a single dose, with no booster.",
    uip: "Not on the government schedule.",
  },
  {
    topic: "Japanese encephalitis",
    iap: "Not in the routine table. The chart uses the UIP ages only after the clinic marks an endemic district.",
    uip: "Selected endemic districts only, at 9–11 months and 16–24 months.",
  },
];

export interface ScheduleAdvisory {
  id: string;
  title: string;
  text: string;
}

/**
 * High-risk and special-situation notes from IAP-ACVIP 2025.
 * These are not routine due rows. Adding them as doses would put them on every child.
 */
export const IAP_HIGH_RISK_NOTES: ScheduleAdvisory[] = [
  {
    id: "influenza-high-risk",
    title: "Influenza — high risk",
    text: "Routine annual influenza stops at 5 years (IAP-ACVIP 2025 Figure 1). For a child at high risk of influenza complications, continue a yearly dose until 18 years and beyond. Use a trivalent vaccine (A/H1N1, A/H3N2, B/Victoria). The doctor adds those later doses on the clinic template; they are not routine rows.",
  },
  {
    id: "meningococcal",
    title: "Meningococcal — special situations only",
    text: "Not a routine dose. IAP-ACVIP 2025 Table 3 recommends meningococcal conjugate vaccine only in special situations, as published earlier. IAP-ACVIP 2023 Figure 1: Menactra is two doses at 9–23 months, at least 3 months apart. Menveo is one dose after 2 years. From 2 to 55 years, Menactra or Menveo may be a single dose. Ongoing exposure: a booster every 5 years. MenFive (serogroups A, C, W, Y and X) is a single dose from 18 to 85 years, not a routine childhood dose.",
  },
  {
    id: "nirsevimab",
    title: "Nirsevimab (RSV) — high risk only",
    text: "Not a routine vaccine row. IAP-ACVIP 2025 does not recommend nirsevimab for every infant. After talking with the parents, it may be considered for high-risk infants and children through 24 months (prematurity before 32 weeks, bronchopulmonary dysplasia, significant congenital heart disease, severe immunocompromise, or severe neuromuscular disease).",
  },
  {
    id: "rabies-pep",
    title: "Rabies — after a bite, not a routine childhood dose",
    text: "IAP-ACVIP 2025 recommends five intramuscular doses on days 0, 3, 7, 14 and 28 for post-exposure prophylaxis, plus rabies immunoglobulin or a monoclonal antibody by wound category. That course is not on this routine chart.",
  },
];

export function canonicalSpecies(value: unknown): "" | "human" | "dog" | "cat" | "other" {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "human" || raw === "child" || raw === "person") return "human";
  if (raw === "dog" || raw === "canine" || raw === "puppy" || raw === "pup") return "dog";
  if (raw === "cat" || raw === "feline" || raw === "kitten") return "cat";
  return "other";
}

/** Blank, other, and unknown stay blank so the chart can show both HPV rows. */
export function canonicalSex(value: unknown): "" | "female" | "male" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "female" || raw === "f" || raw === "girl") return "female";
  if (raw === "male" || raw === "m" || raw === "boy") return "male";
  return "";
}

export function addDaysIso(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map((part) => Number(part));
  if (!year || !month || !day) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetweenIso(fromIso: string, toIso: string): number | null {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86400000);
}

/**
 * A blank due-age field is not zero. Zero is a real birth dose, so the
 * template editor must send it only when the doctor typed 0.
 */
export function parseTemplateDueAge(raw: string): { ok: true; days: number } | { ok: false; error: string } {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, error: "Enter a due age in days before saving that dose." };
  if (!/^\d+$/.test(text)) return { ok: false, error: "Due age must be a whole number of days." };
  const days = Number(text);
  if (days > 8000) return { ok: false, error: "Due age must be 8000 days or fewer." };
  return { ok: true, days };
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return addDaysIso(value, 0) === value;
}

export function applyScheduleEdits(doses: ScheduleDose[], edits: DoseEdit[], scheduleId: string): ScheduleDose[] {
  const mine = edits.filter((edit) => edit.scheduleId === scheduleId);
  const byCode = new Map(mine.map((edit) => [edit.code, edit]));
  const next: ScheduleDose[] = [];
  for (const dose of doses) {
    const edit = byCode.get(dose.code);
    if (edit?.disabled) continue;
    const recurring =
      edit && Object.prototype.hasOwnProperty.call(edit, "recurringEveryDays")
        ? edit.recurringEveryDays || undefined
        : dose.recurringEveryDays;
    next.push({
      ...dose,
      dueAgeDays: edit?.dueAgeDays ?? dose.dueAgeDays,
      overdueAfterDays: edit?.overdueAfterDays ?? dose.overdueAfterDays,
      doseLabel: edit?.doseLabel?.trim() || dose.doseLabel,
      antigen: edit?.antigen?.trim() || dose.antigen,
      recurringEveryDays: recurring && recurring > 0 ? recurring : undefined,
      notes: edit?.notes?.trim() ? [dose.notes, edit.notes.trim()].filter(Boolean).join(" ") : dose.notes,
    });
  }
  for (const edit of mine) {
    if (!edit.code.startsWith("clinic-") || edit.disabled) continue;
    if (!edit.antigen?.trim() || edit.dueAgeDays == null) continue;
    next.push({
      code: edit.code,
      antigen: edit.antigen.trim(),
      doseLabel: edit.doseLabel?.trim() || "Clinic dose",
      dueAgeDays: edit.dueAgeDays,
      overdueAfterDays: edit.overdueAfterDays ?? edit.dueAgeDays + 28,
      recurringEveryDays: edit.recurringEveryDays || undefined,
      notes: edit.notes?.trim() || "Added by this clinic. Not part of the published schedule.",
    });
  }
  return next;
}

const CATCH_UP_NOTE = "Late dose. Catch-up is a reminder only — the doctor confirms whether to give it.";
const WINDOW_NOTE = "Outside the recommended age window.";

function occurrenceAges(dose: ScheduleDose, ageDays: number): number[] {
  if (!dose.recurringEveryDays || dose.recurringEveryDays < 1) return [dose.dueAgeDays];
  const ages: number[] = [];
  let cursor = dose.dueAgeDays;
  const cap = dose.maxAgeDays ?? dose.dueAgeDays + dose.recurringEveryDays * 30;
  const horizon = ageDays + dose.recurringEveryDays;
  while (cursor <= cap && cursor <= horizon && ages.length < 40) {
    ages.push(cursor);
    const duePassed = cursor <= ageDays;
    cursor += dose.recurringEveryDays;
    if (!duePassed) break;
  }
  if (!ages.length) ages.push(dose.dueAgeDays);
  return ages;
}

function seriesGap(dose: ScheduleDose, ageDays: number): { days: number; note: string } | null {
  if (!dose.afterCode || !dose.afterDays || dose.recurringEveryDays) return null;
  const catchUpGap =
    dose.catchUpAfterAgeDays != null && ageDays > dose.catchUpAfterAgeDays && dose.catchUpAfterDays != null;
  return {
    days: catchUpGap ? dose.catchUpAfterDays! : dose.afterDays,
    note:
      (catchUpGap ? dose.catchUpAfterNote : dose.afterNote) ||
      "Give this dose after the previous one in the series. It is not due on its own.",
  };
}

function recordedGiven(records: Map<string, ChartRecord>, code: string): boolean {
  for (const [key, record] of records) {
    if (record.status !== "given") continue;
    if (key === code || key.startsWith(`${code}@`)) return true;
  }
  return false;
}

function classify(ageDays: number, dose: ScheduleDose, dueAge: number): { status: DoseStatus; catchUp: boolean; catchUpNote: string } {
  const grace = Math.max(0, dose.overdueAfterDays - dose.dueAgeDays);
  const overdueAt = dueAge + grace;
  if (dose.maxAgeDays != null && ageDays > dose.maxAgeDays) {
    return { status: "not_indicated", catchUp: false, catchUpNote: WINDOW_NOTE };
  }
  if (ageDays < dueAge) return { status: "upcoming", catchUp: false, catchUpNote: "" };
  if (ageDays <= overdueAt) return { status: "due", catchUp: false, catchUpNote: "" };
  return { status: "overdue", catchUp: true, catchUpNote: CATCH_UP_NOTE };
}

export function computeImmunizationChart(input: {
  dateOfBirth: string;
  today: string;
  schedule: ScheduleDefinition;
  records?: ChartRecord[];
  endemicJe?: boolean;
  includeOptional?: boolean;
  edits?: DoseEdit[];
  /** Female or male selects the HPV series. Blank shows both, labelled on the dose. */
  sex?: "" | "female" | "male";
}): { ok: true; doses: ChartDose[] } | { ok: false; error: string } {
  if (!isIsoDate(input.dateOfBirth) || !isIsoDate(input.today)) {
    return { ok: false, error: "A date of birth is required to compute the chart." };
  }
  const ageDays = daysBetweenIso(input.dateOfBirth, input.today);
  if (ageDays == null || ageDays < 0) {
    return { ok: false, error: "Date of birth is after the chart date." };
  }
  const edited = applyScheduleEdits(input.schedule.doses, input.edits || [], input.schedule.id);
  const records = new Map((input.records || []).map((record) => [record.occurrenceKey, record]));
  const sex = input.sex || "";
  const built: ChartDose[] = [];
  for (const dose of edited) {
    if (dose.endemicOnly && !input.endemicJe) continue;
    if (dose.optional && input.includeOptional === false) continue;
    if (dose.showFromAgeDays != null && ageDays < dose.showFromAgeDays) continue;
    if (dose.omitIfGiven?.some((code) => recordedGiven(records, code))) continue;
    if (dose.appliesToSex && sex && dose.appliesToSex !== sex && !recordedGiven(records, dose.code)) continue;
    const ages = occurrenceAges(dose, ageDays);
    const missedKeys: string[] = [];
    const gap = seriesGap(dose, ageDays);
    for (const scheduledAge of ages) {
      let dueAge = scheduledAge;
      const occurrenceKey = dose.recurringEveryDays ? `${dose.code}@${dueAge}` : dose.code;
      const record = records.get(occurrenceKey);
      const prior = dose.afterCode ? records.get(dose.afterCode) : undefined;
      if (gap && prior?.status === "given" && prior.givenOn) {
        const shifted = daysBetweenIso(input.dateOfBirth, addDaysIso(prior.givenOn, gap.days));
        if (shifted != null && shifted > dueAge) dueAge = shifted;
      } else if (gap && prior?.status !== "given" && dueAge <= ageDays) {
        const projected = ageDays + gap.days;
        if (projected > dueAge) dueAge = projected;
      }
      const alsoPrior = dose.alsoAfterCode ? records.get(dose.alsoAfterCode) : undefined;
      if (dose.alsoAfterCode && dose.alsoAfterDays && alsoPrior?.status === "given" && alsoPrior.givenOn) {
        const shifted = daysBetweenIso(input.dateOfBirth, addDaysIso(alsoPrior.givenOn, dose.alsoAfterDays));
        if (shifted != null && shifted > dueAge) dueAge = shifted;
      } else if (dose.alsoAfterCode && dose.alsoAfterDays && alsoPrior?.status !== "given" && dueAge <= ageDays) {
        const projected = ageDays + dose.alsoAfterDays;
        if (projected > dueAge) dueAge = projected;
      }
      const base = classify(ageDays, dose, dueAge);
      let status: DoseStatus = base.status;
      let catchUp = base.catchUp;
      let catchUpNote = base.catchUpNote;
      if (record?.status === "given" || record?.status === "skipped" || record?.status === "contraindicated") {
        status = record.status;
        catchUp = false;
        catchUpNote = "";
      } else if (gap && prior?.status !== "given") {
        const priorDose = edited.find((item) => item.code === dose.afterCode);
        const priorWindowOpen = priorDose?.maxAgeDays == null || ageDays <= priorDose.maxAgeDays;
        if (priorWindowOpen && (status === "due" || status === "overdue" || status === "upcoming")) {
          status = "upcoming";
          catchUp = false;
          catchUpNote = gap.note;
        }
      } else if (dose.alsoAfterCode && alsoPrior?.status !== "given") {
        const otherDose = edited.find((item) => item.code === dose.alsoAfterCode);
        const otherWindowOpen = otherDose?.maxAgeDays == null || ageDays <= otherDose.maxAgeDays;
        if (otherWindowOpen && (status === "due" || status === "overdue" || status === "upcoming")) {
          status = "upcoming";
          catchUp = false;
          catchUpNote = gap?.note || "Give this dose after the previous one in the series.";
        }
      } else if (status === "overdue" && dose.collapseMissed) {
        missedKeys.push(occurrenceKey);
      }
      built.push({
        occurrenceKey,
        code: dose.code,
        antigen: dose.antigen,
        doseLabel: (sex && dose.labelForSex?.[sex]) || dose.doseLabel,
        dueOn: addDaysIso(input.dateOfBirth, dueAge),
        dueAgeDays: dueAge,
        status,
        catchUp,
        catchUpNote,
        notes: dose.notes || "",
        optional: Boolean(dose.optional),
        endemicOnly: Boolean(dose.endemicOnly),
        givenOn: record?.status === "given" ? record.givenOn || "" : "",
        brand: record?.brand || "",
        batchNo: record?.batchNo || "",
        givenByName: record?.givenByName || "",
        reason: record?.status === "given" ? "" : record?.reason || "",
        recordId: record?.id || "",
        stockAdministrationId: record?.stockAdministrationId || "",
      });
    }
    if (dose.collapseMissed && missedKeys.length > 1) {
      const drop = new Set(missedKeys.slice(0, -1));
      for (let i = built.length - 1; i >= 0; i -= 1) {
        if (drop.has(built[i].occurrenceKey)) built.splice(i, 1);
      }
      const kept = built.find((item) => item.occurrenceKey === missedKeys[missedKeys.length - 1]);
      if (kept) {
        kept.catchUpNote = `${CATCH_UP_NOTE} Earlier intervals were also missed.`;
      }
    }
  }
  const byCode = new Map(built.map((dose) => [dose.code, dose]));
  for (const dose of edited) {
    if (!dose.requiresPrior) continue;
    const prior = byCode.get(dose.requiresPrior);
    if (!prior || prior.status !== "not_indicated") continue;
    for (const item of built) {
      if (item.code !== dose.code || item.status === "given") continue;
      item.status = "not_indicated";
      item.catchUp = false;
      item.catchUpNote = WINDOW_NOTE;
    }
  }
  return { ok: true, doses: built };
}

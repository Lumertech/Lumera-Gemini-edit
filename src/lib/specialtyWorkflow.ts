import type { AppUser, PolyclinicSpecialty } from "../types";
import { demoAccountByEmail } from "./demoAccounts";
import { mapSpecialtyToPackId } from "./specialtyPack";

/** Views a specialty pack may land on or deep-link to. Keep in sync with Navbar NavView. */
export type WorkflowView =
  | "welcome"
  | "reception"
  | "ambient"
  | "rx"
  | "smart-rx"
  | "queue"
  | "appointments"
  | "billing"
  | "portal"
  | "wellness"
  | "therapy-session"
  | "consult-practice";

export type WorkflowKind =
  | "medical"
  | "dental"
  | "physio"
  | "therapy"
  | "wellness"
  | "consultant"
  | "front-desk"
  | "patient"
  | "admin";

export interface IntakeField {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "select" | "number";
  options?: string[];
}

export interface WorkflowCta {
  id: string;
  label: string;
  description: string;
  view: WorkflowView;
}

export interface SpecialtyWorkflowPack {
  id: string;
  kind: WorkflowKind;
  specialty: string;
  practiceLine: string;
  homeView: WorkflowView;
  chartLabel: string;
  queueLabel: string;
  receptionLabel: string;
  appointmentsLabel: string;
  primaryCta: string;
  consultTypeDefault: string;
  consultTypes: string[];
  intakeFields: IntakeField[];
  ctas: WorkflowCta[];
  showMedicalRx: boolean;
  rxModule: PolyclinicSpecialty | null;
  sandboxNotice: string;
}

const SANDBOX =
  "SANDBOX / DEMO workspace — sample data and NHA sandbox path only. Not ABDM certified.";

function medicalPack(specialty: PolyclinicSpecialty, extra: IntakeField[] = []): SpecialtyWorkflowPack {
  return {
    id: specialty.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    kind: "medical",
    specialty,
    practiceLine: "Doctors & Clinics",
    homeView: "queue",
    chartLabel: `${specialty} consult & Rx`,
    queueLabel: `${specialty} OPD queue`,
    receptionLabel: `${specialty} intake`,
    appointmentsLabel: `${specialty} appointments`,
    primaryCta: `Start ${specialty} consult`,
    consultTypeDefault: "Walk-in Consultation",
    consultTypes: ["Walk-in Consultation", "Follow-up", "Report Review", "Emergency Triage"],
    intakeFields: [
      { key: "chiefComplaint", label: "Chief complaint", placeholder: "Why is the patient here today?" },
      ...extra,
    ],
    ctas: [
      { id: "consult", label: `Open ${specialty} chart`, description: "Specialty-locked consult with the matching clinical module.", view: "rx" },
      { id: "intake", label: "Register / check in", description: "Specialty intake at reception, then issue a waiting token.", view: "reception" },
      { id: "queue", label: "OPD queue", description: "Call the next token for this specialty.", view: "queue" },
    ],
    showMedicalRx: true,
    rxModule: specialty,
    sandboxNotice: SANDBOX,
  };
}

const PACKS: Record<string, SpecialtyWorkflowPack> = {
  "general medicine": medicalPack("General Medicine", [
    { key: "duration", label: "Symptom duration", placeholder: "e.g. 3 days, 2 weeks" },
  ]),
  cardiology: medicalPack("Cardiology", [
    { key: "chestPain", label: "Chest pain / dyspnoea", placeholder: "Onset, character, at rest or exertion" },
    { key: "nyhaHint", label: "Functional class hint", type: "select", options: ["Unknown", "I", "II", "III", "IV"] },
  ]),
  dermatology: medicalPack("Dermatology", [
    { key: "lesion", label: "Lesion / rash", placeholder: "Site, duration, itch, previous treatment" },
  ]),
  orthopedics: medicalPack("Orthopedics", [
    { key: "joint", label: "Affected joint / limb", placeholder: "e.g. Right knee, lumbar spine" },
    {
      key: "weightBearing",
      label: "Weight bearing",
      type: "select",
      options: ["Full", "Partial", "Non-weight bearing", "Unknown"],
    },
  ]),
  pediatrics: medicalPack("Pediatrics", [
    { key: "weightKg", label: "Weight (kg)", type: "number", placeholder: "Used for dose checks" },
    { key: "immunisation", label: "Immunisation due", placeholder: "e.g. MMR, none today" },
  ]),
  gynecology: medicalPack("Gynecology", [
    { key: "lmp", label: "LMP date", placeholder: "YYYY-MM-DD if known" },
    { key: "obstetric", label: "G / P / L / A", placeholder: "e.g. G2P1L1A0" },
  ]),
  ent: medicalPack("ENT", [
    { key: "entSite", label: "Primary site", type: "select", options: ["Ear", "Nose", "Throat", "Neck", "Mixed"] },
    { key: "hearing", label: "Hearing / obstruction notes", placeholder: "Laterality, duration, discharge" },
  ]),
  neurology: medicalPack("Neurology", [
    { key: "neuroOnset", label: "Onset", placeholder: "Acute / subacute / chronic" },
  ]),
  ophthalmology: medicalPack("Ophthalmology", [
    { key: "eye", label: "Affected eye", type: "select", options: ["OD", "OS", "OU", "Unknown"] },
    { key: "vision", label: "Vision complaint", placeholder: "Blur, pain, redness, flashes" },
  ]),
  "dental surgery": {
    id: "dental",
    kind: "dental",
    specialty: "Dental Surgery",
    practiceLine: "Dentists",
    homeView: "queue",
    chartLabel: "Dental chart & visit",
    queueLabel: "Dental chair queue",
    receptionLabel: "Dental intake",
    appointmentsLabel: "Dental appointments",
    primaryCta: "Open dental chart",
    consultTypeDefault: "Dental examination",
    consultTypes: ["Dental examination", "Scaling", "Restoration", "RCT review", "Extraction"],
    intakeFields: [
      { key: "toothPain", label: "Tooth / pain site", placeholder: "e.g. Upper right 16, sensitivity to cold" },
      { key: "lastVisit", label: "Last dental visit", placeholder: "Approximate month/year" },
      {
        key: "hygiene",
        label: "Oral hygiene",
        type: "select",
        options: ["Good", "Fair", "Poor / heavy calculus", "Unknown"],
      },
    ],
    ctas: [
      { id: "chart", label: "Odontogram / dental visit", description: "Tooth chart and planned procedures — not a GP Rx pad.", view: "rx" },
      { id: "intake", label: "Dental intake", description: "Chief dental complaint and chair assignment.", view: "reception" },
      { id: "queue", label: "Chair queue", description: "Waiting and in-chair tokens.", view: "queue" },
    ],
    showMedicalRx: true,
    rxModule: "Dental Surgery",
    sandboxNotice: SANDBOX,
  },
  "physiotherapy & rehabilitation": {
    id: "physio",
    kind: "physio",
    specialty: "Physiotherapy & Rehabilitation",
    practiceLine: "Physiotherapists",
    homeView: "queue",
    chartLabel: "Physio assessment & session",
    queueLabel: "Rehab session board",
    receptionLabel: "Physio intake",
    appointmentsLabel: "Therapy sessions",
    primaryCta: "Start therapy session",
    consultTypeDefault: "Rehab session",
    consultTypes: ["Initial assessment", "Rehab session", "Post-op protocol", "Sports physio"],
    intakeFields: [
      { key: "area", label: "Affected area", placeholder: "e.g. Left shoulder, L4-L5" },
      { key: "vas", label: "Pain VAS (0–10)", type: "number", placeholder: "0" },
      { key: "onset", label: "Onset / injury", placeholder: "Sports, post-op, gradual" },
    ],
    ctas: [
      { id: "session", label: "Assessment & treatment plan", description: "VAS, ROM, procedures, home exercise — not a doctor Rx-first chart.", view: "rx" },
      { id: "intake", label: "New rehab intake", description: "Area, pain score, session type.", view: "reception" },
      { id: "queue", label: "Today's sessions", description: "Session board for the rehab suite.", view: "queue" },
    ],
    showMedicalRx: true,
    rxModule: "Physiotherapy & Rehabilitation",
    sandboxNotice: SANDBOX,
  },
  "psychiatry & mental health": {
    id: "therapy",
    kind: "therapy",
    specialty: "Psychiatry & Mental Health",
    practiceLine: "Therapists",
    homeView: "therapy-session",
    chartLabel: "Therapy session note",
    queueLabel: "Session list",
    receptionLabel: "Therapy intake",
    appointmentsLabel: "Session calendar",
    primaryCta: "Start session note",
    consultTypeDefault: "Counseling session",
    consultTypes: ["Intake session", "Counseling session", "Follow-up", "Crisis support"],
    intakeFields: [
      { key: "presenting", label: "Presenting concern", placeholder: "Client's words — keep brief" },
      {
        key: "modality",
        label: "Modality",
        type: "select",
        options: ["CBT", "Supportive", "Couple / family", "Trauma-informed", "Other"],
      },
      { key: "risk", label: "Risk flag", type: "select", options: ["None noted", "Monitor", "Escalate / refer"] },
    ],
    ctas: [
      { id: "note", label: "Session note", description: "Counseling note and plan. Medicines are not the default path.", view: "therapy-session" },
      { id: "intake", label: "Client intake", description: "Presenting concern and modality.", view: "reception" },
      { id: "calendar", label: "Sessions", description: "Upcoming counseling appointments.", view: "appointments" },
    ],
    showMedicalRx: false,
    rxModule: null,
    sandboxNotice: SANDBOX,
  },
  "wellness & spas": {
    id: "wellness",
    kind: "wellness",
    specialty: "Wellness & Spas",
    practiceLine: "Wellness & Spas",
    homeView: "wellness",
    chartLabel: "Service ticket",
    queueLabel: "Treatment board",
    receptionLabel: "Guest intake",
    appointmentsLabel: "Spa / salon book",
    primaryCta: "Book a service",
    consultTypeDefault: "Spa service",
    consultTypes: ["Spa service", "Salon service", "Package session", "Membership visit"],
    intakeFields: [
      {
        key: "service",
        label: "Requested service",
        type: "select",
        options: ["Hair spa", "Cut & style", "Facial", "Deep tissue massage", "Manicure / pedicure", "Package"],
      },
      {
        key: "package",
        label: "Package / membership",
        type: "select",
        options: ["None / à la carte", "Glow 4-session", "Relax 6-session", "Salon membership"],
      },
      { key: "allergies", label: "Product / skin notes", placeholder: "Fragrance, henna, nut oils…" },
    ],
    ctas: [
      { id: "book", label: "Services & packages", description: "Salon/spa book — not a medical record.", view: "wellness" },
      { id: "guest", label: "Guest check-in", description: "Name, phone, service, package.", view: "reception" },
      { id: "pay", label: "Collect payment", description: "Invoice the service or package.", view: "billing" },
    ],
    showMedicalRx: false,
    rxModule: null,
    sandboxNotice: "SANDBOX / DEMO wellness desk — services and packages only. Not a medical chart. Not ABDM certified.",
  },
  consulting: {
    id: "consultant",
    kind: "consultant",
    specialty: "Consulting",
    practiceLine: "Consultants",
    homeView: "consult-practice",
    chartLabel: "Consult brief",
    queueLabel: "Meeting board",
    receptionLabel: "Client intake",
    appointmentsLabel: "Meetings",
    primaryCta: "New meeting",
    consultTypeDefault: "Advisory meeting",
    consultTypes: ["Discovery call", "Advisory meeting", "Document review", "Retainer check-in"],
    intakeFields: [
      { key: "topic", label: "Meeting topic", placeholder: "e.g. Pricing review, ops audit" },
      { key: "duration", label: "Duration (minutes)", type: "number", placeholder: "45" },
      { key: "docs", label: "Documents requested", placeholder: "Deck, contract, spreadsheet…" },
    ],
    ctas: [
      { id: "brief", label: "Consult workspace", description: "Meetings, briefs, invoices — not a clinic EMR.", view: "consult-practice" },
      { id: "calendar", label: "Schedule", description: "Book the next advisory slot.", view: "appointments" },
      { id: "invoice", label: "Invoice client", description: "Fee collection for this engagement.", view: "billing" },
    ],
    showMedicalRx: false,
    rxModule: null,
    sandboxNotice: "SANDBOX / DEMO consultant desk — meetings and invoices. Not a medical chart. Not ABDM certified.",
  },
};

const FRONT_DESK: SpecialtyWorkflowPack = {
  id: "front-desk",
  kind: "front-desk",
  specialty: "",
  practiceLine: "Front desk",
  homeView: "reception",
  chartLabel: "Desk",
  queueLabel: "OPD queue",
  receptionLabel: "Reception & ABHA intake",
  appointmentsLabel: "Appointments",
  primaryCta: "Register patient",
  consultTypeDefault: "Walk-in Consultation",
  consultTypes: ["Walk-in Consultation", "Follow-up", "Emergency Triage"],
  intakeFields: [],
  ctas: [
    { id: "intake", label: "Register / check in", description: "Issue a waiting token.", view: "reception" },
    { id: "queue", label: "Queue", description: "Live waiting list.", view: "queue" },
    { id: "bill", label: "Billing", description: "Collect at the desk.", view: "billing" },
  ],
  showMedicalRx: false,
  rxModule: null,
  sandboxNotice: SANDBOX,
};

const PATIENT_PACK: SpecialtyWorkflowPack = {
  id: "patient",
  kind: "patient",
  specialty: "",
  practiceLine: "Patient",
  homeView: "portal",
  chartLabel: "Records",
  queueLabel: "",
  receptionLabel: "",
  appointmentsLabel: "My appointments",
  primaryCta: "Open portal",
  consultTypeDefault: "",
  consultTypes: [],
  intakeFields: [],
  ctas: [],
  showMedicalRx: false,
  rxModule: null,
  sandboxNotice: SANDBOX,
};

const ADMIN_PACK: SpecialtyWorkflowPack = {
  id: "admin",
  kind: "admin",
  specialty: "",
  practiceLine: "Platform",
  homeView: "welcome",
  chartLabel: "Admin",
  queueLabel: "",
  receptionLabel: "",
  appointmentsLabel: "",
  primaryCta: "Admin console",
  consultTypeDefault: "",
  consultTypes: [],
  intakeFields: [],
  ctas: [],
  showMedicalRx: false,
  rxModule: null,
  sandboxNotice: SANDBOX,
};

const DEFAULT_MEDICAL = PACKS["general medicine"];

export const PRACTICE_SPECIALTIES: string[] = [
  "General Medicine",
  "Cardiology",
  "Pediatrics",
  "Dermatology",
  "Orthopedics",
  "Physiotherapy & Rehabilitation",
  "Gynecology",
  "ENT",
  "Neurology",
  "Ophthalmology",
  "Dental Surgery",
  "Psychiatry & Mental Health",
  "Wellness & Spas",
  "Consulting",
];

export function normalizeSpecialtyKey(value?: string | null): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveRxModule(specialty?: string | null): PolyclinicSpecialty {
  const raw = String(specialty || "");
  const s = raw.toLowerCase();
  if (s.includes("physio") || s.includes("rehab")) return "Physiotherapy & Rehabilitation";
  if (s.includes("wellness") || s.includes("spa") || s.includes("salon")) return "Wellness & Spas";
  if (s.includes("consult") && !s.includes("consultation")) return "Consulting";
  if (s.includes("psych") || s.includes("therap") || s.includes("counsel") || s.includes("mental health")) {
    return "Psychiatry & Mental Health";
  }
  if (s.includes("cardio")) return "Cardiology";
  if (s.includes("derm")) return "Dermatology";
  if (s.includes("ortho")) return "Orthopedics";
  if (s.includes("pediatr") || s.includes("paediatr")) return "Pediatrics";
  if (s.includes("eye") || s.includes("ophthal")) return "Ophthalmology";
  if (s.includes("dent") || s.includes("oral")) return "Dental Surgery";
  if (s.includes("gyn") || s.includes("obstet")) return "Gynecology";
  if (s === "ent" || s.includes("otolaryng") || /\bent\b/.test(s)) return "ENT";
  if (s.includes("neuro") && !s.includes("surgeon")) return "Neurology";
  if (s.includes("general") || s.includes("physician") || /\bclinics?\b/.test(s)) return "General Medicine";
  const exact = PRACTICE_SPECIALTIES.find((item) => item.toLowerCase() === s);
  return (exact as PolyclinicSpecialty) || "General Medicine";
}

function packForSpecialty(specialty?: string | null): SpecialtyWorkflowPack {
  const packId = mapSpecialtyToPackId(specialty);
  if (packId === "dentist") return PACKS["dental surgery"] || DEFAULT_MEDICAL;
  if (packId === "physio") return PACKS["physiotherapy & rehabilitation"] || DEFAULT_MEDICAL;
  if (packId === "spa_salon") return PACKS["wellness & spas"] || DEFAULT_MEDICAL;
  if (packId === "therapist") return PACKS["psychiatry & mental health"] || DEFAULT_MEDICAL;
  if (packId === "consultant") return PACKS["consulting"] || DEFAULT_MEDICAL;
  const module = resolveRxModule(specialty);
  const key = module.toLowerCase();
  return PACKS[key] || DEFAULT_MEDICAL;
}

export function workflowForUser(user?: AppUser | null): SpecialtyWorkflowPack {
  if (!user) return DEFAULT_MEDICAL;
  if (user.role === "super_admin") return ADMIN_PACK;
  if (user.role === "patient") return PATIENT_PACK;
  if (user.role === "receptionist") return FRONT_DESK;

  const fromEmail = demoAccountByEmail(user.email);
  const specialty = fromEmail?.displaySpecialty || user.specialty || fromEmail?.specialty || "";
  return packForSpecialty(specialty);
}

export function clinicianHomeView(user?: AppUser | null): WorkflowView {
  if (!user) return "queue";
  if (user.role === "receptionist") return "reception";
  if (user.role === "CLINIC_ADMIN" || user.role === "polyclinic_admin") {
    return user.practiceType === "polyclinic" ? "welcome" : "queue";
  }
  return workflowForUser(user).homeView;
}

export function allowedViewsForWorkflow<T extends string>(base: T[], pack: SpecialtyWorkflowPack): T[] {
  const extra = new Set<string>(base);
  if (pack.kind === "wellness") extra.add("wellness");
  if (pack.kind === "therapy") extra.add("therapy-session");
  if (pack.kind === "consultant") extra.add("consult-practice");
  if (!pack.showMedicalRx) {
    extra.delete("rx");
    extra.delete("smart-rx");
  }
  return Array.from(extra) as T[];
}

export function specialtyMatchesDoctor(userSpecialty: string | undefined, doctorSpecialty: string): boolean {
  if (!userSpecialty) return false;
  const a = normalizeSpecialtyKey(userSpecialty);
  const b = normalizeSpecialtyKey(doctorSpecialty);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a) || resolveRxModule(userSpecialty) === resolveRxModule(doctorSpecialty);
}

/** Product-locked Admin UM specialty packs. Packs differ by modules + clinical mode, not label. */

export const SPECIALTY_PACK_IDS = ["gp", "physio", "dentist", "spa_salon", "therapist", "consultant"] as const;

export type SpecialtyPackId = (typeof SPECIALTY_PACK_IDS)[number];

export type RoleHomeSurface = "admin" | "app" | "portal" | "login";

export interface SpecialtyPack {
  id: SpecialtyPackId;
  label: string;
  defaultSpecialty: string;
  /** Display aliases and major-medical specialties that resolve to this pack. */
  aliases: string[];
  roleHome: RoleHomeSurface;
  homeView: string;
  /** Distinct capability set — packs must not share an identical modules array. */
  modules: readonly string[];
  clinicalMode: "medical_opd" | "rehab" | "dental" | "wellness" | "mental_health" | "advisory";
}

export const SPECIALTY_PACKS: Record<SpecialtyPackId, SpecialtyPack> = {
  gp: {
    id: "gp",
    label: "General Practice",
    defaultSpecialty: "General Medicine",
    aliases: [
      "gp",
      "general practice",
      "general medicine",
      "cardiology",
      "pediatrics",
      "dermatology",
      "orthopedics",
      "gynecology",
      "ent",
      "neurology",
      "ophthalmology",
    ],
    roleHome: "app",
    homeView: "queue",
    modules: ["soap", "rx", "lab", "major_medical", "vitals"],
    clinicalMode: "medical_opd",
  },
  physio: {
    id: "physio",
    label: "Physiotherapy",
    defaultSpecialty: "Physiotherapy & Rehabilitation",
    aliases: ["physio", "physiotherapy", "physiotherapy & rehabilitation", "rehab", "rehabilitation"],
    roleHome: "app",
    homeView: "rehab",
    modules: ["rehab_assessment", "performed_therapies", "prescribed_exercises", "rom"],
    clinicalMode: "rehab",
  },
  dentist: {
    id: "dentist",
    label: "Dentist",
    defaultSpecialty: "Dental Surgery",
    aliases: ["dentist", "dental", "dental surgery", "endodontics"],
    roleHome: "app",
    homeView: "dental",
    modules: ["dental_chart", "endodontics", "oral_exam"],
    clinicalMode: "dental",
  },
  spa_salon: {
    id: "spa_salon",
    label: "Spa / Salon",
    defaultSpecialty: "Spa & Salon",
    aliases: ["spa_salon", "spa", "salon", "spa & salon", "spa/salon"],
    roleHome: "app",
    homeView: "spa",
    modules: ["service_menu", "wellness_notes", "appointment_slot"],
    clinicalMode: "wellness",
  },
  therapist: {
    id: "therapist",
    label: "Therapist",
    defaultSpecialty: "Psychiatry & Mental Health",
    aliases: ["therapist", "therapy", "psychiatry", "psychiatry & mental health", "mental health", "counsellor"],
    roleHome: "app",
    homeView: "therapy",
    modules: ["session_notes", "mental_health", "care_plan"],
    clinicalMode: "mental_health",
  },
  consultant: {
    id: "consultant",
    label: "Consultant",
    defaultSpecialty: "Consulting",
    aliases: ["consultant", "consulting", "advisory"],
    roleHome: "app",
    homeView: "consult",
    modules: ["advisory_opinion", "referral", "second_opinion"],
    clinicalMode: "advisory",
  },
};

function normalizePackKey(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[&/]+/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function isSpecialtyPackId(value: string): value is SpecialtyPackId {
  return (SPECIALTY_PACK_IDS as readonly string[]).includes(value);
}

export function getSpecialtyPack(id: string | null | undefined): SpecialtyPack | null {
  if (!id) return null;
  return isSpecialtyPackId(id) ? SPECIALTY_PACKS[id] : null;
}

/** Resolve a pack id, alias, or display specialty (major medical → gp). */
export function resolveSpecialtyPack(raw: string | null | undefined): SpecialtyPack | null {
  const key = normalizePackKey(String(raw || ""));
  if (!key) return null;
  const compact = key.replace(/\s+/g, "_");
  if (isSpecialtyPackId(compact)) return SPECIALTY_PACKS[compact];
  if (isSpecialtyPackId(key.replace(/\s+/g, ""))) {
    // no packed ids without underscore except exact list
  }
  for (const pack of Object.values(SPECIALTY_PACKS)) {
    if (normalizePackKey(pack.id) === key) return pack;
    if (normalizePackKey(pack.label) === key) return pack;
    if (normalizePackKey(pack.defaultSpecialty) === key) return pack;
    if (pack.aliases.some((alias) => normalizePackKey(alias) === key)) return pack;
  }
  return null;
}

/** Canonical DB/API value: specialty enum, never a display label. */
export function canonicalSpecialty(raw: string | null | undefined): SpecialtyPackId | "" {
  return resolveSpecialtyPack(raw)?.id || "";
}

export function parseSpecialtyPackInput(
  raw: unknown
): { specialty: SpecialtyPackId } | { error: string } | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const pack = resolveSpecialtyPack(text);
  if (!pack) {
    return {
      error: `Unknown specialty pack "${text}". Expected gp|physio|dentist|spa_salon|therapist|consultant`,
    };
  }
  return { specialty: pack.id };
}

export function packFingerprint(pack: SpecialtyPack): string {
  return `${pack.id}:${pack.clinicalMode}:${[...pack.modules].sort().join(",")}`;
}

/** FAIL if two packs only differ by label — used by tests and boot asserts. */
export function assertPacksDifferByMoreThanLabel(): void {
  const seen = new Map<string, SpecialtyPackId>();
  for (const id of SPECIALTY_PACK_IDS) {
    const pack = SPECIALTY_PACKS[id];
    const key = `${pack.clinicalMode}|${[...pack.modules].sort().join(",")}`;
    const prior = seen.get(key);
    if (prior) {
      throw new Error(`Specialty packs ${prior} and ${id} only differ by label`);
    }
    seen.set(key, id);
  }
}

export function roleHomeForAccount(
  role: string,
  packId?: string | null
): { roleHome: RoleHomeSurface; homeView: string; packId: string } {
  if (role === "super_admin") return { roleHome: "admin", homeView: "admin", packId: packId || "" };
  if (role === "patient") return { roleHome: "portal", homeView: "portal", packId: packId || "" };
  if (role === "receptionist") return { roleHome: "app", homeView: "reception", packId: packId || "" };
  if (role === "polyclinic_admin" || role === "CLINIC_ADMIN") {
    return { roleHome: "app", homeView: "welcome", packId: packId || "" };
  }
  if (role === "doctor") {
    const pack = getSpecialtyPack(packId || "") || SPECIALTY_PACKS.gp;
    return { roleHome: pack.roleHome, homeView: pack.homeView, packId: packId || pack.id };
  }
  return { roleHome: "login", homeView: "login", packId: packId || "" };
}

export const DEMO_SPECIALTY_MATRIX: ReadonlyArray<{
  id: string;
  email: string;
  name: string;
  role: "doctor" | "receptionist" | "super_admin";
  specialty: SpecialtyPackId;
  phone: string;
}> = [
  {
    id: "user-demo-gp",
    email: "gp.doctor@lumera.me",
    name: "Dr. Demo GP",
    role: "doctor",
    specialty: "gp",
    phone: "+91 98001 11001",
  },
  {
    id: "user-demo-physio",
    email: "physio.doctor@lumera.me",
    name: "Dr. Demo Physio",
    role: "doctor",
    specialty: "physio",
    phone: "+91 98001 11002",
  },
  {
    id: "user-demo-dentist",
    email: "dentist.doctor@lumera.me",
    name: "Dr. Demo Dentist",
    role: "doctor",
    specialty: "dentist",
    phone: "+91 98001 11003",
  },
  {
    id: "user-demo-spa",
    email: "spa.doctor@lumera.me",
    name: "Dr. Demo Spa",
    role: "doctor",
    specialty: "spa_salon",
    phone: "+91 98001 11004",
  },
  {
    id: "user-demo-therapist",
    email: "therapist@lumera.me",
    name: "Dr. Demo Therapist",
    role: "doctor",
    specialty: "therapist",
    phone: "+91 98001 11005",
  },
  {
    id: "user-demo-consultant",
    email: "consultant@lumera.me",
    name: "Dr. Demo Consultant",
    role: "doctor",
    specialty: "consultant",
    phone: "+91 98001 11006",
  },
];

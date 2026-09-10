/** Frozen specialty pack-id SoT. Persist these on users.specialty — never human labels. */
export const SPECIALTY_PACK_IDS = ["gp", "physio", "dentist", "spa_salon", "therapist", "consultant"] as const;
export type SpecialtyPackId = (typeof SPECIALTY_PACK_IDS)[number];

export const PACK_ID_LABELS: Record<SpecialtyPackId, string> = {
  gp: "General Medicine",
  physio: "Physiotherapy & Rehabilitation",
  dentist: "Dental Surgery",
  spa_salon: "Wellness & Spas",
  therapist: "Psychiatry & Mental Health",
  consultant: "Consulting",
};

export const PACK_ID_OPTIONS: Array<{ id: SpecialtyPackId; label: string }> = SPECIALTY_PACK_IDS.map((id) => ({
  id,
  label: PACK_ID_LABELS[id],
}));

function normKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Frozen UI-label / alias → pack id. Unknown keys are not guessed. */
const LABEL_TO_PACK_ID: Record<string, SpecialtyPackId> = {
  gp: "gp",
  general: "gp",
  general_medicine: "gp",
  doctors_and_clinics: "gp",
  physician: "gp",
  cardiology: "gp",
  dermatology: "gp",
  orthopedics: "gp",
  orthopaedics: "gp",
  pediatrics: "gp",
  paediatrics: "gp",
  gynecology: "gp",
  gynaecology: "gp",
  obstetrics: "gp",
  obstetrics_and_gynecology: "gp",
  ent: "gp",
  otolaryngology: "gp",
  neurology: "gp",
  ophthalmology: "gp",
  physio: "physio",
  physiotherapy: "physio",
  physiotherapy_and_rehabilitation: "physio",
  rehabilitation: "physio",
  dentist: "dentist",
  dental: "dentist",
  dental_surgery: "dentist",
  oral: "dentist",
  spa_salon: "spa_salon",
  wellness: "spa_salon",
  wellness_and_spas: "spa_salon",
  spa: "spa_salon",
  salon: "spa_salon",
  therapist: "therapist",
  psychiatry: "therapist",
  psychiatry_and_mental_health: "therapist",
  mental_health: "therapist",
  counseling: "therapist",
  counselling: "therapist",
  consultant: "consultant",
  consulting: "consultant",
};

export function isSpecialtyPackId(value?: string | null): value is SpecialtyPackId {
  return SPECIALTY_PACK_IDS.includes(String(value || "") as SpecialtyPackId);
}

export function packIdLabel(id?: string | null): string {
  if (isSpecialtyPackId(id)) return PACK_ID_LABELS[id];
  return "";
}

/** Map a UI label or pack id to the frozen SoT. Unknown → null (fail closed). */
export function mapSpecialtyToPackId(value?: string | null): SpecialtyPackId | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (isSpecialtyPackId(raw)) return raw;
  return LABEL_TO_PACK_ID[normKey(raw)] || null;
}

export function persistSpecialtyPackId(
  raw: unknown,
  opts?: { required?: boolean }
): { ok: boolean; id: string; error?: string } {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    if (opts?.required) return { ok: false, id: "", error: "specialty is required" };
    return { ok: true, id: "" };
  }
  const id = mapSpecialtyToPackId(trimmed);
  if (!id) {
    return {
      ok: false,
      id: "",
      error: "Unknown specialty. Persist gp|physio|dentist|spa_salon|therapist|consultant (or a mapped UI label).",
    };
  }
  return { ok: true, id };
}

export type PracticeType = "individual" | "polyclinic";

/** Founder lock: new accounts and Sign-in → register always start as individual. */
export const DEFAULT_PRACTICE_TYPE: PracticeType = "individual";

const EXPLICIT_POLYCLINIC_ALIASES = new Set([
  "polyclinic",
  "multispecialty",
  "multi-specialty",
  "multi_specialty",
]);

/** True only when the user (or an already-persisted account) named polyclinic. */
export function isExplicitPolyclinicChoice(value?: string | null): boolean {
  return EXPLICIT_POLYCLINIC_ALIASES.has(String(value || "").trim().toLowerCase());
}

/**
 * Register / create-clinic first paint.
 * URL query strings must never preselect Multispecialty — ignore them.
 */
export function initialRegisterPracticeType(_urlSearch?: string | null): PracticeType {
  void _urlSearch;
  return DEFAULT_PRACTICE_TYPE;
}

/**
 * Payload sent to /auth/register-practice.
 * Multispecialty is included only after an explicit UI click.
 */
export function registerPracticeTypePayload(
  selected: PracticeType,
  userClickedPolyclinic: boolean
): PracticeType {
  if (userClickedPolyclinic && selected === "polyclinic") return "polyclinic";
  return DEFAULT_PRACTICE_TYPE;
}

export interface RosterDoctorDraft {
  name: string;
  specialty: string;
  qualification?: string;
  regNumber?: string;
  consultationFee?: number;
  opdTiming?: string;
}

export interface FrontDeskRules {
  walkInEnabled: boolean;
  sharedQueue: boolean;
  tokenPrefix: string;
}

export function normalizeUiPracticeType(value?: string | null): PracticeType {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "polyclinic" || raw === "multispecialty" || raw === "multi-specialty" || raw === "multi_specialty") {
    return "polyclinic";
  }
  return "individual";
}

export function onboardingTrackFromUser(practiceType?: string | null): PracticeType {
  return normalizeUiPracticeType(practiceType);
}

/** Individual clinicians land on the daily OPD/queue surface — never roster/admin chrome. */
export function postOnboardingHomeView(practiceType: PracticeType): "queue" | "welcome" {
  return practiceType === "polyclinic" ? "welcome" : "queue";
}

export function shouldShowPolyclinicChrome(practiceType?: string | null): boolean {
  return normalizeUiPracticeType(practiceType) === "polyclinic";
}

export const DEFAULT_FRONT_DESK: FrontDeskRules = {
  walkInEnabled: true,
  sharedQueue: true,
  tokenPrefix: "OPD",
};

export type PracticeType = "individual" | "polyclinic";

/** Founder lock: new accounts and Sign-in → register always start as individual. */
export const DEFAULT_PRACTICE_TYPE: PracticeType = "individual";

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

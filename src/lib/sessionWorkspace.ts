import { AppUser, ClinicSettings, Doctor, Patient, PolyclinicSpecialty, TenantLetterhead, UserRole } from "../types";
import { DEFAULT_CLINIC_SETTINGS } from "../data/clinicalData";
import { BLANK_CLINIC_SETTINGS } from "./letterhead";

export const UNASSIGNED_PATIENT: Patient = {
  id: "",
  uhid: "—",
  name: "No patient selected",
  age: 0,
  gender: "Other",
  phone: "",
  bloodGroup: "",
  allergies: [],
  chronicConditions: [],
  emergencyContact: "",
};

export const CLINIC_ROLES: UserRole[] = ["doctor", "receptionist", "polyclinic_admin", "CLINIC_ADMIN"];

export function needsOnboarding(user: AppUser | null | undefined): boolean {
  if (!user) return false;
  if (!CLINIC_ROLES.includes(user.role)) return false;
  if (user.isDemoWorkspace) return false;
  return user.onboardingCompleted === false;
}

export function isPolyclinicPractice(user: AppUser | null | undefined): boolean {
  return user?.practiceType === "polyclinic";
}

export function displayDoctorName(name?: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "";
  return /^dr\.?\s/i.test(trimmed) ? trimmed.replace(/^dr\.?\s+/i, "Dr. ") : `Dr. ${trimmed}`;
}

export function resolveSessionDoctor(user: AppUser | null | undefined, doctors: Doctor[] = []): Doctor {
  if (user?.id) {
    const owned = doctors.find((d) => d.userId === user.id);
    if (owned) return owned;
  }
  if (user?.email) {
    const email = user.email.toLowerCase();
    const byEmail = doctors.find((d) => d.email && d.email.toLowerCase() === email);
    if (byEmail) return byEmail;
  }
  return doctorFromUser(user);
}

export function doctorFromUser(user: AppUser | null | undefined, fallback?: Doctor | null): Doctor {
  if (fallback && fallback.id && user?.id && fallback.userId === user.id) return fallback;
  const name = displayDoctorName(user?.name) || "Clinician";
  return {
    id: user?.id ? `session-${user.id}` : "session-doctor",
    userId: user?.id || null,
    name,
    qualification: "",
    regNumber: "",
    specialty: (user?.specialty as PolyclinicSpecialty) || "General Medicine",
    experienceYears: 0,
    consultationFee: 0,
    opdRoom: "",
    availableDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    opdTiming: "",
    phone: user?.phone || "",
    email: user?.email || "",
    hprId: user?.hprId || "",
    active: true,
    slotDurationMinutes: 15,
    rxTemplate: "classic",
  };
}

export function clinicSettingsFromSession(
  user: AppUser | null | undefined,
  doctor: Doctor,
  letterhead?: TenantLetterhead | null
): ClinicSettings {
  if (user?.isDemoWorkspace && !letterhead) {
    return {
      ...DEFAULT_CLINIC_SETTINGS,
      signatureUrl: doctor.signatureUrl || DEFAULT_CLINIC_SETTINGS.signatureUrl || "",
    };
  }

  const base = user?.isDemoWorkspace ? DEFAULT_CLINIC_SETTINGS : BLANK_CLINIC_SETTINGS;

  return {
    ...base,
    name: letterhead?.clinicName || user?.clinicName || base.name,
    tagline: letterhead?.tagline || base.tagline,
    address: letterhead?.address || base.address,
    city: letterhead?.city || base.city,
    phone: letterhead?.phone || user?.phone || doctor.phone || base.phone,
    email: letterhead?.email || user?.email || doctor.email || base.email,
    website: letterhead?.website || base.website,
    gstin: letterhead?.gstin || base.gstin,
    regId: letterhead?.regId || base.regId,
    upiId: letterhead?.upiId || base.upiId,
    whatsappNumber: letterhead?.whatsappNumber || user?.phone || base.whatsappNumber,
    sealText:
      letterhead?.sealText ||
      (doctor.signatureUrl ? "Digitally signed by treating clinician" : base.sealText),
    footerDisclaimer: letterhead?.footerDisclaimer || base.footerDisclaimer,
    signatureUrl: letterhead?.signatureUrl || doctor.signatureUrl || base.signatureUrl || "",
  };
}

export const WELCOME_FLAG_KEY = "lumera_show_welcome_dashboard";

export function markWelcomeDashboard() {
  try {
    sessionStorage.setItem(WELCOME_FLAG_KEY, "true");
  } catch {
    /* ignore */
  }
}

export function consumeWelcomeDashboard(): boolean {
  try {
    const show = sessionStorage.getItem(WELCOME_FLAG_KEY) === "true";
    if (show) sessionStorage.removeItem(WELCOME_FLAG_KEY);
    return show;
  } catch {
    return false;
  }
}

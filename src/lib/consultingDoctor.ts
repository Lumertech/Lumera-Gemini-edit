import type { Doctor, PolyclinicSpecialty } from "../types";

/** Visit fields used to pick who is being billed. */
export type ConsultingVisit = {
  doctorId?: string;
  doctorName?: string;
  specialty?: string;
  consultationFee?: number;
};

export type ConsultingDoctorResolution = {
  doctor: Doctor | null;
  /** True when the clinic has several doctors and this bill is not tied to one visit. */
  needsChoice: boolean;
  /** True when the user may switch the consulting doctor. */
  canChoose: boolean;
};

function namedRoster(doctors: Doctor[]): Doctor[] {
  return (Array.isArray(doctors) ? doctors : []).filter((doctor) => doctor.id && doctor.name.trim());
}

function nameOnlyDoctor(name: string, visit: ConsultingVisit): Doctor {
  return {
    id: "",
    userId: null,
    name,
    qualification: "",
    regNumber: "",
    specialty: (visit.specialty as PolyclinicSpecialty) || "General Medicine",
    experienceYears: 0,
    consultationFee: Number(visit.consultationFee || 0),
    opdRoom: "",
    availableDays: [],
    opdTiming: "",
    phone: "",
    email: "",
    hprId: "",
    active: true,
    slotDurationMinutes: 15,
    rxTemplate: "classic",
  };
}

/**
 * Consulting doctor comes from the visit, then the clinic roster.
 * A bill with no visit uses the only doctor, or waits for a choice when there are several.
 */
export function resolveConsultingDoctor(input: {
  appointment?: ConsultingVisit | null;
  doctors: Doctor[];
  selectedDoctorId?: string;
}): ConsultingDoctorResolution {
  const roster = namedRoster(input.doctors);
  const visit = input.appointment;
  const doctorId = String(visit?.doctorId || "").trim();
  const doctorName = String(visit?.doctorName || "").trim();
  if (visit && (doctorId || doctorName)) {
    const match = doctorId ? roster.find((doctor) => doctor.id === doctorId) : undefined;
    if (match) return { doctor: match, needsChoice: false, canChoose: false };
    if (doctorName) {
      return { doctor: nameOnlyDoctor(doctorName, visit), needsChoice: false, canChoose: false };
    }
  }

  const selectedId = String(input.selectedDoctorId || "").trim();
  const picked = selectedId ? roster.find((doctor) => doctor.id === selectedId) : undefined;
  if (roster.length === 1) {
    return { doctor: picked || roster[0], needsChoice: false, canChoose: false };
  }
  if (picked) return { doctor: picked, needsChoice: false, canChoose: true };
  if (roster.length > 1) return { doctor: null, needsChoice: true, canChoose: true };
  return { doctor: null, needsChoice: false, canChoose: false };
}

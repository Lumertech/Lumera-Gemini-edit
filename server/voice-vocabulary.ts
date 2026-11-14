import { stripDoctorTitles, withSingleDoctorTitle } from "./voice-doctor-name.ts";

export interface VoiceFactDoctor {
  name: string;
  specialty: string;
  timing: string;
  days: string;
}

export interface VoiceFactSchedule {
  opdStartTime: string;
  opdEndTime: string;
  slotDurationMinutes: number;
}

/** Recognition hints only. Maya must not prescribe from this list. */
export const COMMON_INDIAN_MEDICINES = [
  "Paracetamol",
  "Crocin",
  "Dolo 650",
  "Calpol",
  "Combiflam",
  "Brufen",
  "Meftal",
  "Azithromycin",
  "Amoxicillin",
  "Augmentin",
  "Taxim",
  "Ciplox",
  "Pantoprazole",
  "Pan D",
  "Metformin",
  "Glycomet",
  "Telmisartan",
  "Telma",
  "Amlodipine",
  "Thyronorm",
  "Cetirizine",
  "Levocetirizine",
  "Montair LC",
  "Allegra",
  "ORS",
  "Electral",
  "Shelcal",
  "Becosules",
  "Ecosprin",
  "Atorvastatin",
  "Zerodol",
  "Sinarest",
] as const;

export function doctorNicknames(name: string): string[] {
  const clean = stripDoctorTitles(name)
    .replace(/\(.*?\)/g, "")
    .trim();
  const parts = clean.split(/\s+/).filter((part) => part.length > 2);
  const nicks: string[] = [];
  if (parts[0]) nicks.push(parts[0]);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (last && last.toLowerCase() !== parts[0].toLowerCase()) nicks.push(last);
  }
  return nicks;
}

export function formatTenantVoiceFacts(input: {
  clinicName: string;
  doctors: VoiceFactDoctor[];
  schedule: VoiceFactSchedule;
}): string {
  const clinic = String(input.clinicName || "").trim() || "the clinic";
  const doctors = input.doctors.filter((doctor) => String(doctor.name || "").trim());
  const doctorLines = doctors.length
    ? doctors
        .map((doctor) => {
          const nicks = doctorNicknames(doctor.name);
          const alias = nicks.length ? ` (also: ${nicks.join(", ")})` : "";
          const specialty = doctor.specialty.trim() || "General Medicine";
          const timing = doctor.timing.trim() || "hours on file";
          const days = doctor.days.trim() || "days on file";
          const titled = withSingleDoctorTitle(doctor.name, "en") || "the doctor on duty";
          return `  * ${titled}${alias} — ${specialty}; OPD ${timing} (${days})`;
        })
        .join("\n")
    : "  * No doctor is saved on this clinic yet.";
  const services = [...new Set(doctors.map((doctor) => doctor.specialty.trim()).filter(Boolean))];
  const serviceLine = services.length ? services.join(", ") : "services saved on this clinic";
  const start = input.schedule.opdStartTime.trim() || "09:00 AM";
  const end = input.schedule.opdEndTime.trim() || "05:00 PM";
  const slot = Math.max(1, Number(input.schedule.slotDurationMinutes) || 15);
  return `Clinic facts for this call (from the called clinic's account, not a fixed brand):
- Clinic name: ${clinic}
- Clinic OPD window on file: ${start} to ${end}, slot length ${slot} minutes. Use these hours. Do not invent a different closing time.
- Doctors:
${doctorLines}
- Services: ${serviceLine}
- Medicine spellings to prefer when the audio is close (recognition only, never prescribe or suggest a dose): ${COMMON_INDIAN_MEDICINES.join(", ")}.`;
}

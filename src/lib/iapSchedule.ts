/**
 * IAP immunisation checkpoints used for due and overdue reminders.
 * Ages are the recommended start of the window. A dose is overdue 28 days after that date.
 */

export type IapDose = {
  code: string;
  name: string;
  dueAgeDays: number;
};

export const IAP_DOSES: readonly IapDose[] = [
  { code: "bcg", name: "BCG", dueAgeDays: 0 },
  { code: "opv-0", name: "OPV 0", dueAgeDays: 0 },
  { code: "hepb-0", name: "Hepatitis B 0", dueAgeDays: 0 },
  { code: "dtwp-1", name: "DTwP 1", dueAgeDays: 42 },
  { code: "ipv-1", name: "IPV 1", dueAgeDays: 42 },
  { code: "hib-1", name: "Hib 1", dueAgeDays: 42 },
  { code: "hepb-1", name: "Hepatitis B 1", dueAgeDays: 42 },
  { code: "rota-1", name: "Rotavirus 1", dueAgeDays: 42 },
  { code: "pcv-1", name: "PCV 1", dueAgeDays: 42 },
  { code: "dtwp-2", name: "DTwP 2", dueAgeDays: 70 },
  { code: "ipv-2", name: "IPV 2", dueAgeDays: 70 },
  { code: "hib-2", name: "Hib 2", dueAgeDays: 70 },
  { code: "rota-2", name: "Rotavirus 2", dueAgeDays: 70 },
  { code: "pcv-2", name: "PCV 2", dueAgeDays: 70 },
  { code: "dtwp-3", name: "DTwP 3", dueAgeDays: 98 },
  { code: "ipv-3", name: "IPV 3", dueAgeDays: 98 },
  { code: "hib-3", name: "Hib 3", dueAgeDays: 98 },
  { code: "rota-3", name: "Rotavirus 3", dueAgeDays: 98 },
  { code: "pcv-3", name: "PCV 3", dueAgeDays: 98 },
  { code: "opv-1", name: "OPV 1", dueAgeDays: 183 },
  { code: "hepb-3", name: "Hepatitis B 3", dueAgeDays: 183 },
  { code: "flu-1", name: "Influenza 1", dueAgeDays: 183 },
  { code: "flu-2", name: "Influenza 2", dueAgeDays: 213 },
  { code: "mmr-1", name: "MMR 1", dueAgeDays: 274 },
  { code: "opv-2", name: "OPV 2", dueAgeDays: 274 },
  { code: "hepa-1", name: "Hepatitis A 1", dueAgeDays: 365 },
  { code: "mmr-2", name: "MMR 2", dueAgeDays: 456 },
  { code: "varicella-1", name: "Varicella 1", dueAgeDays: 456 },
  { code: "pcv-b", name: "PCV booster", dueAgeDays: 456 },
  { code: "dtwp-b1", name: "DTwP booster 1", dueAgeDays: 487 },
  { code: "ipv-b1", name: "IPV booster 1", dueAgeDays: 487 },
  { code: "hib-b1", name: "Hib booster", dueAgeDays: 487 },
  { code: "hepa-2", name: "Hepatitis A 2", dueAgeDays: 548 },
  { code: "dtwp-b2", name: "DTwP booster 2", dueAgeDays: 1460 },
  { code: "opv-3", name: "OPV 3", dueAgeDays: 1460 },
  { code: "mmr-3", name: "MMR 3", dueAgeDays: 1460 },
  { code: "varicella-2", name: "Varicella 2", dueAgeDays: 1460 },
  { code: "tdap", name: "Tdap", dueAgeDays: 3650 },
  { code: "hpv", name: "HPV", dueAgeDays: 3650 },
] as const;

const OVERDUE_AFTER_DAYS = 28;
const UPCOMING_DAYS = 30;

export type VaccineBucket = {
  code: string;
  name: string;
  dueOn: string;
};

export type VaccinePlan = {
  approximateDob: boolean;
  due: VaccineBucket[];
  overdue: VaccineBucket[];
  upcoming: VaccineBucket[];
};

function dayStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function approximateDobFromAge(ageYears: number, now = new Date()): Date {
  const copy = new Date(now.getTime());
  copy.setUTCDate(copy.getUTCDate() - Math.round(Math.max(0, ageYears) * 365.25));
  return copy;
}

export function vaccinePlan(input: { dob: Date; givenCodes: string[]; now?: Date; approximateDob?: boolean }): VaccinePlan {
  const now = input.now || new Date();
  const given = new Set(input.givenCodes.map((code) => code.trim().toLowerCase()));
  const due: VaccineBucket[] = [];
  const overdue: VaccineBucket[] = [];
  const upcoming: VaccineBucket[] = [];
  for (const dose of IAP_DOSES) {
    if (given.has(dose.code)) continue;
    const dueDate = new Date(input.dob.getTime() + dose.dueAgeDays * 86_400_000);
    const overdueOn = new Date(dueDate.getTime() + OVERDUE_AFTER_DAYS * 86_400_000);
    const bucket = { code: dose.code, name: dose.name, dueOn: dayStamp(dueDate) };
    if (now.getTime() >= overdueOn.getTime()) overdue.push(bucket);
    else if (now.getTime() >= dueDate.getTime()) due.push(bucket);
    else if (dueDate.getTime() - now.getTime() <= UPCOMING_DAYS * 86_400_000) upcoming.push(bucket);
  }
  return { approximateDob: Boolean(input.approximateDob), due, overdue, upcoming };
}

export function isPaediatricAge(ageYears: number): boolean {
  return Number.isFinite(ageYears) && ageYears >= 0 && ageYears < 18;
}

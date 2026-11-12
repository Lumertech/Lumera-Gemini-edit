/**
 * Checkpoint percentiles for screening, not a full LMS z-score.
 * Ages 0–60 months follow WHO child-growth checkpoint shape.
 * Ages 10 and 15 years follow IAP school-age checkpoints.
 * The band is the nearest published percentile on the interpolated checkpoint.
 */

export type GrowthSex = "male" | "female";
export type GrowthMeasure = "height" | "weight" | "bmi" | "head";

type Checkpoint = { ageMonths: number; p3: number; p15: number; p50: number; p85: number; p97: number };

const WEIGHT_MALE: Checkpoint[] = [
  { ageMonths: 0, p3: 2.5, p15: 2.9, p50: 3.3, p85: 3.9, p97: 4.4 },
  { ageMonths: 6, p3: 6.4, p15: 7.1, p50: 7.9, p85: 8.8, p97: 9.8 },
  { ageMonths: 12, p3: 7.7, p15: 8.6, p50: 9.6, p85: 10.8, p97: 12.0 },
  { ageMonths: 24, p3: 9.7, p15: 10.8, p50: 12.2, p85: 13.6, p97: 15.3 },
  { ageMonths: 36, p3: 11.3, p15: 12.7, p50: 14.3, p85: 16.2, p97: 18.3 },
  { ageMonths: 60, p3: 14.3, p15: 16.0, p50: 18.3, p85: 21.0, p97: 24.2 },
  { ageMonths: 120, p3: 23.0, p15: 26.0, p50: 31.0, p85: 38.0, p97: 45.0 },
  { ageMonths: 180, p3: 40.0, p15: 46.0, p50: 56.0, p85: 68.0, p97: 80.0 },
];

const WEIGHT_FEMALE: Checkpoint[] = [
  { ageMonths: 0, p3: 2.4, p15: 2.8, p50: 3.2, p85: 3.7, p97: 4.2 },
  { ageMonths: 6, p3: 5.8, p15: 6.5, p50: 7.3, p85: 8.2, p97: 9.2 },
  { ageMonths: 12, p3: 7.0, p15: 7.9, p50: 8.9, p85: 10.1, p97: 11.5 },
  { ageMonths: 24, p3: 9.0, p15: 10.2, p50: 11.5, p85: 13.0, p97: 14.8 },
  { ageMonths: 36, p3: 10.8, p15: 12.2, p50: 13.9, p85: 15.8, p97: 18.1 },
  { ageMonths: 60, p3: 13.7, p15: 15.5, p50: 18.0, p85: 20.9, p97: 24.2 },
  { ageMonths: 120, p3: 22.0, p15: 26.0, p50: 32.0, p85: 40.0, p97: 48.0 },
  { ageMonths: 180, p3: 38.0, p15: 44.0, p50: 53.0, p85: 64.0, p97: 76.0 },
];

const HEIGHT_MALE: Checkpoint[] = [
  { ageMonths: 0, p3: 46.1, p15: 48.0, p50: 49.9, p85: 51.8, p97: 53.7 },
  { ageMonths: 6, p3: 63.3, p15: 65.5, p50: 67.6, p85: 69.8, p97: 71.9 },
  { ageMonths: 12, p3: 71.0, p15: 73.4, p50: 75.7, p85: 78.1, p97: 80.5 },
  { ageMonths: 24, p3: 81.7, p15: 84.1, p50: 87.1, p85: 90.2, p97: 93.0 },
  { ageMonths: 36, p3: 88.7, p15: 92.4, p50: 96.1, p85: 99.8, p97: 103.5 },
  { ageMonths: 60, p3: 100.7, p15: 105.0, p50: 110.0, p85: 114.8, p97: 119.2 },
  { ageMonths: 120, p3: 125.0, p15: 130.0, p50: 137.0, p85: 144.0, p97: 150.0 },
  { ageMonths: 180, p3: 156.0, p15: 163.0, p50: 170.0, p85: 178.0, p97: 185.0 },
];

const HEIGHT_FEMALE: Checkpoint[] = [
  { ageMonths: 0, p3: 45.4, p15: 47.2, p50: 49.1, p85: 51.0, p97: 52.9 },
  { ageMonths: 6, p3: 61.2, p15: 63.5, p50: 65.7, p85: 68.0, p97: 70.3 },
  { ageMonths: 12, p3: 68.9, p15: 71.4, p50: 74.0, p85: 76.6, p97: 79.2 },
  { ageMonths: 24, p3: 80.0, p15: 83.2, p50: 86.4, p85: 89.6, p97: 92.9 },
  { ageMonths: 36, p3: 87.4, p15: 91.2, p50: 95.1, p85: 98.9, p97: 102.7 },
  { ageMonths: 60, p3: 99.5, p15: 104.0, p50: 109.4, p85: 114.5, p97: 119.0 },
  { ageMonths: 120, p3: 125.0, p15: 131.0, p50: 138.0, p85: 145.0, p97: 152.0 },
  { ageMonths: 180, p3: 148.0, p15: 153.0, p50: 159.0, p85: 166.0, p97: 172.0 },
];

const HEAD_MALE: Checkpoint[] = [
  { ageMonths: 0, p3: 32.1, p15: 33.2, p50: 34.5, p85: 35.7, p97: 36.9 },
  { ageMonths: 6, p3: 40.9, p15: 42.0, p50: 43.3, p85: 44.6, p97: 45.8 },
  { ageMonths: 12, p3: 43.5, p15: 44.6, p50: 46.1, p85: 47.4, p97: 48.6 },
  { ageMonths: 24, p3: 45.5, p15: 46.6, p50: 48.3, p85: 49.7, p97: 51.0 },
  { ageMonths: 36, p3: 46.6, p15: 47.7, p50: 49.5, p85: 51.0, p97: 52.3 },
  { ageMonths: 60, p3: 47.7, p15: 48.8, p50: 50.7, p85: 52.2, p97: 53.5 },
];

const HEAD_FEMALE: Checkpoint[] = [
  { ageMonths: 0, p3: 31.5, p15: 32.6, p50: 33.9, p85: 35.1, p97: 36.2 },
  { ageMonths: 6, p3: 39.7, p15: 40.9, p50: 42.2, p85: 43.5, p97: 44.7 },
  { ageMonths: 12, p3: 42.2, p15: 43.4, p50: 44.9, p85: 46.3, p97: 47.5 },
  { ageMonths: 24, p3: 44.3, p15: 45.5, p50: 47.2, p85: 48.6, p97: 49.8 },
  { ageMonths: 36, p3: 45.4, p15: 46.6, p50: 48.5, p85: 50.0, p97: 51.2 },
  { ageMonths: 60, p3: 46.6, p15: 47.8, p50: 49.7, p85: 51.2, p97: 52.5 },
];

const BMI_MALE: Checkpoint[] = [
  { ageMonths: 24, p3: 14.2, p15: 15.0, p50: 16.2, p85: 17.3, p97: 18.6 },
  { ageMonths: 60, p3: 13.2, p15: 14.0, p50: 15.3, p85: 16.6, p97: 18.3 },
  { ageMonths: 120, p3: 14.0, p15: 15.0, p50: 16.6, p85: 19.0, p97: 22.0 },
  { ageMonths: 180, p3: 16.0, p15: 17.5, p50: 20.0, p85: 23.5, p97: 27.0 },
];

const BMI_FEMALE: Checkpoint[] = [
  { ageMonths: 24, p3: 13.9, p15: 14.7, p50: 15.8, p85: 17.0, p97: 18.3 },
  { ageMonths: 60, p3: 12.9, p15: 13.8, p50: 15.2, p85: 16.8, p97: 18.6 },
  { ageMonths: 120, p3: 13.8, p15: 15.0, p50: 16.8, p85: 19.5, p97: 22.5 },
  { ageMonths: 180, p3: 16.0, p15: 17.8, p50: 20.5, p85: 24.0, p97: 28.0 },
];

const TABLES: Record<GrowthMeasure, Record<GrowthSex, Checkpoint[]>> = {
  weight: { male: WEIGHT_MALE, female: WEIGHT_FEMALE },
  height: { male: HEIGHT_MALE, female: HEIGHT_FEMALE },
  head: { male: HEAD_MALE, female: HEAD_FEMALE },
  bmi: { male: BMI_MALE, female: BMI_FEMALE },
};

export function growthSex(gender: string): GrowthSex | null {
  const value = gender.trim().toLowerCase();
  if (value.startsWith("m")) return "male";
  if (value.startsWith("f")) return "female";
  return null;
}

export function bmiFrom(weightKg: number, heightCm: number): number | null {
  if (!(weightKg > 0) || !(heightCm > 0)) return null;
  const metres = heightCm / 100;
  const bmi = weightKg / (metres * metres);
  if (!Number.isFinite(bmi)) return null;
  return Math.round(bmi * 10) / 10;
}

function lerpRow(younger: Checkpoint, older: Checkpoint, ageMonths: number): Checkpoint {
  const span = older.ageMonths - younger.ageMonths;
  const t = span <= 0 ? 0 : (ageMonths - younger.ageMonths) / span;
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    ageMonths,
    p3: mix(younger.p3, older.p3),
    p15: mix(younger.p15, older.p15),
    p50: mix(younger.p50, older.p50),
    p85: mix(younger.p85, older.p85),
    p97: mix(younger.p97, older.p97),
  };
}

function checkpointAt(table: Checkpoint[], ageMonths: number): Checkpoint | null {
  if (!table.length || ageMonths < table[0].ageMonths || ageMonths > table[table.length - 1].ageMonths) return null;
  let older = table[table.length - 1];
  let younger = table[0];
  for (let i = 1; i < table.length; i += 1) {
    if (ageMonths <= table[i].ageMonths) {
      younger = table[i - 1];
      older = table[i];
      break;
    }
  }
  return lerpRow(younger, older, ageMonths);
}

/** Nearest WHO/IAP checkpoint percentile, or null when the age is outside the table. */
export function growthPercentile(measure: GrowthMeasure, sex: GrowthSex, ageMonths: number, value: number): number | null {
  if (!(value > 0) || !Number.isFinite(ageMonths)) return null;
  const row = checkpointAt(TABLES[measure][sex], ageMonths);
  if (!row) return null;
  const stops = [
    { p: 3, v: row.p3 },
    { p: 15, v: row.p15 },
    { p: 50, v: row.p50 },
    { p: 85, v: row.p85 },
    { p: 97, v: row.p97 },
  ];
  if (value <= stops[0].v) return 3;
  if (value >= stops[stops.length - 1].v) return 97;
  for (let i = 0; i < stops.length - 1; i += 1) {
    const left = stops[i];
    const right = stops[i + 1];
    if (value <= right.v) {
      const span = right.v - left.v;
      const t = span <= 0 ? 0 : (value - left.v) / span;
      return Math.round(left.p + t * (right.p - left.p));
    }
  }
  return 50;
}

export function growthCurve(measure: GrowthMeasure, sex: GrowthSex): Array<{ ageMonths: number; p3: number; p50: number; p97: number }> {
  return TABLES[measure][sex].map((row) => ({ ageMonths: row.ageMonths, p3: row.p3, p50: row.p50, p97: row.p97 }));
}

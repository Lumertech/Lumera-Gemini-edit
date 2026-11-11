import crypto from "node:crypto";
import type { SqlDatabase } from "./sql-engine.ts";
import { approximateDobFromAge, isPaediatricAge, vaccinePlan, type VaccinePlan } from "../src/lib/iapSchedule.ts";
import { bmiFrom, growthPercentile, growthSex, type GrowthMeasure } from "../src/lib/growthPercentiles.ts";

export function ensureCareTables(db: SqlDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS patient_immunizations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      dose_code TEXT NOT NULL,
      given_on TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (tenant_id, patient_id, dose_code)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS growth_measurements (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      recorded_on TEXT NOT NULL,
      height_cm REAL,
      weight_kg REAL,
      head_cm REAL,
      bmi REAL,
      created_at TEXT NOT NULL
    )
  `);
}

type PatientRow = { id: string; name: string; age: number; gender: string; date_of_birth?: string; phone?: string };

export function tenantPatient(db: SqlDatabase, tenantId: string, patientId: string): PatientRow | null {
  const row = db
    .prepare("SELECT id, name, age, gender, date_of_birth, phone FROM patients WHERE id = ? AND tenant_id = ?")
    .get(patientId, tenantId) as PatientRow | undefined;
  return row || null;
}

export function recordImmunization(db: SqlDatabase, tenantId: string, patientId: string, doseCode: string, givenOn: string): void {
  ensureCareTables(db);
  const code = doseCode.trim().toLowerCase();
  if (!code) throw Object.assign(new Error("doseCode is required"), { status: 400 });
  const now = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO patient_immunizations (id, tenant_id, patient_id, dose_code, given_on, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(`imm-${crypto.randomBytes(6).toString("hex")}`, tenantId, patientId, code, givenOn || now.slice(0, 10), now);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/unique|duplicate/i.test(message)) throw err;
  }
}

export function carePlanForPatient(db: SqlDatabase, tenantId: string, patientId: string, now = new Date()): {
  paediatric: boolean;
  followUpDate: string;
  vaccines: VaccinePlan | null;
} {
  ensureCareTables(db);
  const patient = tenantPatient(db, tenantId, patientId);
  if (!patient) throw Object.assign(new Error("Patient not found"), { status: 404 });
  const rx = db
    .prepare(
      `SELECT follow_up_date FROM prescriptions
       WHERE tenant_id = ? AND patient_id = ? AND TRIM(COALESCE(follow_up_date, '')) != ''
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(tenantId, patientId) as { follow_up_date?: string } | undefined;
  const paediatric = isPaediatricAge(Number(patient.age));
  if (!paediatric) return { paediatric: false, followUpDate: String(rx?.follow_up_date || ""), vaccines: null };
  const given = (
    db
      .prepare("SELECT dose_code FROM patient_immunizations WHERE tenant_id = ? AND patient_id = ?")
      .all(tenantId, patientId) as Array<{ dose_code: string }>
  ).map((row) => row.dose_code);
  const dobText = String(patient.date_of_birth || "").trim();
  const parsed = Date.parse(dobText);
  const dob = Number.isFinite(parsed) ? new Date(parsed) : approximateDobFromAge(Number(patient.age), now);
  return {
    paediatric: true,
    followUpDate: String(rx?.follow_up_date || ""),
    vaccines: vaccinePlan({ dob, givenCodes: given, now, approximateDob: !Number.isFinite(parsed) }),
  };
}

export type GrowthPoint = {
  id: string;
  recordedOn: string;
  heightCm: number | null;
  weightKg: number | null;
  headCm: number | null;
  bmi: number | null;
  percentiles: Partial<Record<GrowthMeasure, number | null>>;
};

function ageMonths(patient: PatientRow, recordedOn: string): number {
  const dobText = String(patient.date_of_birth || "").trim();
  const parsed = Date.parse(dobText);
  const dob = Number.isFinite(parsed) ? new Date(parsed) : approximateDobFromAge(Number(patient.age), new Date(recordedOn));
  const at = new Date(recordedOn);
  return Math.max(0, (at.getTime() - dob.getTime()) / (365.25 / 12 * 86_400_000));
}

export function recordGrowth(
  db: SqlDatabase,
  tenantId: string,
  patientId: string,
  input: { recordedOn?: string; heightCm?: number; weightKg?: number; headCm?: number }
): GrowthPoint {
  ensureCareTables(db);
  const patient = tenantPatient(db, tenantId, patientId);
  if (!patient) throw Object.assign(new Error("Patient not found"), { status: 404 });
  const height = Number(input.heightCm);
  const weight = Number(input.weightKg);
  const head = Number(input.headCm);
  const bmi = bmiFrom(weight, height);
  const recordedOn = String(input.recordedOn || new Date().toISOString().slice(0, 10));
  const id = `grw-${crypto.randomBytes(6).toString("hex")}`;
  db.prepare(
    `INSERT INTO growth_measurements (id, tenant_id, patient_id, recorded_on, height_cm, weight_kg, head_cm, bmi, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    tenantId,
    patientId,
    recordedOn,
    Number.isFinite(height) && height > 0 ? height : null,
    Number.isFinite(weight) && weight > 0 ? weight : null,
    Number.isFinite(head) && head > 0 ? head : null,
    bmi,
    new Date().toISOString()
  );
  return growthPoint(patient, {
    id,
    recorded_on: recordedOn,
    height_cm: height,
    weight_kg: weight,
    head_cm: head,
    bmi,
  });
}

function growthPoint(patient: PatientRow, row: Record<string, unknown>): GrowthPoint {
  const sex = growthSex(String(patient.gender || ""));
  const months = ageMonths(patient, String(row.recorded_on || ""));
  const height = Number(row.height_cm) || null;
  const weight = Number(row.weight_kg) || null;
  const head = Number(row.head_cm) || null;
  const bmi = Number(row.bmi) || bmiFrom(Number(row.weight_kg), Number(row.height_cm));
  const percentile = (measure: GrowthMeasure, value: number | null) =>
    sex && value ? growthPercentile(measure, sex, months, value) : null;
  return {
    id: String(row.id || ""),
    recordedOn: String(row.recorded_on || ""),
    heightCm: height,
    weightKg: weight,
    headCm: head,
    bmi,
    percentiles: {
      height: percentile("height", height),
      weight: percentile("weight", weight),
      bmi: percentile("bmi", bmi),
      head: percentile("head", head),
    },
  };
}

export function listGrowth(db: SqlDatabase, tenantId: string, patientId: string): GrowthPoint[] {
  ensureCareTables(db);
  const patient = tenantPatient(db, tenantId, patientId);
  if (!patient) throw Object.assign(new Error("Patient not found"), { status: 404 });
  const rows = db
    .prepare(
      `SELECT id, recorded_on, height_cm, weight_kg, head_cm, bmi
       FROM growth_measurements WHERE tenant_id = ? AND patient_id = ?
       ORDER BY recorded_on ASC`
    )
    .all(tenantId, patientId) as Array<Record<string, unknown>>;
  return rows.map((row) => growthPoint(patient, row));
}

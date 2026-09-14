import type { DatabaseSync } from "node:sqlite";
import { seedClinicalPatientsIfMissing } from "./db-clinical-patients.ts";
import { seedClinicalRxIfMissing } from "./db-clinical-rx.ts";

/** Patients, appointments, prescriptions, and lab demo rows. */
export function seedClinicalRowsIfMissing(database: DatabaseSync, now: string) {
  seedClinicalPatientsIfMissing(database, now);
  seedClinicalRxIfMissing(database, now);
}

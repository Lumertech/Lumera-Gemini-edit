import type { Request, Response } from "express";

/** Clinic staff who may read a patient chart. Super Admin, admin, and patient are denied. */
export const PATIENT_RECORD_ROLES = ["doctor", "receptionist", "polyclinic_admin", "CLINIC_ADMIN"] as const;

export function isPatientRecordRole(role: string | undefined | null): boolean {
  return (PATIENT_RECORD_ROLES as readonly string[]).includes(String(role || ""));
}

export function isReceptionRole(role: string | undefined | null): boolean {
  return String(role || "") === "receptionist";
}

/** Sends 403 and returns false when the session cannot see patient records. */
export function denyUnlessPatientRecordRole(req: Request, res: Response): boolean {
  if (isPatientRecordRole(req.user?.role)) return true;
  res.status(403).json({ error: "Insufficient permissions", code: "ROLE_DENIED" });
  return false;
}

/** Reception may read a redacted chart. It may not open or write a prescription. */
export function denyUnlessPrescriber(req: Request, res: Response): boolean {
  if (!denyUnlessPatientRecordRole(req, res)) return false;
  if (isReceptionRole(req.user?.role)) {
    res.status(403).json({ error: "Insufficient permissions", code: "ROLE_DENIED" });
    return false;
  }
  return true;
}

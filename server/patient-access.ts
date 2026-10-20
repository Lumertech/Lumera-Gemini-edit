import type { Request, Response } from "express";
import { isPrescriberRole } from "../src/lib/prescriberRoles.ts";

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

/** Doctor, polyclinic admin, and clinic admin. Reception, patients, and platform admins are denied. */
export function denyUnlessPrescriber(req: Request, res: Response): boolean {
  if (isPrescriberRole(req.user?.role)) return true;
  res.status(403).json({ error: "Insufficient permissions", code: "ROLE_DENIED" });
  return false;
}

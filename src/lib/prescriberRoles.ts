/** Roles that may sign a prescription. Owner-doctors on a polyclinic are polyclinic_admin, not "doctor". */
export const PRESCRIBER_ROLES = ["doctor", "polyclinic_admin", "CLINIC_ADMIN"] as const;

export function isPrescriberRole(role: string | undefined | null): boolean {
  return (PRESCRIBER_ROLES as readonly string[]).includes(String(role || ""));
}

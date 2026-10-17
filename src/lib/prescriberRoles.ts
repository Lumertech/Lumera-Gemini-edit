/** Roles that may prescribe. Reception, patients, and platform admins are not in this list. */
export const PRESCRIBER_ROLES = ["doctor", "polyclinic_admin", "CLINIC_ADMIN"] as const;

export function isPrescriberRole(role: string | undefined | null): boolean {
  return (PRESCRIBER_ROLES as readonly string[]).includes(String(role || ""));
}

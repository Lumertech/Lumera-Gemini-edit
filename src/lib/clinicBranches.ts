import { isExplicitPolyclinicChoice } from "./practiceOnboarding";

/** Polyclinic clinic admin owns Branches. Super Admin and individual practice do not. */
export function isClinicBranchRole(role?: string | null): boolean {
  return role === "CLINIC_ADMIN" || role === "polyclinic_admin";
}

/**
 * Clinical chrome gate (#111 / #70).
 * Role alone is not enough — individual practice must not grow a Branches tree.
 */
export function canManageClinicBranches(
  user?: { role?: string | null; practiceType?: string | null } | null
): boolean {
  if (!isClinicBranchRole(user?.role)) return false;
  return isExplicitPolyclinicChoice(user?.practiceType);
}

export function withoutClinicBranchView<T extends string>(
  views: readonly T[],
  user?: { role?: string | null; practiceType?: string | null } | null
): T[] {
  if (canManageClinicBranches(user)) return views.slice();
  return views.filter((view) => view !== "branches");
}

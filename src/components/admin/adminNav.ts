import type { AdminTab } from "../../nav/surfaces";

/** Clinic desk — CLINIC_ADMIN / polyclinic_admin / super_admin (except Branches). */
export const DESK_TABS = new Set<AdminTab>(["overview", "users", "people", "branches", "profile", "settings", "audit"]);
/** Platform Superadmin — Tenants + all-tenant Subs. CLINIC_ADMIN must not see these (T-6). */
export const SUPERADMIN_TABS = new Set<AdminTab>(["tenants", "subscriptions"]);
/** Platform / Meta / CMS — super_admin only, listed after Superadmin tabs. */
export const PLATFORM_TABS = new Set<AdminTab>(["dhis", "meta", "site", "policies", "media"]);
/**
 * Multi-clinic Branches — CLINIC_ADMIN / polyclinic_admin only.
 * Founder lock (2026-09-11 via CoS): Super Admin has NO Branches.
 */
export const CLINIC_BRANCH_TABS = new Set<AdminTab>(["branches"]);

/** Role-aware admin nav filter. Super Admin never sees Branches; clinic admins never see Tenants/Subs/platform. */
export function isAdminNavItemVisible(role: string | undefined, tab: AdminTab): boolean {
  const isPlatformAdmin = role === "super_admin";
  if (SUPERADMIN_TABS.has(tab) && !isPlatformAdmin) return false;
  if (PLATFORM_TABS.has(tab) && !isPlatformAdmin) return false;
  if (tab === "tenants" && !isPlatformAdmin) return false;
  if (CLINIC_BRANCH_TABS.has(tab) && isPlatformAdmin) return false;
  if (DESK_TABS.has(tab) || SUPERADMIN_TABS.has(tab) || PLATFORM_TABS.has(tab)) return true;
  return true;
}

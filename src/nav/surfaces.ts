export type Surface = "landing" | "login" | "app" | "admin" | "portal" | "policy" | "legal" | "onboarding";

export const ADMIN_TABS = [
  "overview",
  "users",
  "people",
  "branches",
  "tenants",
  "profile",
  "settings",
  "subscriptions",
  "usage",
  "audit",
  "dhis",
  "meta",
  "site",
  "policies",
  "media",
] as const;

export type AdminTab = (typeof ADMIN_TABS)[number];

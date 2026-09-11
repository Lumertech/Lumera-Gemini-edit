/** Client types + honesty helpers for Superadmin Tenants (#54) against Platform PR #58 APIs. */

export const TENANT_TYPES = ["individual", "polyclinic"] as const;
export type AdminTenantType = (typeof TENANT_TYPES)[number];

export const TENANT_STATUSES = ["active", "trial", "suspended", "deleted"] as const;
export type AdminTenantStatus = (typeof TENANT_STATUSES)[number];

export const SUBSCRIPTION_STATUSES = ["trial", "active", "past_due", "canceled"] as const;
export type AdminSubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const HONEST_BILLING_SOURCES = ["manual", "sandbox", "demo"] as const;
export type HonestBillingSource = (typeof HONEST_BILLING_SOURCES)[number];

export interface AdminPlanCatalogRow {
  code: string;
  displayName: string;
  priceCopy: string;
  monthlyPrice: number;
  description?: string;
}

export interface AdminTenantSubscription {
  id: string;
  tenantId: string;
  planCode: string;
  planDisplayName: string;
  planBadge: string;
  status: AdminSubscriptionStatus | string;
  billingSource: string;
  honestyLabel: string;
  paymentCollected: false | boolean;
  priceCopy: string;
  monthlyPrice: number;
  startedAt: string;
  endsAt: string | null;
  renewsAt: string | null;
  periodStart?: string;
  periodEnd?: string | null;
  notes?: string;
}

export interface AdminTenant {
  id: string;
  name: string;
  type: AdminTenantType | string;
  status: AdminTenantStatus | string;
  plan: {
    code: string;
    displayName: string;
    badge: string;
    status: string;
    billingSource: string;
  };
  owner: {
    name: string;
    email: string;
    phone: string;
  };
  createdAt: string;
  usersCount?: number;
  /** Support-only (#70). Super Admin does not own Branches CRUD. */
  branchesCount?: number;
  subscription?: AdminTenantSubscription;
  phone?: string;
  email?: string;
  deletedAt?: string | null;
}

export function normalizeHonestyLabel(source?: string | null): HonestBillingSource {
  const raw = String(source || "").trim().toLowerCase();
  if (raw === "sandbox") return "sandbox";
  if (raw === "demo") return "demo";
  return "manual";
}

/** Always describe assign as manual/sandbox/demo — never as PSP-paid. */
export function honestyCaption(source?: string | null): string {
  const label = normalizeHonestyLabel(source);
  return `Status is ${label} — not a captured payment (no Razorpay/PSP invoice).`;
}

export function isForbiddenBillingSource(source?: string | null): boolean {
  const raw = String(source || "").trim().toLowerCase();
  return raw === "razorpay" || raw === "paid" || raw === "psp" || raw === "stripe";
}

export function planBadgeLabel(plan?: { badge?: string; displayName?: string; code?: string } | null): string {
  return String(plan?.badge || plan?.displayName || plan?.code || "—");
}

export function typeLabel(type?: string | null): string {
  return type === "polyclinic" ? "Polyclinic" : "Individual";
}

export function formatAdminDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
}

export const TENANT_STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 border-emerald-300",
  trial: "bg-sky-100 text-sky-800 border-sky-300",
  suspended: "bg-amber-100 text-amber-800 border-amber-300",
  deleted: "bg-slate-100 text-slate-600 border-slate-300",
};

export const SUB_STATUS_STYLES: Record<string, string> = {
  trial: "bg-sky-100 text-sky-800 border-sky-300",
  active: "bg-emerald-100 text-emerald-800 border-emerald-300",
  past_due: "bg-amber-100 text-amber-800 border-amber-300",
  canceled: "bg-slate-100 text-slate-700 border-slate-300",
  cancelled: "bg-slate-100 text-slate-700 border-slate-300",
  suspended: "bg-amber-100 text-amber-800 border-amber-300",
  expired: "bg-rose-100 text-rose-800 border-rose-300",
};

export function badgeClass(map: Record<string, string>, key?: string | null): string {
  return map[String(key || "")] || "bg-slate-100 text-slate-700 border-slate-300";
}

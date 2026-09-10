/** Assignable SaaS plan catalog. Codes are SoT — never persist free-text plan names. */

export const PLAN_CODES = ["trial", "starter", "professional", "clinic", "internal"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const SUBSCRIPTION_STATUSES = ["trial", "active", "past_due", "canceled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const TENANT_STATUSES = ["active", "trial", "suspended", "deleted"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const TENANT_TYPES = ["individual", "polyclinic"] as const;
export type TenantType = (typeof TENANT_TYPES)[number];

export const BILLING_SOURCES = ["manual", "sandbox", "demo"] as const;
export type BillingSource = (typeof BILLING_SOURCES)[number];

export interface PlanCatalogRow {
  code: PlanCode;
  displayName: string;
  priceCopy: string;
  monthlyPrice: number;
  description: string;
  sortOrder: number;
}

export const PLAN_CATALOG: PlanCatalogRow[] = [
  {
    code: "trial",
    displayName: "Trial",
    priceCopy: "₹0 · 14-day trial",
    monthlyPrice: 0,
    description: "Unpaid product trial. No PSP charge.",
    sortOrder: 10,
  },
  {
    code: "starter",
    displayName: "Starter",
    priceCopy: "₹999 / month",
    monthlyPrice: 999,
    description: "Catalog price for a single practice. Assign is manual until billing is wired.",
    sortOrder: 20,
  },
  {
    code: "professional",
    displayName: "Professional",
    priceCopy: "₹2,499 / month",
    monthlyPrice: 2499,
    description: "Catalog price for a clinician practice. Assign is manual until billing is wired.",
    sortOrder: 30,
  },
  {
    code: "clinic",
    displayName: "Clinic",
    priceCopy: "₹4,999 / month",
    monthlyPrice: 4999,
    description: "Catalog price for a multi-chair / polyclinic tenant. Assign is manual until billing is wired.",
    sortOrder: 40,
  },
  {
    code: "internal",
    displayName: "Internal",
    priceCopy: "₹0 · platform / demo",
    monthlyPrice: 0,
    description: "Platform operator and sandbox demo tenants. Not a customer invoice.",
    sortOrder: 90,
  },
];

const PLAN_BY_CODE = new Map(PLAN_CATALOG.map((p) => [p.code, p]));

const PLAN_ALIASES: Record<string, PlanCode> = {
  trial: "trial",
  "enterprise trial": "trial",
  enterprisetrial: "trial",
  starter: "starter",
  professional: "professional",
  clinic: "clinic",
  internal: "internal",
  platform: "internal",
};

export function findPlan(code?: string | null): PlanCatalogRow | undefined {
  const key = String(code || "").trim().toLowerCase();
  if (!key) return undefined;
  return PLAN_BY_CODE.get(key as PlanCode);
}

/** Map a catalog code or a known legacy label. Unknown → undefined (caller should 400). */
export function resolvePlanCode(input?: string | null): PlanCode | undefined {
  const raw = String(input || "").trim();
  if (!raw) return undefined;
  const key = raw.toLowerCase();
  if (PLAN_BY_CODE.has(key as PlanCode)) return key as PlanCode;
  return PLAN_ALIASES[key] || PLAN_ALIASES[key.replace(/[_-]+/g, " ")];
}

export function publicPlan(plan: PlanCatalogRow) {
  return {
    code: plan.code,
    displayName: plan.displayName,
    priceCopy: plan.priceCopy,
    monthlyPrice: plan.monthlyPrice,
    description: plan.description,
  };
}

export function normalizeSubscriptionStatus(value?: string | null, fallback: SubscriptionStatus = "trial"): SubscriptionStatus {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "cancelled" || raw === "canceled") return "canceled";
  if (raw === "past_due" || raw === "past-due" || raw === "pastdue") return "past_due";
  if (raw === "active") return "active";
  if (raw === "trial") return "trial";
  if (raw === "expired" || raw === "suspended") return "canceled";
  return fallback;
}

export function normalizeTenantStatus(value?: string | null): TenantStatus | undefined {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "active" || raw === "trial" || raw === "suspended" || raw === "deleted") return raw;
  if (raw === "soft_deleted" || raw === "soft-deleted" || raw === "archived") return "deleted";
  return undefined;
}

export function normalizeBillingSource(value?: string | null, fallback: BillingSource = "manual"): BillingSource | { error: string } {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return fallback;
  if ((BILLING_SOURCES as readonly string[]).includes(raw)) return raw as BillingSource;
  if (raw === "razorpay" || raw === "paid" || raw === "psp" || raw === "stripe") {
    return {
      error:
        "Cannot mark a tenant subscription as PSP-charged. Day-one assigns are manual/sandbox/demo only — no Razorpay paid invoice is recorded here.",
    };
  }
  return { error: `Unknown billingSource "${value}". Use manual, sandbox, or demo.` };
}

export function defaultBillingSourceForTenant(tenantId: string): BillingSource {
  if (tenantId === "tenant-lumera-main" || tenantId === "tenant-rehab-mumbai" || tenantId === "tenant-suspended-demo") {
    return "demo";
  }
  return "manual";
}

export const SUSPENDED_DEMO_TENANT_ID = "tenant-suspended-demo";
export const SUSPENDED_DEMO_EMAIL = "suspended.clinic@lumera.me";
export const SUSPENDED_DEMO_USER_ID = "user-suspended-clinic";

import type { SqlDatabase } from "./sql-engine.ts";
import { DEMO_TENANT_ID, getDb, normalizePracticeType } from "./db.ts";
import {
  PLAN_CATALOG,
  SUSPENDED_DEMO_EMAIL,
  SUSPENDED_DEMO_TENANT_ID,
  SUSPENDED_DEMO_USER_ID,
  defaultBillingSourceForTenant,
  findPlan,
  normalizeBillingSource,
  normalizeSubscriptionStatus,
  normalizeTenantStatus,
  publicPlan,
  resolvePlanCode,
  type BillingSource,
  type PlanCatalogRow,
  type SubscriptionStatus,
  type TenantStatus,
  type TenantType,
} from "./plan-catalog.ts";
import { hashPassword } from "./password.ts";

export {
  PLAN_CATALOG,
  SUSPENDED_DEMO_EMAIL,
  SUSPENDED_DEMO_TENANT_ID,
  SUSPENDED_DEMO_USER_ID,
  findPlan,
  normalizeBillingSource,
  normalizeSubscriptionStatus,
  normalizeTenantStatus,
  publicPlan,
  resolvePlanCode,
};
export type { BillingSource, PlanCatalogRow, SubscriptionStatus, TenantStatus, TenantType };

export const TENANT_SUSPENDED_ERROR =
  "This clinic has been suspended. Contact Lumera support if you need access restored.";
export const TENANT_DELETED_ERROR =
  "This clinic is no longer active. Contact Lumera support if you need access restored.";

export interface TenantRow {
  id: string;
  name: string;
  specialty?: string;
  country?: string;
  timezone?: string;
  phone?: string;
  email?: string;
  trial_ends_at?: string;
  active_status?: number;
  hfr_id?: string;
  practice_type?: string;
  lifecycle_status?: string;
  owner_name?: string;
  owner_email?: string;
  owner_phone?: string;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantSubscriptionRow {
  id: string;
  tenant_id: string;
  plan_code: string;
  status: string;
  billing_source: string;
  started_at: string;
  ends_at: string | null;
  renews_at: string | null;
  monthly_price: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface PublicTenantSubscription {
  id: string;
  tenantId: string;
  planCode: string;
  planDisplayName: string;
  planBadge: string;
  status: SubscriptionStatus;
  billingSource: BillingSource;
  honestyLabel: BillingSource;
  paymentCollected: false;
  priceCopy: string;
  monthlyPrice: number;
  startedAt: string;
  endsAt: string | null;
  renewsAt: string | null;
  periodStart: string;
  periodEnd: string | null;
  notes: string;
}

export interface PublicTenant {
  id: string;
  name: string;
  type: TenantType;
  status: TenantStatus;
  plan: {
    code: string;
    displayName: string;
    badge: string;
    status: SubscriptionStatus;
    billingSource: BillingSource;
  };
  owner: {
    name: string;
    email: string;
    phone: string;
  };
  createdAt: string;
  usersCount?: number;
  /** Support-only (#70). Super Admin does not own Branches CRUD. Individual is always 0. */
  branchesCount?: number;
  subscription?: PublicTenantSubscription;
  phone?: string;
  email?: string;
  deletedAt?: string | null;
}

function addDays(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function ensurePlatformTenantSchema(database: SqlDatabase) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      code TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      price_copy TEXT NOT NULL DEFAULT '',
      monthly_price INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tenant_subscriptions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL UNIQUE,
      plan_code TEXT NOT NULL,
      status TEXT NOT NULL,
      billing_source TEXT NOT NULL DEFAULT 'manual',
      started_at TEXT NOT NULL,
      ends_at TEXT,
      renews_at TEXT,
      monthly_price INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const tenantCols: [string, string][] = [
    ["practice_type", "TEXT DEFAULT 'individual'"],
    ["lifecycle_status", "TEXT DEFAULT ''"],
    ["owner_name", "TEXT DEFAULT ''"],
    ["owner_email", "TEXT DEFAULT ''"],
    ["owner_phone", "TEXT DEFAULT ''"],
    ["deleted_at", "TEXT"],
  ];
  for (const [col, ddl] of tenantCols) {
    try {
      database.exec(`ALTER TABLE tenants ADD COLUMN ${col} ${ddl}`);
    } catch {
      /* already present */
    }
  }

  const subCols: [string, string][] = [
    ["tenant_id", "TEXT DEFAULT ''"],
    ["plan_code", "TEXT DEFAULT ''"],
    ["billing_source", "TEXT DEFAULT 'manual'"],
  ];
  for (const [col, ddl] of subCols) {
    try {
      database.exec(`ALTER TABLE subscriptions ADD COLUMN ${col} ${ddl}`);
    } catch {
      /* already present */
    }
  }
}

export function seedPlanCatalog(database: SqlDatabase) {
  const upsert = database.prepare(`
    INSERT INTO plans (code, display_name, price_copy, monthly_price, description, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      display_name = excluded.display_name,
      price_copy = excluded.price_copy,
      monthly_price = excluded.monthly_price,
      description = excluded.description,
      sort_order = excluded.sort_order
  `);
  for (const plan of PLAN_CATALOG) {
    upsert.run(plan.code, plan.displayName, plan.priceCopy, plan.monthlyPrice, plan.description, plan.sortOrder);
  }
}

export function storedTenantStatus(row: TenantRow): TenantStatus {
  if (row.deleted_at) return "deleted";
  const explicit = normalizeTenantStatus(row.lifecycle_status);
  if (explicit) return explicit;
  if (Number(row.active_status) === 0) return "suspended";
  if (row.trial_ends_at && new Date(row.trial_ends_at).getTime() > Date.now()) return "trial";
  return "active";
}

export function tenantAccessBlockedReason(tenantId?: string | null): string | null {
  const id = String(tenantId || "").trim();
  if (!id) return null;
  try {
    const row = getDb()
      .prepare("SELECT active_status, lifecycle_status, deleted_at, trial_ends_at FROM tenants WHERE id = ?")
      .get(id) as unknown as TenantRow | undefined;
    if (!row) return null;
    const status = storedTenantStatus(row);
    if (status === "deleted") return TENANT_DELETED_ERROR;
    if (status === "suspended" || Number(row.active_status) === 0) return TENANT_SUSPENDED_ERROR;
    return null;
  } catch {
    return null;
  }
}

export function clinicTenantAccessError(user?: { role?: string; tenant_id?: string; tenantId?: string } | null): string | null {
  if (!user) return null;
  const role = String(user.role || "");
  if (role === "super_admin" || role === "admin") return null;
  return tenantAccessBlockedReason(user.tenant_id || user.tenantId || "");
}

export function pickOwnerFromUsers(database: SqlDatabase, tenantId: string): { name: string; email: string; phone: string } {
  const row = database
    .prepare(
      `SELECT name, email, phone, role FROM users
       WHERE tenant_id = ?
       ORDER BY CASE role
         WHEN 'CLINIC_ADMIN' THEN 0
         WHEN 'polyclinic_admin' THEN 1
         WHEN 'doctor' THEN 2
         WHEN 'receptionist' THEN 3
         ELSE 9
       END, created_at ASC
       LIMIT 1`
    )
    .get(tenantId) as { name: string; email: string; phone: string } | undefined;
  return {
    name: row?.name || "",
    email: row?.email || "",
    phone: row?.phone || "",
  };
}

function derivePlanFromLegacy(planType: string, role?: string): PlanCatalogRow {
  const mapped = resolvePlanCode(planType);
  if (mapped) return findPlan(mapped)!;
  if (role === "super_admin") return findPlan("internal")!;
  if (role === "polyclinic_admin" || role === "CLINIC_ADMIN") return findPlan("clinic")!;
  if (role === "doctor") return findPlan("professional")!;
  if (role === "receptionist") return findPlan("starter")!;
  return findPlan("trial")!;
}

export function upsertTenantSubscription(
  database: SqlDatabase,
  tenantId: string,
  input: {
    planCode: string;
    status?: string;
    billingSource?: string;
    startedAt?: string;
    endsAt?: string | null;
    renewsAt?: string | null;
    notes?: string;
  }
): TenantSubscriptionRow {
  const plan = findPlan(input.planCode);
  if (!plan) {
    throw new Error(`Unknown plan code: ${input.planCode}`);
  }
  const now = new Date().toISOString();
  const status = normalizeSubscriptionStatus(input.status, plan.code === "trial" ? "trial" : "active");
  const source = normalizeBillingSource(input.billingSource, defaultBillingSourceForTenant(tenantId));
  if (typeof source === "object") {
    throw new Error(source.error);
  }
  const existing = database
    .prepare("SELECT * FROM tenant_subscriptions WHERE tenant_id = ?")
    .get(tenantId) as unknown as TenantSubscriptionRow | undefined;
  const startedAt = input.startedAt || existing?.started_at || now;
  const endsAt = input.endsAt !== undefined ? input.endsAt : existing?.ends_at || addDays(now, plan.code === "trial" ? 14 : 365);
  const renewsAt = input.renewsAt !== undefined ? input.renewsAt : existing?.renews_at || endsAt;
  const notes = input.notes !== undefined ? String(input.notes) : existing?.notes || "";
  const id = existing?.id || `tsub-${tenantId}`.slice(0, 40);

  if (existing) {
    database
      .prepare(
        `UPDATE tenant_subscriptions
         SET plan_code = ?, status = ?, billing_source = ?, started_at = ?, ends_at = ?, renews_at = ?, monthly_price = ?, notes = ?, updated_at = ?
         WHERE tenant_id = ?`
      )
      .run(plan.code, status, source, startedAt, endsAt, renewsAt, plan.monthlyPrice, notes, now, tenantId);
  } else {
    database
      .prepare(
        `INSERT INTO tenant_subscriptions
         (id, tenant_id, plan_code, status, billing_source, started_at, ends_at, renews_at, monthly_price, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, tenantId, plan.code, status, source, startedAt, endsAt, renewsAt, plan.monthlyPrice, notes, now, now);
  }

  syncLegacyUserSubscriptions(database, tenantId, {
    planCode: plan.code,
    status,
    billingSource: source,
    startedAt,
    endsAt,
    monthlyPrice: plan.monthlyPrice,
    notes,
  });

  return database.prepare("SELECT * FROM tenant_subscriptions WHERE tenant_id = ?").get(tenantId) as unknown as TenantSubscriptionRow;
}

function syncLegacyUserSubscriptions(
  database: SqlDatabase,
  tenantId: string,
  sub: {
    planCode: string;
    status: string;
    billingSource: string;
    startedAt: string;
    endsAt: string | null;
    monthlyPrice: number;
    notes: string;
  }
) {
  const users = database.prepare("SELECT id FROM users WHERE tenant_id = ?").all(tenantId) as { id: string }[];
  if (users.length === 0) return;
  const now = new Date().toISOString();
  const update = database.prepare(
    `UPDATE subscriptions
     SET status = ?, plan_type = ?, plan_code = ?, monthly_price = ?, started_at = ?, ends_at = ?, notes = ?, tenant_id = ?, billing_source = ?
     WHERE user_id = ?`
  );
  const insert = database.prepare(
    `INSERT OR IGNORE INTO subscriptions (id, user_id, status, plan_type, monthly_price, auto_renew, started_at, ends_at, notes, tenant_id, plan_code, billing_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const u of users) {
    const result = update.run(
      sub.status,
      sub.planCode,
      sub.planCode,
      sub.monthlyPrice,
      sub.startedAt,
      sub.endsAt,
      sub.notes,
      tenantId,
      sub.billingSource,
      u.id
    );
    if (result.changes === 0) {
      insert.run(
        `sub-${u.id}`,
        u.id,
        sub.status,
        sub.planCode,
        sub.monthlyPrice,
        sub.monthlyPrice > 0 ? 1 : 0,
        sub.startedAt,
        sub.endsAt,
        sub.notes,
        tenantId,
        sub.planCode,
        sub.billingSource
      );
    }
  }
  void now;
}

export function ensureTenantSubscription(
  database: SqlDatabase,
  tenantId: string,
  defaults?: { planCode?: string; status?: string; billingSource?: string }
): TenantSubscriptionRow {
  const existing = database
    .prepare("SELECT * FROM tenant_subscriptions WHERE tenant_id = ?")
    .get(tenantId) as unknown as TenantSubscriptionRow | undefined;
  if (existing) return existing;

  const legacy = database
    .prepare(
      `SELECT s.status, s.plan_type, s.monthly_price, s.started_at, s.ends_at, s.notes, u.role
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       WHERE u.tenant_id = ?
       ORDER BY CASE u.role
         WHEN 'CLINIC_ADMIN' THEN 0
         WHEN 'polyclinic_admin' THEN 1
         WHEN 'doctor' THEN 2
         WHEN 'super_admin' THEN 8
         ELSE 9
       END, s.started_at ASC
       LIMIT 1`
    )
    .get(tenantId) as
    | { status: string; plan_type: string; monthly_price: number; started_at: string; ends_at: string | null; notes: string; role: string }
    | undefined;

  const plan = defaults?.planCode
    ? findPlan(defaults.planCode) || derivePlanFromLegacy(defaults.planCode)
    : legacy
      ? derivePlanFromLegacy(legacy.plan_type, legacy.role)
      : tenantId === DEMO_TENANT_ID
        ? findPlan("clinic")!
        : findPlan("trial")!;

  return upsertTenantSubscription(database, tenantId, {
    planCode: plan.code,
    status: defaults?.status || legacy?.status || (plan.code === "trial" ? "trial" : "active"),
    billingSource: defaults?.billingSource || defaultBillingSourceForTenant(tenantId),
    startedAt: legacy?.started_at,
    endsAt: legacy?.ends_at,
    notes: legacy?.notes,
  });
}

export function backfillTenantSubscriptions(database: SqlDatabase) {
  const tenants = database.prepare("SELECT id, email, phone, name FROM tenants").all() as unknown as TenantRow[];
  const updateOwner = database.prepare(
    `UPDATE tenants SET owner_name = ?, owner_email = ?, owner_phone = ?, practice_type = COALESCE(NULLIF(practice_type, ''), ?)
     WHERE id = ? AND (owner_email IS NULL OR owner_email = '')`
  );
  for (const t of tenants) {
    const owner = pickOwnerFromUsers(database, t.id);
    const practiceGuess = database
      .prepare(
        `SELECT practice_type FROM users WHERE tenant_id = ? AND practice_type IS NOT NULL AND TRIM(practice_type) != '' LIMIT 1`
      )
      .get(t.id) as { practice_type?: string } | undefined;
    updateOwner.run(
      owner.name,
      owner.email || t.email || "",
      owner.phone || t.phone || "",
      normalizePracticeType(practiceGuess?.practice_type),
      t.id
    );
    try {
      ensureTenantSubscription(database, t.id);
    } catch {
      /* catalog / table race on first migrate */
    }
  }

  try {
    database.exec(`
      UPDATE subscriptions
      SET tenant_id = COALESCE(NULLIF(tenant_id, ''), (SELECT tenant_id FROM users WHERE users.id = subscriptions.user_id))
      WHERE tenant_id IS NULL OR tenant_id = ''
    `);
    database.exec(`
      UPDATE subscriptions
      SET plan_code = CASE
        WHEN lower(plan_type) IN ('trial', 'starter', 'professional', 'clinic', 'internal') THEN lower(plan_type)
        WHEN lower(plan_type) LIKE '%trial%' THEN 'trial'
        ELSE plan_code
      END
      WHERE plan_code IS NULL OR plan_code = ''
    `);
    database.exec(`
      UPDATE subscriptions
      SET billing_source = COALESCE(NULLIF(billing_source, ''), 'manual')
      WHERE billing_source IS NULL OR billing_source = ''
    `);
  } catch {
    /* columns added in the same pass */
  }
}

export function seedSuspendedDemoTenant(database: SqlDatabase) {
  const now = new Date().toISOString();
  const trialEnds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const existing = database.prepare("SELECT id FROM tenants WHERE id = ?").get(SUSPENDED_DEMO_TENANT_ID) as
    | { id: string }
    | undefined;
  if (!existing) {
    database
      .prepare(
        `INSERT INTO tenants (
           id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used,
           active_status, hfr_id, created_at, updated_at, practice_type, lifecycle_status, owner_name, owner_email, owner_phone, email
         ) VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+91 98000 00054', ?, 500, 0, 0, '', ?, ?, 'individual', 'suspended', ?, ?, '+91 98000 00054', ?)`
      )
      .run(
        SUSPENDED_DEMO_TENANT_ID,
        "Suspended Demo Clinic",
        trialEnds,
        now,
        now,
        "Suspended Clinic Admin",
        SUSPENDED_DEMO_EMAIL,
        SUSPENDED_DEMO_EMAIL
      );
  } else {
    database
      .prepare(
        `UPDATE tenants
         SET lifecycle_status = 'suspended', active_status = 0, owner_email = COALESCE(NULLIF(owner_email, ''), ?),
             owner_name = COALESCE(NULLIF(owner_name, ''), 'Suspended Clinic Admin')
         WHERE id = ?`
      )
      .run(SUSPENDED_DEMO_EMAIL, SUSPENDED_DEMO_TENANT_ID);
  }

  const user = database.prepare("SELECT id FROM users WHERE email = ? OR id = ?").get(SUSPENDED_DEMO_EMAIL, SUSPENDED_DEMO_USER_ID) as
    | { id: string }
    | undefined;
  if (!user) {
    database
      .prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, pack_id, last_login, created_at)
         VALUES (?, ?, ?, ?, 'Suspended Clinic Admin', 'CLINIC_ADMIN', 'active', '+91 98000 00054', 'Suspended Demo Clinic', 1, 'individual', 'gp', 'gp', NULL, ?)`
      )
      .run(SUSPENDED_DEMO_USER_ID, SUSPENDED_DEMO_TENANT_ID, SUSPENDED_DEMO_EMAIL, hashPassword("Lumera@2026"), now);
  } else {
    database
      .prepare("UPDATE users SET tenant_id = ? WHERE id = ? AND (tenant_id IS NULL OR tenant_id = '')")
      .run(SUSPENDED_DEMO_TENANT_ID, user.id);
  }

  upsertTenantSubscription(database, SUSPENDED_DEMO_TENANT_ID, {
    planCode: "starter",
    status: "canceled",
    billingSource: "demo",
    notes: "QA fixture for #54 — suspended tenant. Clinic users cannot sign in.",
  });
}

export function seedPlatformTenantData(database: SqlDatabase) {
  seedPlanCatalog(database);
  backfillTenantSubscriptions(database);
  const demoSub = database
    .prepare("SELECT plan_code FROM tenant_subscriptions WHERE tenant_id = ?")
    .get(DEMO_TENANT_ID) as unknown as { plan_code?: string } | undefined;
  if (demoSub?.plan_code === "internal" || !demoSub) {
    upsertTenantSubscription(database, DEMO_TENANT_ID, {
      planCode: "clinic",
      status: "active",
      billingSource: "demo",
      notes: "Demo polyclinic tenant — catalog Clinic plan, not a PSP charge.",
    });
  }
  seedSuspendedDemoTenant(database);
}

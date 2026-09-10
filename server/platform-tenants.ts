import type { DatabaseSync } from "node:sqlite";
import { DEMO_TENANT_ID, getDb, normalizePracticeType, writeAudit } from "./db.ts";
import {
  BILLING_SOURCES,
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

interface TenantRow {
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

interface TenantSubscriptionRow {
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

export function ensurePlatformTenantSchema(database: DatabaseSync) {
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

  const tenantCols: Array<[string, string]> = [
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

  const subCols: Array<[string, string]> = [
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

export function seedPlanCatalog(database: DatabaseSync) {
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

function storedTenantStatus(row: Pick<TenantRow, "lifecycle_status" | "active_status" | "deleted_at" | "trial_ends_at">): TenantStatus {
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

function pickOwnerFromUsers(database: DatabaseSync, tenantId: string): { name: string; email: string; phone: string } {
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
  database: DatabaseSync,
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
  database: DatabaseSync,
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
  database: DatabaseSync,
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
         WHEN 'super_admin' THEN 0
         WHEN 'CLINIC_ADMIN' THEN 1
         WHEN 'polyclinic_admin' THEN 2
         WHEN 'doctor' THEN 3
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

export function backfillTenantSubscriptions(database: DatabaseSync) {
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

export function seedSuspendedDemoTenant(database: DatabaseSync) {
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

export function seedPlatformTenantData(database: DatabaseSync) {
  seedPlanCatalog(database);
  backfillTenantSubscriptions(database);
  seedSuspendedDemoTenant(database);
}

function loadTenant(database: DatabaseSync, id: string): TenantRow | undefined {
  return database.prepare("SELECT * FROM tenants WHERE id = ?").get(id) as unknown as TenantRow | undefined;
}

function usersCount(database: DatabaseSync, tenantId: string): number {
  return (database.prepare("SELECT COUNT(*) AS c FROM users WHERE tenant_id = ?").get(tenantId) as { c: number }).c;
}

export function mapPublicSubscription(row: TenantSubscriptionRow): PublicTenantSubscription {
  const plan = findPlan(row.plan_code) || findPlan("trial")!;
  const billingSource = (BILLING_SOURCES as readonly string[]).includes(row.billing_source)
    ? (row.billing_source as BillingSource)
    : "manual";
  const status = normalizeSubscriptionStatus(row.status);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    planCode: plan.code,
    planDisplayName: plan.displayName,
    planBadge: plan.displayName,
    status,
    billingSource,
    honestyLabel: billingSource,
    paymentCollected: false,
    priceCopy: plan.priceCopy,
    monthlyPrice: Number(row.monthly_price || plan.monthlyPrice),
    startedAt: row.started_at,
    endsAt: row.ends_at,
    renewsAt: row.renews_at,
    periodStart: row.started_at,
    periodEnd: row.ends_at,
    notes: row.notes || "",
  };
}

function mapPublicTenant(database: DatabaseSync, row: TenantRow, opts?: { detail?: boolean }): PublicTenant {
  const subscription = mapPublicSubscription(ensureTenantSubscription(database, row.id));
  const ownerFallback = pickOwnerFromUsers(database, row.id);
  const status = storedTenantStatus(row);
  const type = normalizePracticeType(row.practice_type) as TenantType;
  const tenant: PublicTenant = {
    id: row.id,
    name: row.name,
    type,
    status,
    plan: {
      code: subscription.planCode,
      displayName: subscription.planDisplayName,
      badge: subscription.planBadge,
      status: subscription.status,
      billingSource: subscription.billingSource,
    },
    owner: {
      name: row.owner_name || ownerFallback.name,
      email: row.owner_email || ownerFallback.email || row.email || "",
      phone: row.owner_phone || ownerFallback.phone || row.phone || "",
    },
    createdAt: row.created_at,
    phone: row.phone || "",
    email: row.email || "",
    deletedAt: row.deleted_at || null,
  };
  if (opts?.detail) {
    tenant.usersCount = usersCount(database, row.id);
    tenant.subscription = subscription;
  } else {
    tenant.usersCount = usersCount(database, row.id);
  }
  return tenant;
}

export function listPublicPlans() {
  return PLAN_CATALOG.slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(publicPlan);
}

export function listAdminTenants(query?: { q?: string; status?: string; type?: string; includeDeleted?: boolean }): PublicTenant[] {
  const database = getDb();
  const q = String(query?.q || "").trim().toLowerCase();
  const statusFilter = normalizeTenantStatus(query?.status);
  const typeFilter = query?.type ? normalizePracticeType(query.type) : "";
  const rows = database.prepare("SELECT * FROM tenants ORDER BY created_at DESC").all() as unknown as TenantRow[];
  const out: PublicTenant[] = [];
  for (const row of rows) {
    const mapped = mapPublicTenant(database, row);
    if (query?.includeDeleted === false && mapped.status === "deleted") continue;
    if (statusFilter && mapped.status !== statusFilter) continue;
    if (typeFilter && mapped.type !== typeFilter) continue;
    if (q) {
      const hay = [mapped.name, mapped.owner.name, mapped.owner.email, mapped.email, mapped.id]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(mapped);
  }
  return out;
}

export function getAdminTenant(id: string): PublicTenant | undefined {
  const database = getDb();
  const row = loadTenant(database, id);
  if (!row) return undefined;
  return mapPublicTenant(database, row, { detail: true });
}

export function getAdminTenantSubscription(id: string): PublicTenantSubscription | undefined {
  const tenant = getAdminTenant(id);
  return tenant?.subscription;
}

function ownerFromBody(body: Record<string, unknown> | undefined) {
  const owner = (body?.owner && typeof body.owner === "object" ? body.owner : {}) as Record<string, unknown>;
  return {
    name: String(body?.ownerName ?? body?.owner_name ?? owner.name ?? "").trim(),
    email: String(body?.ownerEmail ?? body?.owner_email ?? owner.email ?? "").trim().toLowerCase(),
    phone: String(body?.ownerPhone ?? body?.owner_phone ?? owner.phone ?? "").trim(),
  };
}

export function createAdminTenant(
  body: Record<string, unknown>,
  actor: { id?: string; name?: string }
): PublicTenant {
  const name = String(body.name || body.practiceName || "").trim();
  if (!name) {
    throw Object.assign(new Error("name is required"), { status: 400 });
  }
  const type = normalizePracticeType(String(body.type ?? body.practiceType ?? body.practice_type ?? "")) as TenantType;
  const owner = ownerFromBody(body);
  const planCode = resolvePlanCode(String(body.planCode ?? body.plan_code ?? "trial"));
  if (body.planCode || body.plan_code) {
    if (!planCode) {
      throw Object.assign(new Error(`Unknown plan code. Assign from the catalog: ${PLAN_CATALOG.map((p) => p.code).join(", ")}.`), {
        status: 400,
      });
    }
  }
  const now = new Date().toISOString();
  const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const tenantId = `tenant-${crypto.randomUUID().slice(0, 8)}`;
  const hfrId = `IN-HFR-${Math.floor(10000000 + Math.random() * 90000000)}`;
  const phone = String(body.phone || owner.phone || "");
  const email = String(body.email || owner.email || "");
  const specialty = String(body.specialty || "gp");
  const database = getDb();
  database
    .prepare(
      `INSERT INTO tenants (
         id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used,
         active_status, hfr_id, created_at, updated_at, practice_type, lifecycle_status, owner_name, owner_email, owner_phone, email
       ) VALUES (?, ?, ?, 'India', 'IST (UTC+5:30)', ?, ?, 500, 0, 1, ?, ?, ?, ?, 'trial', ?, ?, ?, ?)`
    )
    .run(tenantId, name, specialty, phone, trialEndsAt, hfrId, now, now, type, owner.name, owner.email, owner.phone, email);

  upsertTenantSubscription(database, tenantId, {
    planCode: planCode || "trial",
    status: "trial",
    billingSource: "manual",
    notes: "Created by platform admin (manual / no PSP).",
  });

  writeAudit(database, actor.id || null, actor.name || "Platform admin", "Tenant created", `${name} (${tenantId}) type=${type}`);
  return getAdminTenant(tenantId)!;
}

export function patchAdminTenant(
  id: string,
  body: Record<string, unknown>,
  actor: { id?: string; name?: string }
): PublicTenant {
  const database = getDb();
  const existing = loadTenant(database, id);
  if (!existing) {
    throw Object.assign(new Error("Tenant not found"), { status: 404 });
  }

  const name = body.name != null ? String(body.name).trim() : existing.name;
  if (!name) {
    throw Object.assign(new Error("name is required"), { status: 400 });
  }
  const type =
    body.type != null || body.practiceType != null || body.practice_type != null
      ? (normalizePracticeType(String(body.type ?? body.practiceType ?? body.practice_type ?? "")) as TenantType)
      : (normalizePracticeType(existing.practice_type) as TenantType);

  const ownerPatch = ownerFromBody(body);
  const ownerName = ownerPatch.name || existing.owner_name || "";
  const ownerEmail = ownerPatch.email || existing.owner_email || "";
  const ownerPhone = ownerPatch.phone || existing.owner_phone || "";
  const email = body.email != null ? String(body.email).trim() : existing.email || ownerEmail;
  const phone = body.phone != null ? String(body.phone).trim() : existing.phone || ownerPhone;

  let status = storedTenantStatus(existing);
  const wantsDelete = body.deleted === true || body.softDelete === true || body.soft_delete === true;
  const wantsReinstate = body.reinstate === true || body.deleted === false;
  if (body.status != null) {
    const next = normalizeTenantStatus(String(body.status));
    if (!next) {
      throw Object.assign(new Error("status must be active, trial, suspended, or deleted"), { status: 400 });
    }
    status = next;
  } else if (wantsDelete) {
    status = "deleted";
  } else if (wantsReinstate) {
    status = status === "deleted" || status === "suspended" ? "active" : status;
  }

  const now = new Date().toISOString();
  const deletedAt = status === "deleted" ? existing.deleted_at || now : null;
  const activeStatus = status === "suspended" || status === "deleted" ? 0 : 1;

  database
    .prepare(
      `UPDATE tenants
       SET name = ?, practice_type = ?, lifecycle_status = ?, owner_name = ?, owner_email = ?, owner_phone = ?,
           email = ?, phone = ?, active_status = ?, deleted_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(name, type, status, ownerName, ownerEmail, ownerPhone, email, phone, activeStatus, deletedAt, now, id);

  writeAudit(
    database,
    actor.id || null,
    actor.name || "Platform admin",
    status === "suspended"
      ? "Tenant suspended"
      : status === "deleted"
        ? "Tenant soft-deleted"
        : existing.lifecycle_status === "suspended" || existing.lifecycle_status === "deleted"
          ? "Tenant reinstated"
          : "Tenant updated",
    `${name} (${id}) status=${status} type=${type}`
  );

  return getAdminTenant(id)!;
}

export function patchAdminTenantSubscription(
  tenantId: string,
  body: Record<string, unknown>,
  actor: { id?: string; name?: string }
): PublicTenantSubscription {
  const database = getDb();
  const tenant = loadTenant(database, tenantId);
  if (!tenant) {
    throw Object.assign(new Error("Tenant not found"), { status: 404 });
  }

  const requestedPlan = body.planCode ?? body.plan_code ?? body.planType ?? body.plan_type;
  if (requestedPlan == null || String(requestedPlan).trim() === "") {
    throw Object.assign(new Error("planCode is required and must match the plan catalog."), { status: 400 });
  }
  const planCode = resolvePlanCode(String(requestedPlan));
  if (!planCode) {
    throw Object.assign(
      new Error(`Unknown plan code "${requestedPlan}". Assign from the catalog: ${PLAN_CATALOG.map((p) => p.code).join(", ")}.`),
      { status: 400 }
    );
  }

  if (body.status != null) {
    const raw = String(body.status).trim().toLowerCase();
    const ok =
      raw === "trial" ||
      raw === "active" ||
      raw === "past_due" ||
      raw === "canceled" ||
      raw === "cancelled";
    if (!ok) {
      throw Object.assign(new Error("status must be trial, active, past_due, or canceled"), { status: 400 });
    }
  }

  const billing = normalizeBillingSource(
    body.billingSource != null || body.billing_source != null
      ? String(body.billingSource ?? body.billing_source)
      : undefined,
    "manual"
  );
  if (typeof billing === "object") {
    throw Object.assign(new Error(billing.error), { status: 400 });
  }

  const endsAt = body.endsAt ?? body.ends_at ?? body.periodEnd ?? body.period_end;
  const renewsAt = body.renewsAt ?? body.renews_at ?? body.renewalAt ?? body.renewal_at;
  const startedAt = body.startedAt ?? body.started_at ?? body.periodStart ?? body.period_start;

  const row = upsertTenantSubscription(database, tenantId, {
    planCode,
    status: body.status != null ? String(body.status) : undefined,
    billingSource: billing,
    startedAt: startedAt != null ? String(startedAt) : undefined,
    endsAt: endsAt != null ? String(endsAt) : undefined,
    renewsAt: renewsAt != null ? String(renewsAt) : undefined,
    notes: body.notes != null ? String(body.notes) : undefined,
  });

  writeAudit(
    database,
    actor.id || null,
    actor.name || "Platform admin",
    "Tenant subscription updated",
    `${tenantId} plan=${planCode} status=${row.status} billingSource=${billing}`
  );

  return mapPublicSubscription(row);
}

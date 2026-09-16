import type { SqlDatabase } from "./sql-engine.ts";
import { getDb, normalizePracticeType, writeAudit } from "./db.ts";
import {
  BILLING_SOURCES,
  PLAN_CATALOG,
  findPlan,
  normalizeBillingSource,
  normalizeSubscriptionStatus,
  normalizeTenantStatus,
  publicPlan,
  resolvePlanCode,
  type BillingSource,
  type TenantType,
} from "./plan-catalog.ts";
import {
  ensureTenantSubscription,
  pickOwnerFromUsers,
  storedTenantStatus,
  upsertTenantSubscription,
  type PublicTenant,
  type PublicTenantSubscription,
  type TenantRow,
  type TenantSubscriptionRow,
} from "./platform-tenants-schema.ts";

function loadTenant(database: SqlDatabase, id: string): TenantRow | undefined {
  return database.prepare("SELECT * FROM tenants WHERE id = ?").get(id) as unknown as TenantRow | undefined;
}

function usersCount(database: SqlDatabase, tenantId: string): number {
  return (database.prepare("SELECT COUNT(*) AS c FROM users WHERE tenant_id = ?").get(tenantId) as { c: number }).c;
}

/** Support-only. Individual has no Branches; polyclinic count is global until branches are tenant-scoped. */
function branchesCount(database: SqlDatabase, type: TenantType): number {
  if (type !== "polyclinic") return 0;
  try {
    return (database.prepare("SELECT COUNT(*) AS c FROM branches").get() as { c: number }).c;
  } catch {
    return 0;
  }
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

function mapPublicTenant(database: SqlDatabase, row: TenantRow, opts?: { detail?: boolean }): PublicTenant {
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
  tenant.usersCount = usersCount(database, row.id);
  tenant.branchesCount = branchesCount(database, type);
  if (opts?.detail) {
    tenant.subscription = subscription;
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

function ownerFromBody(body: { [key: string]: unknown } | undefined) {
  const owner = (body?.owner && typeof body.owner === "object" ? body.owner : {}) as { [key: string]: unknown };
  return {
    name: String(body?.ownerName ?? body?.owner_name ?? owner.name ?? "").trim(),
    email: String(body?.ownerEmail ?? body?.owner_email ?? owner.email ?? "").trim().toLowerCase(),
    phone: String(body?.ownerPhone ?? body?.owner_phone ?? owner.phone ?? "").trim(),
  };
}

export function createAdminTenant(
  body: { [key: string]: unknown },
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
  const hfrId = `IN-HFR-${Math.floor(10000000 + Math.random() * 90000000)}`; // local placeholder until NHA verifies
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
  body: { [key: string]: unknown },
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
  body: { [key: string]: unknown },
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

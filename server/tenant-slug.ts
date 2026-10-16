import type { SqlDatabase } from "./sql-engine.ts";

/** Meta App Review clinic (`Lumera Apex PolyClinic`). Do not rename or rewrite it. */
export const META_REVIEW_TENANT_ID = "tenant-lumera-main";
/** Sunrise Family Clinic, Pune. Demo workspace seeding must not update or reassign this id. */
export const SUNRISE_TENANT_ID = "tenant-543feff7";

export const PROTECTED_TENANT_IDS = new Set([META_REVIEW_TENANT_ID, SUNRISE_TENANT_ID]);

export function slugifyTenant(raw: string): string {
  const s = String(raw || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s.slice(0, 48);
}

export function ensureTenantSlugColumn(database: SqlDatabase) {
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN slug TEXT DEFAULT ''");
  } catch {
    /* already present */
  }
  try {
    database.exec("ALTER TABLE branches ADD COLUMN tenant_id TEXT DEFAULT ''");
  } catch {
    /* already present */
  }
}

/** Fill a missing slug from the tenant name. Never rewrites a slug that is already set. */
export function ensureUniqueTenantSlugs(database: SqlDatabase) {
  ensureTenantSlugColumn(database);
  const rows = database.prepare("SELECT id, name, slug FROM tenants").all() as {
    id: string;
    name?: string;
    slug?: string;
  }[];
  const used = new Set<string>();
  for (const row of rows) {
    const existing = slugifyTenant(String(row.slug || ""));
    if (existing) used.add(existing);
  }
  const update = database.prepare("UPDATE tenants SET slug = ? WHERE id = ? AND (slug IS NULL OR slug = '')");
  for (const row of rows) {
    if (slugifyTenant(String(row.slug || ""))) continue;
    const base = slugifyTenant(String(row.name || "")) || "practice";
    let candidate = base;
    let n = 2;
    while (used.has(candidate)) {
      const suffix = `-${n++}`;
      candidate = `${base.slice(0, Math.max(1, 48 - suffix.length))}${suffix}`;
    }
    update.run(candidate, row.id);
    used.add(candidate);
  }
  try {
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug) WHERE slug <> ''");
  } catch {
    /* partial index already present, or this engine enforces uniqueness in the backfill above */
  }
}

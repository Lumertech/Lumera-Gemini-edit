import type { Request, Response, NextFunction } from "express";
import type { SqlDatabase } from "./sql-engine.ts";
import { getDb } from "./db.ts";

export interface DomainTenantInfo {
  tenantId: string;
  slug: string;
  name: string;
  customDomain: string;
}

/**
 * Ensure `custom_domain` column exists on tenants table.
 */
export function ensureTenantDomainSchema(database: SqlDatabase): void {
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN custom_domain TEXT DEFAULT ''");
  } catch {
    /* column already exists */
  }
}

/**
 * Configure domain multi-tenancy for the demo accounts.
 */
export function seedDemoTenantDomains(database: SqlDatabase): void {
  ensureTenantDomainSchema(database);
  try {
    // 1. Lumera Apex PolyClinic (Main Host Practice)
    database.prepare(`
      UPDATE tenants
      SET slug = CASE WHEN slug IS NULL OR slug = '' THEN 'lumera-apex' ELSE slug END,
          custom_domain = 'apex.mylumera.in'
      WHERE id = 'tenant-lumera-main'
    `).run();

    // 2. Malhotra Individual Practice
    database.prepare(`
      UPDATE tenants
      SET slug = 'malhotra-individual-practice',
          custom_domain = 'malhotra.mylumera.in'
      WHERE id = 'tenant-demo-individual'
    `).run();

    // 3. Iyer City Polyclinic
    database.prepare(`
      UPDATE tenants
      SET slug = 'iyer-city-polyclinic',
          custom_domain = 'iyer-city.mylumera.in'
      WHERE id = 'tenant-demo-polyclinic'
    `).run();

    // 4. Sunrise Family Clinic
    database.prepare(`
      UPDATE tenants
      SET slug = 'sunrise-clinic',
          custom_domain = 'sunrise.mylumera.in'
      WHERE id = 'tenant-543feff7'
    `).run();
  } catch (err) {
    console.warn("[Tenant Domains] seed error (ignored):", err);
  }
}

/**
 * Extract clean hostname without port.
 */
export function extractCleanHostname(rawHost?: string | null): string {
  if (!rawHost) return "";
  return String(rawHost).split(":")[0].trim().toLowerCase();
}

/**
 * Resolve tenant from domain / host header.
 * Matches:
 * 1. tenants.custom_domain (e.g. malhotra.mylumera.in, iyer-city.mylumera.in)
 * 2. Subdomain slug (e.g. malhotra-individual-practice.mylumera.in, malhotra.localhost)
 * 3. Exact slug match
 */
export function resolveTenantByDomain(database: SqlDatabase, rawHost?: string | null): DomainTenantInfo | null {
  const host = extractCleanHostname(rawHost);
  if (!host) return null;

  ensureTenantDomainSchema(database);

  // Exclude bare platform apex / common roots from tenant sub-routing
  if (host === "www.mylumera.in" || host === "mylumera.in" || host === "localhost" || host === "127.0.0.1") {
    return null;
  }

  try {
    // 1. Check exact custom_domain match
    const byDomain = database.prepare(`
      SELECT id, name, slug, custom_domain
      FROM tenants
      WHERE lower(trim(custom_domain)) = ?
      LIMIT 1
    `).get(host) as { id: string; name: string; slug: string; custom_domain: string } | undefined;

    if (byDomain?.id) {
      return {
        tenantId: byDomain.id,
        slug: byDomain.slug || byDomain.id,
        name: byDomain.name,
        customDomain: byDomain.custom_domain || host,
      };
    }

    // 2. Extract subdomain before .mylumera.in or .localhost
    let subdomain = "";
    if (host.endsWith(".mylumera.in")) {
      subdomain = host.slice(0, -".mylumera.in".length);
    } else if (host.endsWith(".localhost")) {
      subdomain = host.slice(0, -".localhost".length);
    }

    if (subdomain && subdomain !== "www") {
      // Check if subdomain matches slug or partial slug
      const bySub = database.prepare(`
        SELECT id, name, slug, custom_domain
        FROM tenants
        WHERE lower(slug) = ? OR lower(slug) LIKE ? OR lower(trim(custom_domain)) LIKE ?
        LIMIT 1
      `).get(subdomain, `${subdomain}-%`, `${subdomain}.%`) as { id: string; name: string; slug: string; custom_domain: string } | undefined;

      if (bySub?.id) {
        return {
          tenantId: bySub.id,
          slug: bySub.slug || bySub.id,
          name: bySub.name,
          customDomain: bySub.custom_domain || `${subdomain}.mylumera.in`,
        };
      }
    }
  } catch (err) {
    console.warn("[Tenant Domains] query error:", err);
  }

  return null;
}

/**
 * Express middleware to attach domain tenant context.
 */
export function domainTenantMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    const rawHost = req.headers["x-forwarded-host"] || req.headers.host;
    const host = Array.isArray(rawHost) ? rawHost[0] : rawHost;
    if (host) {
      const db = getDb();
      const domainTenant = resolveTenantByDomain(db, host);
      if (domainTenant) {
        (req as unknown as { domainTenant?: DomainTenantInfo }).domainTenant = domainTenant;
        res.setHeader("X-Lumera-Domain-Tenant", domainTenant.tenantId);
        res.setHeader("X-Lumera-Domain-Slug", domainTenant.slug);
      }
    }
  } catch {
    /* non-blocking */
  }
  next();
}

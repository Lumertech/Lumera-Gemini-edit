import type { Request, Response } from "express";
import { getDb } from "./db.ts";

/**
 * Session-scoped workspace slug check.
 * The URL slug is never a tenant id. A match returns the session tenant only.
 * A different clinic's slug is 403. An unknown slug is 404. Neither body
 * includes the other tenant's id or rows.
 */
export interface TenantSlugResolveInput {
  role?: string | null;
  sessionSlug?: string | null;
  sessionTenantId?: string | null;
  requestedSlug?: string | null;
  /** True when some tenant row already owns this slug. */
  slugExists: boolean;
}

export interface TenantSlugResolveResult {
  status: 200 | 403 | 404;
  body: Record<string, unknown>;
}

export function normalizeTenantSlug(raw?: string | null): string {
  return String(raw || "").trim().toLowerCase();
}

export function resolveTenantSlug(input: TenantSlugResolveInput): TenantSlugResolveResult {
  const role = String(input.role || "").trim();
  const requested = normalizeTenantSlug(input.requestedSlug);
  const sessionSlug = normalizeTenantSlug(input.sessionSlug);
  const sessionTenantId = String(input.sessionTenantId || "").trim();

  if (role === "super_admin" || role === "admin") {
    return { status: 403, body: { error: "Forbidden", redirect: "/admin" } };
  }

  if (!requested) {
    return { status: 404, body: { error: "Not found" } };
  }

  if (sessionSlug && requested === sessionSlug) {
    return {
      status: 200,
      body: {
        slug: sessionSlug,
        tenantId: sessionTenantId,
      },
    };
  }

  if (input.slugExists) {
    const body: Record<string, unknown> = { error: "Forbidden" };
    if (sessionSlug) body.slug = sessionSlug;
    return { status: 403, body };
  }

  return { status: 404, body: { error: "Not found" } };
}

export function tenantSlugExists(slug: string): boolean {
  const normalized = normalizeTenantSlug(slug);
  if (!normalized) return false;
  const row = getDb().prepare("SELECT id FROM tenants WHERE lower(slug) = ?").get(normalized) as
    | { id?: string }
    | undefined;
  return Boolean(row?.id);
}

export function sendTenantResolve(req: Request, res: Response) {
  const requested = String(req.query.slug || "");
  const result = resolveTenantSlug({
    role: req.user?.role,
    sessionSlug: req.user?.workspaceSlug,
    sessionTenantId: req.user?.tenantId,
    requestedSlug: requested,
    slugExists: tenantSlugExists(requested),
  });
  res.status(result.status).json(result.body);
}

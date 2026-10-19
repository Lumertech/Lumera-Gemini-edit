import type { Request, Response } from "express";

/**
 * Session-scoped workspace slug check.
 * The URL slug is never a tenant id. A match returns the session tenant only.
 * Any other slug — foreign or unknown — is the same 404, with the caller's own
 * slug and no tenant row lookup, so the response does not reveal that a slug exists.
 */
export interface TenantSlugResolveInput {
  role?: string | null;
  sessionSlug?: string | null;
  sessionTenantId?: string | null;
  requestedSlug?: string | null;
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

  if (sessionSlug && requested === sessionSlug) {
    return {
      status: 200,
      body: {
        slug: sessionSlug,
        tenantId: sessionTenantId,
      },
    };
  }

  return { status: 404, body: { error: "Not found", slug: sessionSlug } };
}

export function sendTenantResolve(req: Request, res: Response) {
  const requested = String(req.query.slug || "");
  const result = resolveTenantSlug({
    role: req.user?.role,
    sessionSlug: req.user?.workspaceSlug,
    sessionTenantId: req.user?.tenantId,
    requestedSlug: requested,
  });
  res.status(result.status).json(result.body);
}

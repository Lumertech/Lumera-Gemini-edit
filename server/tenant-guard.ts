import type { NextFunction, Request, Response } from "express";
import { isPlatformAdminRole } from "./auth.ts";

function claimStrings(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  return trimmed ? [trimmed] : [];
}

function bodyRecord(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return {};
  return req.body as Record<string, unknown>;
}

/**
 * Clinic APIs authorise the tenant from the session only.
 * A forged tenant id is 403. A forged workspace slug is 404. Neither response includes row data.
 * Platform admin routes may still name a tenant they are administering.
 */
export function rejectUntrustedTenantClaim(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return next();
  if (isPlatformAdminRole(req.user.role)) return next();

  const sessionTenant = String(req.user.tenantId || "").trim();
  const sessionSlug = String(req.user.workspaceSlug || "").trim().toLowerCase();
  const body = bodyRecord(req);
  const query = req.query || {};

  const tenantClaims = [
    ...claimStrings(body.tenantId),
    ...claimStrings(body.tenant_id),
    ...claimStrings(query.tenantId),
    ...claimStrings(query.tenant_id),
    ...claimStrings(req.headers["x-tenant-id"]),
  ];
  if (tenantClaims.some((claim) => claim !== sessionTenant)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const slugClaims = [
    ...claimStrings(body.workspaceSlug),
    ...claimStrings(body.workspace_slug),
    ...claimStrings(query.workspaceSlug),
    ...claimStrings(query.workspace_slug),
    ...claimStrings(req.headers["x-workspace-slug"]),
  ].map((slug) => slug.toLowerCase());
  if (slugClaims.some((slug) => slug !== sessionSlug)) {
    return res.status(404).json({ error: "Not found" });
  }

  next();
}

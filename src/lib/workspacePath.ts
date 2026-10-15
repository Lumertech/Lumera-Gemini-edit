/** Stable, URL-safe workspace key for a signed-in practice (not a security boundary). */

export function slugifyWorkspace(raw: string): string {
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

export interface WorkspaceSlugInput {
  name?: string | null;
  email?: string | null;
  clinicName?: string | null;
  packId?: string | null;
  specialty?: string | null;
  tenantId?: string | null;
  /** Server-issued tenant slug. This is the workspace path, not a client guess. */
  workspaceSlug?: string | null;
}

/**
 * Path segment after `/w/` so billing/WhatsApp URLs belong to this account.
 * Demo specialty logins share a tenant, so we prefer clinic → display name → pack
 * instead of the shared `tenant-lumera-main` id.
 */
export function workspaceSlugFromUser(user?: WorkspaceSlugInput | null): string {
  if (!user) return "practice";
  const issued = slugifyWorkspace(user.workspaceSlug || "");
  if (issued) return issued;
  const clinic = slugifyWorkspace(user.clinicName || "");
  if (clinic) return clinic;
  const who = slugifyWorkspace(user.name || String(user.email || "").split("@")[0] || "");
  const pack = slugifyWorkspace(user.packId || user.specialty || "");
  if (who && pack && !who.includes(pack)) return `${who}-${pack}`;
  if (who) return who;
  if (pack) return pack;
  const tenant = slugifyWorkspace(String(user.tenantId || "").replace(/^tenant-/, ""));
  return tenant || "practice";
}

/**
 * Signed-in clinic URLs must use the session tenant slug.
 * A mismatched `/w/:slug` is rewritten to that slug (same tab). Super Admin never stays on `/w`.
 */
export function reconcileWorkspacePath(pathname: string, sessionSlug: string, role?: string | null): string | null {
  const p = (pathname.split("?")[0] || "/").replace(/\/+$/, "").toLowerCase() || "/";
  const roleKey = String(role || "");
  if (roleKey === "super_admin" || roleKey === "admin") {
    if (p === "/app" || p.startsWith("/app/") || p === "/w" || p.startsWith("/w/")) return "/admin";
    return null;
  }
  const slug = slugifyWorkspace(sessionSlug);
  if (!slug) return null;
  if (p === "/app") return `/w/${slug}`;
  if (p.startsWith("/app/")) {
    const view = p.split("/").filter(Boolean)[1] || "queue";
    return `/w/${slug}/${view}`;
  }
  if (p === "/w" || p.startsWith("/w/")) {
    const parts = p.split("/").filter(Boolean);
    const urlSlug = parts[1] || "";
    const viewSeg = parts[2];
    if (!urlSlug || urlSlug !== slug) {
      return viewSeg ? `/w/${slug}/${viewSeg}` : `/w/${slug}`;
    }
  }
  return null;
}

export function isAppWorkspaceRootPath(pathname: string): boolean {
  const p = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  if (p === "/app") return true;
  return /^\/w\/[^/]+$/.test(p);
}

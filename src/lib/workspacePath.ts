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
}

/**
 * Path segment after `/w/` so billing/WhatsApp URLs belong to this account.
 * Demo specialty logins share a tenant, so we prefer clinic → display name → pack
 * instead of the shared `tenant-lumera-main` id.
 */
export function workspaceSlugFromUser(user?: WorkspaceSlugInput | null): string {
  if (!user) return "practice";
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

export function isAppWorkspaceRootPath(pathname: string): boolean {
  const p = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  if (p === "/app") return true;
  return /^\/w\/[^/]+$/.test(p);
}

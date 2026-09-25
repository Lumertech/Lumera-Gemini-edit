/** Session-only active branch. Stays in this clinic thread; cleared when the tab closes. */

export interface ActiveBranch {
  id: string;
  name: string;
  tenantId: string;
}

const KEY = "lumera.activeBranch";

export function readActiveBranch(tenantId?: string | null): ActiveBranch | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveBranch>;
    if (!parsed.id || !parsed.name) return null;
    const storedTenant = String(parsed.tenantId || "");
    if (tenantId && storedTenant && storedTenant !== tenantId) return null;
    return { id: String(parsed.id), name: String(parsed.name), tenantId: storedTenant };
  } catch {
    return null;
  }
}

export function writeActiveBranch(branch: ActiveBranch | null): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (!branch) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, JSON.stringify(branch));
  } catch {
    /* private mode / quota — the in-memory selection still works for this view */
  }
}

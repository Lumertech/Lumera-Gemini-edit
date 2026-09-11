/** Superadmin support scope — which clinic tenant the operator is currently in. */

export const TENANT_SCOPE_KEY = "lumera_admin_tenant_scope";

export interface TenantScope {
  id: string;
  name: string;
}

export function parseTenantScope(raw: string | null | undefined): TenantScope | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const id = String(parsed?.id || "").trim();
    if (!id) return null;
    const name = String(parsed?.name || id).trim() || id;
    return { id, name };
  } catch {
    return null;
  }
}

export function serializeTenantScope(scope: TenantScope): string {
  return JSON.stringify({ id: scope.id, name: scope.name });
}

function sessionStore(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function readTenantScope(): TenantScope | null {
  const store = sessionStore();
  if (!store) return null;
  return parseTenantScope(store.getItem(TENANT_SCOPE_KEY));
}

export function writeTenantScope(scope: TenantScope | null): void {
  const store = sessionStore();
  if (!store) return;
  try {
    if (!scope) store.removeItem(TENANT_SCOPE_KEY);
    else store.setItem(TENANT_SCOPE_KEY, serializeTenantScope(scope));
  } catch {
    /* private mode / quota */
  }
}

/** Clears persisted tenant context. Call on logout so scope cannot leak across sessions. */
export function clearTenantScope(): void {
  writeTenantScope(null);
}

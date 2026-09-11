import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { clearTenantScope, readTenantScope, writeTenantScope, type TenantScope } from "../../lib/tenantScope";

interface TenantScopeContextValue {
  scope: TenantScope | null;
  setScope: (scope: TenantScope | null) => void;
  clearScope: () => void;
}

const TenantScopeContext = createContext<TenantScopeContextValue | null>(null);

export const TenantScopeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [scope, setScopeState] = useState<TenantScope | null>(() => readTenantScope());

  const setScope = useCallback((next: TenantScope | null) => {
    writeTenantScope(next);
    setScopeState(next);
  }, []);

  const clearScope = useCallback(() => {
    clearTenantScope();
    setScopeState(null);
  }, []);

  const value = useMemo(() => ({ scope, setScope, clearScope }), [scope, setScope, clearScope]);
  return <TenantScopeContext.Provider value={value}>{children}</TenantScopeContext.Provider>;
};

export function useTenantScope() {
  const ctx = useContext(TenantScopeContext);
  if (!ctx) {
    return {
      scope: null as TenantScope | null,
      setScope: (_next: TenantScope | null) => undefined,
      clearScope: () => undefined,
    };
  }
  return ctx;
}

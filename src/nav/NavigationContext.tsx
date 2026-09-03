import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export type Surface = "landing" | "login" | "app" | "admin" | "portal" | "policy";
export type AdminTab =
  | "overview"
  | "users"
  | "subscriptions"
  | "site"
  | "policies"
  | "media"
  | "audit";

export interface GoOptions {
  adminTab?: AdminTab;
  policySlug?: string;
  loginNext?: Surface;
  loginDemo?: boolean;
}

interface NavContextValue {
  surface: Surface;
  adminTab: AdminTab;
  policySlug: string;
  loginNext: Surface;
  loginDemo: boolean;
  go: (surface: Surface, opts?: GoOptions) => void;
}

const NavContext = createContext<NavContextValue | null>(null);

export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [surface, setSurface] = useState<Surface>("landing");
  const [adminTab, setAdminTab] = useState<AdminTab>("overview");
  const [policySlug, setPolicySlug] = useState("privacy");
  const [loginNext, setLoginNext] = useState<Surface>("app");
  const [loginDemo, setLoginDemo] = useState(false);

  const go = useCallback((next: Surface, opts?: GoOptions) => {
    if (opts?.adminTab) setAdminTab(opts.adminTab);
    if (opts?.policySlug) setPolicySlug(opts.policySlug);
    if (opts?.loginNext) setLoginNext(opts.loginNext);
    if (typeof opts?.loginDemo === "boolean") setLoginDemo(opts.loginDemo);
    if (next === "admin") setAdminTab(opts?.adminTab || "overview");
    if (next === "login" && !opts?.loginNext) {
      /* keep existing loginNext */
    }
    setSurface(next);
  }, []);

  const value = useMemo(
    () => ({ surface, adminTab, policySlug, loginNext, loginDemo, go }),
    [surface, adminTab, policySlug, loginNext, loginDemo, go]
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
};

export function useNav() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNav must be used within NavigationProvider");
  return ctx;
}

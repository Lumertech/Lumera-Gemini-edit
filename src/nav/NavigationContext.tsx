import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export type Surface = "landing" | "login" | "app" | "admin" | "portal" | "policy" | "legal" | "onboarding";
export type AdminTab =
  | "overview"
  | "dhis"
  | "users"
  | "subscriptions"
  | "meta"
  | "site"
  | "policies"
  | "media"
  | "audit";

export interface GoOptions {
  adminTab?: AdminTab;
  policySlug?: string;
  loginNext?: Surface;
  loginDemo?: boolean;
  loginMode?: "signin" | "register";
}

interface NavContextValue {
  surface: Surface;
  adminTab: AdminTab;
  policySlug: string;
  loginNext: Surface;
  loginDemo: boolean;
  loginMode: "signin" | "register";
  go: (surface: Surface, opts?: GoOptions) => void;
}

const NavContext = createContext<NavContextValue | null>(null);

function detectInitialNav(): { surface: Surface; policySlug: string; adminTab: AdminTab } {
  if (typeof window !== "undefined") {
    const p = window.location.pathname.toLowerCase();
    const search = new URLSearchParams(window.location.search);
    const surfaceQuery = (search.get("surface") || search.get("view") || search.get("tab") || "").toLowerCase();

    if (surfaceQuery === "landing" || surfaceQuery === "site" || surfaceQuery === "public") {
      return { surface: "landing", policySlug: "privacy", adminTab: "overview" };
    }
    if (surfaceQuery === "portal" || surfaceQuery === "patient") {
      return { surface: "portal", policySlug: "privacy", adminTab: "overview" };
    }
    if (surfaceQuery === "admin") {
      return { surface: "admin", policySlug: "privacy", adminTab: "overview" };
    }
    if (surfaceQuery === "login") {
      return { surface: "login", policySlug: "privacy", adminTab: "overview" };
    }

    if (p === "/privacy-policy" || p === "/privacy") {
      return { surface: "legal", policySlug: "privacy-policy", adminTab: "overview" };
    }
    if (p === "/terms-of-service" || p === "/terms") {
      return { surface: "legal", policySlug: "terms-of-service", adminTab: "overview" };
    }
    if (p === "/data-deletion-instructions" || p === "/data-deletion") {
      return { surface: "legal", policySlug: "data-deletion-instructions", adminTab: "overview" };
    }
    if (p === "/admin") {
      return { surface: "admin", policySlug: "privacy", adminTab: "overview" };
    }
    if (p === "/portal" || p === "/patient") {
      return { surface: "portal", policySlug: "privacy", adminTab: "overview" };
    }
    if (p === "/landing" || p === "/site" || p === "/public") {
      return { surface: "landing", policySlug: "privacy", adminTab: "overview" };
    }
    if (p === "/login") {
      return { surface: "login", policySlug: "privacy", adminTab: "overview" };
    }
    if (p === "/onboarding") {
      return { surface: "onboarding", policySlug: "privacy", adminTab: "overview" };
    }
  }
  return { surface: "landing", policySlug: "privacy", adminTab: "overview" };
}

export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initial = useMemo(() => detectInitialNav(), []);
  const [surface, setSurface] = useState<Surface>(initial.surface);
  const [adminTab, setAdminTab] = useState<AdminTab>(initial.adminTab);
  const [policySlug, setPolicySlug] = useState(initial.policySlug);
  const [loginNext, setLoginNext] = useState<Surface>("app");
  const [loginDemo, setLoginDemo] = useState(false);
  const [loginMode, setLoginMode] = useState<"signin" | "register">("signin");

  const go = useCallback((next: Surface, opts?: GoOptions) => {
    if (opts?.adminTab) setAdminTab(opts.adminTab);
    if (opts?.policySlug) setPolicySlug(opts.policySlug);
    if (opts?.loginNext) setLoginNext(opts.loginNext);
    if (typeof opts?.loginDemo === "boolean") setLoginDemo(opts.loginDemo);
    if (opts?.loginMode) setLoginMode(opts.loginMode);
    if (next === "admin") setAdminTab(opts?.adminTab || "overview");
    if (next === "legal" && opts?.policySlug && typeof window !== "undefined") {
      const targetPath = `/${opts.policySlug}`;
      if (window.location.pathname !== targetPath) {
        window.history.pushState({}, "", targetPath);
      }
    }
    if (next === "login" && !opts?.loginNext) {
      /* keep existing loginNext */
    }
    setSurface(next);
  }, []);

  const value = useMemo(
    () => ({ surface, adminTab, policySlug, loginNext, loginDemo, loginMode, go }),
    [surface, adminTab, policySlug, loginNext, loginDemo, loginMode, go]
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
};

export function useNav() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNav must be used within NavigationProvider");
  return ctx;
}

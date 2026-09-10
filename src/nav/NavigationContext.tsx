import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  type AdminTab,
  type Surface,
  pathToNav,
  surfaceToPath,
} from "./surfaces";

export type { AdminTab, Surface } from "./surfaces";

export interface GoOptions {
  adminTab?: AdminTab;
  policySlug?: string;
  loginNext?: Surface;
  loginDemo?: boolean;
  loginMode?: "signin" | "register";
  replace?: boolean;
  /** Stay on the marketing site even if a session exists (`/landing`). */
  explicitPublic?: boolean;
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

function detectInitialNav() {
  if (typeof window === "undefined") {
    return pathToNav("/");
  }
  return pathToNav(window.location.pathname, window.location.search);
}

function syncHistory(path: string, replace: boolean) {
  if (typeof window === "undefined") return;
  if (window.location.pathname === path) return;
  if (replace) {
    window.history.replaceState({}, "", path);
  } else {
    window.history.pushState({}, "", path);
  }
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
    const targetPath = surfaceToPath(next, {
      policySlug: opts?.policySlug,
      explicitPublic: opts?.explicitPublic,
    });
    syncHistory(targetPath, Boolean(opts?.replace));
    setSurface(next);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      const next = pathToNav(window.location.pathname, window.location.search);
      setSurface(next.surface);
      setPolicySlug(next.policySlug);
      setAdminTab(next.adminTab);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
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

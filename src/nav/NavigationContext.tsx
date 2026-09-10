import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  type AdminTab,
  type AppView,
  type LoginMode,
  type Surface,
  destinationNavAfterAuth,
  pathToNav,
  surfaceToPath,
} from "./surfaces";

export type { AdminTab, AppView, LoginMode, Surface } from "./surfaces";

export interface GoOptions {
  adminTab?: AdminTab;
  appView?: AppView | string;
  policySlug?: string;
  loginNext?: Surface;
  loginNextPath?: string;
  loginDemo?: boolean;
  loginMode?: LoginMode;
  replace?: boolean;
  /** Stay on the marketing site even if a session exists (`/landing`). */
  explicitPublic?: boolean;
}

interface NavContextValue {
  surface: Surface;
  adminTab: AdminTab;
  appView: AppView;
  policySlug: string;
  loginNext: Surface;
  loginNextPath: string;
  loginDemo: boolean;
  loginMode: LoginMode;
  pathname: string;
  search: string;
  go: (surface: Surface, opts?: GoOptions) => void;
}

const NavContext = createContext<NavContextValue | null>(null);

/**
 * History-API router (BrowserRouter), not HashRouter.
 * Firebase Hosting `**` → Cloud Run + Express SPA fallback serve index.html
 * for extensionless paths so `/app/rx` and `/admin/users` deep-link without 404.
 */
export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const parsed = useMemo(
    () => pathToNav(location.pathname, location.search),
    [location.pathname, location.search]
  );
  const [loginDemo, setLoginDemo] = useState(false);

  const go = useCallback(
    (next: Surface, opts?: GoOptions) => {
      if (typeof opts?.loginDemo === "boolean") setLoginDemo(opts.loginDemo);
      const targetPath = surfaceToPath(next, {
        policySlug: opts?.policySlug,
        explicitPublic: opts?.explicitPublic,
        loginMode: opts?.loginMode ?? (next === "login" ? parsed.loginMode : undefined),
        loginNext: opts?.loginNext ?? (next === "login" ? parsed.loginNext : undefined),
        loginNextPath: opts?.loginNextPath ?? (next === "login" ? parsed.loginNextPath : undefined),
        adminTab: opts?.adminTab ?? (next === "admin" && !opts?.adminTab ? undefined : opts?.adminTab),
        appView: opts?.appView,
      });
      const current = `${location.pathname}${location.search}`;
      if (current === targetPath) return;
      navigate(targetPath, { replace: Boolean(opts?.replace) });
    },
    [navigate, location.pathname, location.search, parsed.loginMode, parsed.loginNext, parsed.loginNextPath]
  );

  const value = useMemo(
    () => ({
      surface: parsed.surface,
      adminTab: parsed.adminTab,
      appView: parsed.appView,
      policySlug: parsed.policySlug,
      loginNext: parsed.loginNext,
      loginNextPath: parsed.loginNextPath,
      loginDemo,
      loginMode: parsed.loginMode,
      pathname: location.pathname,
      search: location.search,
      go,
    }),
    [parsed, loginDemo, location.pathname, location.search, go]
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
};

export function useNav() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNav must be used within NavigationProvider");
  return ctx;
}

export function goAfterAuth(
  go: NavContextValue["go"],
  dest: Surface,
  loginNextPath?: string
) {
  const next = destinationNavAfterAuth(dest, loginNextPath);
  go(next.surface, { replace: true, appView: next.appView, adminTab: next.adminTab });
}

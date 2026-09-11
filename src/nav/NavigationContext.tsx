import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { workspaceSlugFromUser } from "../lib/workspacePath";
import {
  type AdminTab,
  type AppView,
  type LoginMode,
  type Surface,
  destinationNavAfterAuth,
  normalizePath,
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
  workspaceSlug?: string;
  /** Stay on the marketing site even if a session exists (`/landing`). */
  explicitPublic?: boolean;
}

interface NavContextValue {
  surface: Surface;
  adminTab: AdminTab;
  appView: AppView;
  workspaceSlug: string;
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
 * Signed-in clinician tabs live at `/w/:workspace/:view` so the URL is account-rooted.
 * `/app/:view` remains a login/deep-link alias and is rewritten after session hydrate.
 */
export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const parsed = useMemo(
    () => pathToNav(location.pathname, location.search),
    [location.pathname, location.search]
  );
  const [loginDemo, setLoginDemo] = useState(false);
  const sessionWorkspace = user ? workspaceSlugFromUser(user) : "";
  const workspaceSlug = sessionWorkspace || parsed.workspaceSlug;

  const go = useCallback(
    (next: Surface, opts?: GoOptions) => {
      if (typeof opts?.loginDemo === "boolean") setLoginDemo(opts.loginDemo);
      const ws =
        opts?.workspaceSlug ||
        (next === "app" ? sessionWorkspace || parsed.workspaceSlug : undefined);
      const targetPath = surfaceToPath(next, {
        policySlug: opts?.policySlug,
        explicitPublic: opts?.explicitPublic,
        loginMode: opts?.loginMode ?? (next === "login" ? parsed.loginMode : undefined),
        loginNext: opts?.loginNext ?? (next === "login" ? parsed.loginNext : undefined),
        loginNextPath: opts?.loginNextPath ?? (next === "login" ? parsed.loginNextPath : undefined),
        adminTab: opts?.adminTab ?? (next === "admin" && !opts?.adminTab ? undefined : opts?.adminTab),
        appView: opts?.appView,
        workspaceSlug: ws,
      });
      const current = `${location.pathname}${location.search}`;
      if (current === targetPath) return;
      navigate(targetPath, { replace: Boolean(opts?.replace) });
    },
    [
      navigate,
      location.pathname,
      location.search,
      parsed.loginMode,
      parsed.loginNext,
      parsed.loginNextPath,
      parsed.workspaceSlug,
      sessionWorkspace,
    ]
  );

  useEffect(() => {
    if (!sessionWorkspace || parsed.surface !== "app") return;
    const p = normalizePath(location.pathname);
    if (p === "/app") {
      if (p !== `/w/${sessionWorkspace}`) navigate(`/w/${sessionWorkspace}`, { replace: true });
      return;
    }
    if (p.startsWith("/app/")) {
      const view = parsed.appView;
      const next = `/w/${sessionWorkspace}/${view}`;
      if (p !== next) navigate(next, { replace: true });
      return;
    }
    if (p.startsWith("/w/")) {
      const parts = p.split("/").filter(Boolean);
      const urlSlug = parts[1] || "";
      const viewSeg = parts[2];
      if (urlSlug && urlSlug !== sessionWorkspace) {
        navigate(viewSeg ? `/w/${sessionWorkspace}/${viewSeg}` : `/w/${sessionWorkspace}`, {
          replace: true,
        });
      }
    }
  }, [sessionWorkspace, parsed.surface, parsed.appView, location.pathname, navigate]);

  const value = useMemo(
    () => ({
      surface: parsed.surface,
      adminTab: parsed.adminTab,
      appView: parsed.appView,
      workspaceSlug,
      policySlug: parsed.policySlug,
      loginNext: parsed.loginNext,
      loginNextPath: parsed.loginNextPath,
      loginDemo,
      loginMode: parsed.loginMode,
      pathname: location.pathname,
      search: location.search,
      go,
    }),
    [parsed, loginDemo, location.pathname, location.search, go, workspaceSlug]
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
  go(next.surface, {
    replace: true,
    appView: next.appView,
    adminTab: next.adminTab,
    workspaceSlug: next.workspaceSlug,
  });
}

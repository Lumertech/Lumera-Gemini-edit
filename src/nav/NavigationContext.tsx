import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetchResponse } from "../api/http";
import { clinicianHomeView } from "../lib/specialtyWorkflow";
import { reconcileWorkspacePath, slugifyWorkspace, workspaceSlugFromUser } from "../lib/workspacePath";
import { tenantRouteGuard } from "./routeGuard";
import {
  canonicalizeTenantScreenPath,
  readWorkspaceSlug,
} from "./tenantRoutes";
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
  recordId?: string;
  payFocus?: boolean;
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
  recordId: string;
  screen: string;
  payFocus: boolean;
  unrecognized: boolean;
  tenantSlugStatus: "ready" | "checking" | "missing";
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
  const workspaceSlug = sessionWorkspace || parsed.workspaceSlug || (user ? workspaceSlugFromUser(user) : "") || "practice";

  const go = useCallback(
    (next: Surface, opts?: GoOptions) => {
      if (typeof opts?.loginDemo === "boolean") setLoginDemo(opts.loginDemo);
      const ws =
        opts?.workspaceSlug ||
        (next === "app" ? sessionWorkspace || parsed.workspaceSlug || (user ? workspaceSlugFromUser(user) : "") || "practice" : undefined);
      const targetPath = surfaceToPath(next, {
        policySlug: opts?.policySlug,
        explicitPublic: opts?.explicitPublic,
        loginMode: opts?.loginMode ?? (next === "login" ? parsed.loginMode : undefined),
        loginNext: opts?.loginNext ?? (next === "login" ? parsed.loginNext : undefined),
        loginNextPath: opts?.loginNextPath ?? (next === "login" ? parsed.loginNextPath : undefined),
        adminTab: opts?.adminTab ?? (next === "admin" && !opts?.adminTab ? undefined : opts?.adminTab),
        appView: opts?.appView,
        recordId: opts?.recordId,
        payFocus: opts?.payFocus,
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

  const urlSlug = readWorkspaceSlug(location.pathname);
  const platformAdmin = user?.role === "super_admin" || user?.role === "admin";
  const slugMismatch = Boolean(user && !platformAdmin && urlSlug && sessionWorkspace && urlSlug !== sessionWorkspace);
  const [slugDecision, setSlugDecision] = useState<{ slug: string; status: "ready" | "missing" } | null>(null);
  const tenantSlugStatus: "ready" | "checking" | "missing" = !slugMismatch
    ? "ready"
    : slugDecision?.slug === urlSlug
      ? slugDecision.status
      : "checking";

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const role = user.role;
    const reconciled = reconcileWorkspacePath(location.pathname, sessionWorkspace, role);

    const finish = (path: string) => {
      const canonical = canonicalizeTenantScreenPath(path);
      const base = canonical || path;
      const guarded = tenantRouteGuard(user, base).redirect;
      const finalPath = guarded || base;
      if (normalizePath(location.pathname) === normalizePath(finalPath)) return;
      navigate(finalPath, { replace: true });
    };

    if (role === "super_admin" || role === "admin") {
      if (reconciled) finish(reconciled);
      return;
    }

    if (slugMismatch && urlSlug) {
      void apiFetchResponse(`/api/tenant/resolve?slug=${encodeURIComponent(urlSlug)}`)
        .then(async (res) => {
          if (cancelled) return;
          const body = (await res.json().catch(() => ({}))) as { redirect?: string; slug?: string };
          if (res.status === 403 && body.redirect === "/admin") {
            setSlugDecision({ slug: urlSlug, status: "ready" });
            navigate("/admin", { replace: true });
            return;
          }
          if (res.status === 404) {
            const ownSlug = slugifyWorkspace(body.slug || "") || sessionWorkspace;
            const swapped =
              reconcileWorkspacePath(location.pathname, ownSlug, role) ||
              reconcileWorkspacePath(location.pathname, sessionWorkspace, role) ||
              location.pathname;
            if (normalizePath(swapped) === normalizePath(location.pathname)) {
              setSlugDecision({ slug: urlSlug, status: "ready" });
              return;
            }
            finish(swapped);
            return;
          }
          setSlugDecision({ slug: urlSlug, status: "ready" });
          finish(reconciled || location.pathname);
        })
        .catch(() => {
          if (cancelled) return;
          setSlugDecision({ slug: urlSlug, status: "ready" });
          if (reconciled) finish(reconciled);
        });
      return () => {
        cancelled = true;
      };
    }

    finish(reconciled || location.pathname);
    return () => {
      cancelled = true;
    };
  }, [user, sessionWorkspace, location.pathname, navigate, slugMismatch, urlSlug]);

  const renderedView =
    parsed.screen === "dashboard" && parsed.appView === "welcome" && user
      ? (clinicianHomeView(user) as AppView)
      : parsed.appView;

  const value = useMemo(
    () => ({
      surface: parsed.surface,
      adminTab: parsed.adminTab,
      appView: renderedView,
      recordId: parsed.recordId,
      screen: parsed.screen,
      payFocus: parsed.payFocus,
      unrecognized: parsed.unrecognized,
      tenantSlugStatus,
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
    [parsed, renderedView, tenantSlugStatus, loginDemo, location.pathname, location.search, go, workspaceSlug]
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
};

export function useNav() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNav must be used within NavigationProvider");
  return ctx;
}

export function useTenantRouteGuard() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  return useMemo(() => {
    if (!user) return { redirect: null as string | null };
    return tenantRouteGuard(user, pathname);
  }, [user, pathname]);
}

/** Route-level wrapper. Disallowed roles leave the screen; unknown screens stay put. */
export function TenantRouteGuard({ children }: { children: React.ReactNode }) {
  const { unrecognized } = useNav();
  const { redirect } = useTenantRouteGuard();
  const navigate = useNavigate();

  useEffect(() => {
    if (!redirect) return;
    navigate(redirect, { replace: true });
  }, [redirect, navigate]);

  if (unrecognized) {
    return (
      <div
        data-testid="unknown-screen"
        className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden p-6 text-slate-800"
      >
        <h1 className="text-lg font-semibold">This screen is not on this clinic link.</h1>
        <p className="mt-2 text-sm text-slate-600">The address does not match a clinic screen. Nothing else was opened.</p>
      </div>
    );
  }
  if (redirect) return null;
  return <>{children}</>;
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
    recordId: next.recordId,
    payFocus: next.payFocus,
  });
}

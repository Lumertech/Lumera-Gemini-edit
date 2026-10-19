import { useEffect } from "react";
import { BrowserRouter, useLocation } from "react-router-dom";
import { AuthProvider, destinationAfterAuth, homeSurfaceForRole, useAuth } from "./auth/AuthContext";
import { BrandMark } from "./components/BrandMark";
import { NavigationProvider, TenantRouteGuard, goAfterAuth, useNav } from "./nav/NavigationContext";
import { safeWorkspaceReturnPath } from "./nav/tenantRoutes";
import { decideChrome, nextAuthenticatedSurface, safeNextPath, surfaceToPath } from "./nav/surfaces";
import { LandingPage } from "./components/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { PricingPage } from "./pages/PricingPage";
import { PolicyPage } from "./pages/PolicyPage";
import { AdminShell } from "./components/admin/AdminShell";
import ClinicianApp from "./ClinicianApp";
import PatientPortalApp from "./PatientPortalApp";
import { OnboardingWizard } from "./pages/OnboardingWizard";
import { needsOnboarding } from "./lib/sessionWorkspace";

function PublicBootSplash() {
  return (
    <div
      data-testid="public-boot-splash"
      className="h-full w-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white"
    >
      <BrandMark
        size="lg"
        layout="stack"
        wordmarkClassName="font-manrope text-lg font-bold tracking-tight text-white"
      />
      <p className="text-xs text-slate-400 mt-1">Practice operating system</p>
    </div>
  );
}

function UnknownClinic() {
  const { go, workspaceSlug } = useNav();
  const { pathname } = useLocation();
  const slug = pathname.split("/").filter(Boolean)[1] || "";
  return (
    <div
      data-testid="unknown-tenant"
      className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden flex flex-col items-center justify-center p-6 text-center text-slate-800"
    >
      <h1 className="text-lg font-semibold">Clinic link not found</h1>
      <p className="mt-2 max-w-md text-sm text-slate-600">
        {slug ? `"${slug}" is not a clinic.` : "This clinic link was not found."} No other clinic was opened.
      </p>
      {workspaceSlug && (
        <button
          type="button"
          className="mt-4 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold"
          onClick={() => go("app", { appView: "dashboard", workspaceSlug, replace: true })}
        >
          Back to your clinic
        </button>
      )}
    </div>
  );
}

function SurfaceRoot() {
  const {
    surface,
    policySlug,
    loginNext,
    loginNextPath,
    appView,
    adminTab,
    workspaceSlug,
    recordId,
    payFocus,
    tenantSlugStatus,
    go,
    pathname,
  } = useNav();
  const { user, loading } = useAuth();
  const forceOnboarding = needsOnboarding(user);
  const roleHome = user ? destinationAfterAuth(user, loginNext) : "app";
  const chrome = decideChrome({
    loading,
    authenticated: Boolean(user),
    surface,
    pathname,
    roleHome,
    needsOnboarding: forceOnboarding,
  });

  useEffect(() => {
    if (loading) return;

    if (!user) {
      if (chrome.renderSurface === "login" && surface !== "login") {
        const built =
          surface === "app" && (pathname.startsWith("/w/") || pathname === "/w" || pathname.startsWith("/app/") || pathname === "/app")
            ? safeWorkspaceReturnPath(pathname) || surfaceToPath(surface, { appView, adminTab, workspaceSlug, recordId, payFocus })
            : surfaceToPath(surface, { appView, adminTab, workspaceSlug, recordId, payFocus });
        const loginReturn = surface === "app" ? safeWorkspaceReturnPath(built) : safeNextPath(built) || built;
        go("login", {
          loginNext: surface,
          loginNextPath: loginReturn,
          loginMode: "signin",
          replace: true,
        });
      }
      return;
    }

    const next = nextAuthenticatedSurface({
      surface,
      pathname,
      roleHome,
      needsOnboarding: forceOnboarding,
    });

    if (next !== surface) {
      if (surface === "login") {
        goAfterAuth(go, next, loginNextPath);
        return;
      }
      go(next, { replace: true });
    }
  }, [
    loading,
    user,
    forceOnboarding,
    surface,
    loginNext,
    loginNextPath,
    appView,
    adminTab,
    workspaceSlug,
    recordId,
    payFocus,
    go,
    pathname,
    chrome.renderSurface,
  ]);

  if (chrome.boot) {
    return <PublicBootSplash />;
  }

  const view = chrome.renderSurface;

  if (view === "pricing") return <PricingPage />;
  if (view === "login") return <LoginPage />;
  if (view === "policy" || view === "legal") return <PolicyPage slug={policySlug} />;
  if (view === "onboarding") return <OnboardingWizard />;

  if (view === "admin") {
    if (!user) return <LoginPage />;
    return <AdminShell />;
  }
  if (view === "app") {
    if (!user) return <LoginPage />;
    if (tenantSlugStatus === "checking") return <PublicBootSplash />;
    if (tenantSlugStatus === "missing") return <UnknownClinic />;
    return (
      <TenantRouteGuard>
        <ClinicianApp />
      </TenantRouteGuard>
    );
  }
  if (view === "portal") {
    if (!user) return <LoginPage />;
    return <PatientPortalApp />;
  }

  return <LandingPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NavigationProvider>
          <div className="flex flex-col h-dvh max-h-dvh w-full overflow-hidden">
            <div className="flex-1 min-h-0 overflow-hidden relative">
              <SurfaceRoot />
            </div>
          </div>
        </NavigationProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export { homeSurfaceForRole };

import React, { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider, destinationAfterAuth, homeSurfaceForRole, useAuth } from "./auth/AuthContext";
import { BrandMark } from "./components/BrandMark";
import { NavigationProvider, goAfterAuth, useNav } from "./nav/NavigationContext";
import { decideChrome, nextAuthenticatedSurface, surfaceToPath } from "./nav/surfaces";
import { LandingPage } from "./components/LandingPage";
import { LoginPage } from "./pages/LoginPage";
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

function SurfaceRoot() {
  const { surface, policySlug, loginNext, loginNextPath, appView, adminTab, go, pathname } = useNav();
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
        go("login", {
          loginNext: surface,
          loginNextPath: surfaceToPath(surface, { appView, adminTab }),
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
    go,
    pathname,
    chrome.renderSurface,
  ]);

  if (chrome.boot) {
    return <PublicBootSplash />;
  }

  const view = chrome.renderSurface;

  if (view === "login") return <LoginPage />;
  if (view === "policy" || view === "legal") return <PolicyPage slug={policySlug} />;
  if (view === "onboarding") return <OnboardingWizard />;

  if (view === "admin") {
    if (!user) return <LoginPage />;
    return <AdminShell />;
  }
  if (view === "app") {
    if (!user) return <LoginPage />;
    return <ClinicianApp />;
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

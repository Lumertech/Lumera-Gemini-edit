import React, { useEffect } from "react";
import { Sparkles } from "lucide-react";
import { AuthProvider, destinationAfterAuth, homeSurfaceForRole, useAuth } from "./auth/AuthContext";
import { NavigationProvider, useNav } from "./nav/NavigationContext";
import { decideChrome, nextAuthenticatedSurface } from "./nav/surfaces";
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
      <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/30 mb-4">
        <Sparkles className="w-6 h-6 text-white" />
      </div>
      <p className="font-manrope text-lg font-bold tracking-tight">Lumera</p>
      <p className="text-xs text-slate-400 mt-1">Practice operating system</p>
    </div>
  );
}

function SurfaceRoot() {
  const { surface, policySlug, loginNext, go } = useNav();
  const { user, loading } = useAuth();
  const forceOnboarding = needsOnboarding(user);
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
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
        go("login", { loginNext: surface, replace: true });
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
      go(next, { replace: true });
    }
  }, [loading, user, forceOnboarding, surface, loginNext, go, pathname, chrome.renderSurface]);

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
    <AuthProvider>
      <NavigationProvider>
        <div className="flex flex-col h-dvh max-h-dvh w-full overflow-hidden">
          <div className="flex-1 min-h-0 overflow-hidden relative">
            <SurfaceRoot />
          </div>
        </div>
      </NavigationProvider>
    </AuthProvider>
  );
}

export { homeSurfaceForRole };

import React, { useEffect } from "react";
import { AuthProvider, destinationAfterAuth, homeSurfaceForRole, useAuth } from "./auth/AuthContext";
import { NavigationProvider, useNav } from "./nav/NavigationContext";
import { LandingPage } from "./components/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { PolicyPage } from "./pages/PolicyPage";
import { AdminShell } from "./components/admin/AdminShell";
import ClinicianApp from "./ClinicianApp";
import { OnboardingWizard } from "./pages/OnboardingWizard";
import { needsOnboarding } from "./lib/sessionWorkspace";

function SurfaceRoot() {
  const { surface, policySlug, go } = useNav();
  const { user, loading } = useAuth();
  const forceOnboarding = needsOnboarding(user);

  useEffect(() => {
    if (loading || !user) return;
    if (forceOnboarding && surface !== "onboarding" && surface !== "legal" && surface !== "login") {
      go("onboarding");
      return;
    }
    if (!forceOnboarding && surface === "onboarding") {
      go(destinationAfterAuth(user));
    }
  }, [loading, user, forceOnboarding, surface, go]);

  if (forceOnboarding && surface !== "legal") {
    return <OnboardingWizard />;
  }

  if (surface === "login") return <LoginPage />;
  if (surface === "policy" || surface === "legal") return <PolicyPage slug={policySlug} />;
  if (surface === "admin") return <AdminShell />;
  if (surface === "app") return <ClinicianApp />;
  if (surface === "onboarding") return <OnboardingWizard />;

  return <LandingPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationProvider>
        <div className="flex flex-col h-screen w-screen overflow-hidden">
          <div className="flex-1 overflow-hidden relative">
            <SurfaceRoot />
          </div>
        </div>
      </NavigationProvider>
    </AuthProvider>
  );
}

export { homeSurfaceForRole };

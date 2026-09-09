import React from "react";
import { AuthProvider, homeSurfaceForRole, useAuth } from "./auth/AuthContext";
import { NavigationProvider, Surface, useNav } from "./nav/NavigationContext";
import { LandingPage } from "./components/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { PolicyPage } from "./pages/PolicyPage";
import { AdminShell } from "./components/admin/AdminShell";
import ClinicianApp from "./ClinicianApp";

function SurfaceRoot() {
  const { surface, policySlug } = useNav();

  if (surface === "login") return <LoginPage />;
  if (surface === "policy" || surface === "legal") return <PolicyPage slug={policySlug} />;
  if (surface === "admin") return <AdminShell />;
  if (surface === "app") return <ClinicianApp />;

  // Default initial surface is the Public site page (LandingPage)
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

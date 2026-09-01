import React from "react";
import { AuthProvider, homeSurfaceForRole, useAuth } from "./auth/AuthContext";
import { NavigationProvider, Surface, useNav } from "./nav/NavigationContext";
import { LandingPage } from "./components/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { PolicyPage } from "./pages/PolicyPage";
import { AdminShell } from "./components/admin/AdminShell";
import ClinicianApp from "./ClinicianApp";
import PatientPortalApp from "./PatientPortalApp";
import { UserRole } from "./types";

const CLINICIAN: UserRole[] = ["doctor", "receptionist", "polyclinic_admin", "super_admin"];
const ADMIN: UserRole[] = ["super_admin", "polyclinic_admin"];
const PATIENT: UserRole[] = ["patient", "super_admin"];

function allowed(surface: Surface, role?: UserRole): boolean {
  if (surface === "app") return !!role && CLINICIAN.includes(role);
  if (surface === "admin") return !!role && ADMIN.includes(role);
  if (surface === "portal") return !!role && PATIENT.includes(role);
  return true;
}

function SurfaceRoot() {
  const { surface, policySlug } = useNav();
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-violet-950 text-violet-100 flex items-center justify-center text-sm">
        Loading Lumera…
      </div>
    );
  }

  if (surface === "login") return <LoginPage />;
  if (surface === "policy") return <PolicyPage slug={policySlug} />;

  if (surface === "app") {
    if (!user) return <LoginPage />;
    if (!allowed("app", user.role)) return <LandingPage />;
    return <ClinicianApp />;
  }

  if (surface === "admin") {
    if (!user) return <LoginPage />;
    if (!allowed("admin", user.role)) return <LandingPage />;
    return <AdminShell />;
  }

  if (surface === "portal") {
    if (!user) return <LoginPage />;
    if (!allowed("portal", user.role)) return <LandingPage />;
    return <PatientPortalApp />;
  }

  return <LandingPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationProvider>
        <SurfaceRoot />
      </NavigationProvider>
    </AuthProvider>
  );
}

export { homeSurfaceForRole };

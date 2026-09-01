import React from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import { LandingPage } from "./components/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { PolicyPage } from "./pages/PolicyPage";
import { AdminShell } from "./components/admin/AdminShell";
import { AdminOverview } from "./components/admin/AdminOverview";
import { AdminUsers } from "./components/admin/AdminUsers";
import { AdminPeople } from "./components/admin/AdminPeople";
import { AdminBranches } from "./components/admin/AdminBranches";
import { AdminCmsSite } from "./components/admin/AdminCmsSite";
import { AdminPolicies } from "./components/admin/AdminPolicies";
import { AdminMedia } from "./components/admin/AdminMedia";
import { AdminSettings } from "./components/admin/AdminSettings";
import { AdminAudit } from "./components/admin/AdminAudit";
import ClinicianApp from "./ClinicianApp";
import PatientPortalApp from "./PatientPortalApp";

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/privacy" element={<PolicyPage slug="privacy" />} />
          <Route path="/terms" element={<PolicyPage slug="terms" />} />
          <Route path="/disclaimer" element={<PolicyPage slug="disclaimer" />} />
          <Route path="/security" element={<PolicyPage slug="security" />} />

          <Route element={<RequireAuth roles={["doctor", "receptionist", "polyclinic_admin", "super_admin"]} />}>
            <Route path="/app/*" element={<ClinicianApp />} />
          </Route>

          <Route element={<RequireAuth roles={["super_admin", "polyclinic_admin"]} />}>
            <Route path="/admin" element={<AdminShell />}>
              <Route index element={<AdminOverview />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="people" element={<AdminPeople />} />
              <Route path="branches" element={<AdminBranches />} />
              <Route path="site" element={<AdminCmsSite />} />
              <Route path="policies" element={<AdminPolicies />} />
              <Route path="media" element={<AdminMedia />} />
              <Route path="settings" element={<AdminSettings />} />
              <Route path="audit" element={<AdminAudit />} />
            </Route>
          </Route>

          <Route element={<RequireAuth roles={["patient", "super_admin"]} />}>
            <Route path="/portal" element={<PatientPortalApp />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}

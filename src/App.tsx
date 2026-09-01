import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import { LandingPage } from "./components/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { PolicyPage } from "./pages/PolicyPage";
import { AdminShell } from "./components/admin/AdminShell";
import ClinicianApp from "./ClinicianApp";
import PatientPortalApp from "./PatientPortalApp";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/privacy" element={<PolicyPage slug="privacy" />} />
          <Route path="/terms" element={<PolicyPage slug="terms" />} />
          <Route path="/disclaimer" element={<PolicyPage slug="disclaimer" />} />
          <Route path="/security" element={<PolicyPage slug="security" />} />
          <Route
            path="/app/*"
            element={
              <RequireAuth roles={["doctor", "receptionist", "polyclinic_admin", "super_admin"]}>
                <ClinicianApp />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/*"
            element={
              <RequireAuth roles={["super_admin", "polyclinic_admin"]}>
                <AdminShell />
              </RequireAuth>
            }
          />
          <Route
            path="/portal"
            element={
              <RequireAuth roles={["patient", "super_admin"]}>
                <PatientPortalApp />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

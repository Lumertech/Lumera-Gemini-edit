import React from "react";
import { AuthProvider, homeSurfaceForRole, useAuth } from "./auth/AuthContext";
import { NavigationProvider, Surface, useNav } from "./nav/NavigationContext";
import { LandingPage } from "./components/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { PolicyPage } from "./pages/PolicyPage";
import { AdminShell } from "./components/admin/AdminShell";
import ClinicianApp from "./ClinicianApp";
import PatientPortalApp from "./PatientPortalApp";
import { Sparkles, Stethoscope, User, Shield, Globe, LogIn } from "lucide-react";

function SurfaceSwitcher() {
  const { surface, go } = useNav();
  const { user } = useAuth();

  return (
    <header className="bg-slate-950 text-white border-b border-slate-800 px-3 py-1 flex items-center justify-between text-xs z-50 select-none shrink-0">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-cyan-400 flex items-center gap-1.5 text-xs">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> Lumera AI Practice Suite
        </span>
        <span className="hidden sm:inline text-slate-600">|</span>
        <span className="hidden sm:inline text-slate-400 text-[11px]">Preview Workspace</span>
      </div>

      <nav aria-label="Workspace views" className="flex items-center gap-1 overflow-x-auto py-0.5">
        <button
          onClick={() => go("app")}
          className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            surface === "app"
              ? "bg-blue-600 text-white shadow-xs"
              : "text-slate-300 hover:text-white hover:bg-slate-800"
          }`}
          title="Doctor EHR, Pulse AI Ambient Scribe, Smart Rx, and Pulse AI Copilot"
        >
          <Stethoscope className="w-3 h-3 text-cyan-300" />
          <span>Doctor EHR</span>
        </button>

        <button
          onClick={() => go("portal")}
          className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            surface === "portal"
              ? "bg-blue-600 text-white shadow-xs"
              : "text-slate-300 hover:text-white hover:bg-slate-800"
          }`}
          title="Patient Portal & Health Records"
        >
          <User className="w-3 h-3 text-emerald-300" />
          <span>Patient Portal</span>
        </button>

        <button
          onClick={() => go("admin")}
          className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            surface === "admin"
              ? "bg-blue-600 text-white shadow-xs"
              : "text-slate-300 hover:text-white hover:bg-slate-800"
          }`}
          title="Admin CMS & User Management"
        >
          <Shield className="w-3 h-3 text-amber-300" />
          <span>Admin CMS</span>
        </button>

        <button
          onClick={() => go("landing")}
          className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            surface === "landing"
              ? "bg-blue-600 text-white shadow-xs"
              : "text-slate-300 hover:text-white hover:bg-slate-800"
          }`}
          title="Public Website & Marketing Page"
        >
          <Globe className="w-3 h-3 text-purple-300" />
          <span>Public Site</span>
        </button>

        {!user ? (
          <button
            onClick={() => go("login")}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] text-slate-400 hover:text-white hover:bg-slate-800 ml-1`}
            title="Sign In with clinic credentials"
          >
            <LogIn className="w-3 h-3" />
            <span className="hidden md:inline">Login</span>
          </button>
        ) : (
          <span className="text-[11px] text-slate-400 ml-1.5 hidden md:inline truncate max-w-[120px]">
            {user.name}
          </span>
        )}
      </nav>
    </header>
  );
}

function SurfaceRoot() {
  const { surface, policySlug } = useNav();

  if (surface === "login") return <LoginPage />;
  if (surface === "policy" || surface === "legal") return <PolicyPage slug={policySlug} />;
  if (surface === "admin") return <AdminShell />;
  if (surface === "portal") return <PatientPortalApp />;
  if (surface === "landing") return <LandingPage />;

  // Default to showing the full interactive Doctor EHR & Gemini Copilot suite instantly!
  return <ClinicianApp />;
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationProvider>
        <div className="flex flex-col h-screen w-screen overflow-hidden">
          <SurfaceSwitcher />
          <div className="flex-1 overflow-hidden relative">
            <SurfaceRoot />
          </div>
        </div>
      </NavigationProvider>
    </AuthProvider>
  );
}

export { homeSurfaceForRole };

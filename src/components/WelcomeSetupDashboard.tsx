import React from "react";
import { Stethoscope, UserPlus, Sparkles, Building2 } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { NavView } from "./Navbar";

interface WelcomeSetupDashboardProps {
  onSelectView: (view: NavView) => void;
}

export const WelcomeSetupDashboard: React.FC<WelcomeSetupDashboardProps> = ({ onSelectView }) => {
  const { user } = useAuth();
  const clinic = user?.clinicName || "your practice";
  const showStaff = user?.practiceType === "polyclinic";

  return (
    <div className="max-w-4xl mx-auto py-8 px-2">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-8">
        <div className="flex items-start gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Welcome to {clinic}</h1>
            <p className="text-sm text-slate-600 mt-1">
              Your clinic account is ready. This workspace starts empty — no demo doctors or sample patients.
              Choose how you want to begin.
            </p>
          </div>
        </div>

        <div className={`grid grid-cols-1 ${showStaff ? "md:grid-cols-2" : "md:grid-cols-2"} gap-4`}>
          <button
            type="button"
            onClick={() => onSelectView("rx")}
            className="text-left p-5 rounded-xl border-2 border-blue-200 bg-blue-50 hover:border-blue-400 hover:bg-blue-100 transition-colors"
          >
            <Stethoscope className="w-6 h-6 text-blue-700 mb-3" />
            <div className="text-base font-bold text-slate-900">Start First Consultation</div>
            <p className="text-xs text-slate-600 mt-1">
              Open Smart Rx Studio for a new consult. Add or pick a patient from Reception if none is selected.
            </p>
          </button>

          <button
            type="button"
            onClick={() => onSelectView("reception")}
            className="text-left p-5 rounded-xl border border-slate-200 bg-slate-50 hover:border-slate-400 transition-colors"
          >
            <UserPlus className="w-6 h-6 text-slate-700 mb-3" />
            <div className="text-base font-bold text-slate-900">Add Patients</div>
            <p className="text-xs text-slate-600 mt-1">
              Register the first walk-in or ABHA-linked patient at OPD Reception.
            </p>
          </button>

          {showStaff && (
            <button
              type="button"
              onClick={() => onSelectView("team")}
              className="text-left p-5 rounded-xl border border-slate-200 bg-slate-50 hover:border-slate-400 transition-colors md:col-span-2"
            >
              <Building2 className="w-6 h-6 text-slate-700 mb-3" />
              <div className="text-base font-bold text-slate-900">Add Staff</div>
              <p className="text-xs text-slate-600 mt-1">
                Invite doctors, receptionists, and clinic staff for your polyclinic roster.
              </p>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

import React from "react";
import { Stethoscope, UserPlus, Sparkles, Building2 } from "lucide-react";
import { useAuth } from "../auth/AuthContext";

interface WelcomeSetupDashboardProps {
  onAddPatients: () => void;
  onStartFirstConsultation: () => void;
  onAddStaff?: () => void;
  hasPatients: boolean;
  hasSelectedPatient: boolean;
}

export const WelcomeSetupDashboard: React.FC<WelcomeSetupDashboardProps> = ({
  onAddPatients,
  onStartFirstConsultation,
  onAddStaff,
  hasPatients,
  hasSelectedPatient,
}) => {
  const { user } = useAuth();
  const clinic = user?.clinicName || "your practice";
  const showStaff = user?.practiceType === "polyclinic";
  const consultNeedsPatient = !hasSelectedPatient;

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
              Register a patient first, then open a consultation. Records are saved to your clinic and survive refresh.
            </p>
          </div>
        </div>

        <div className={`grid grid-cols-1 ${showStaff ? "md:grid-cols-2" : "md:grid-cols-2"} gap-4`}>
          <button
            type="button"
            onClick={onStartFirstConsultation}
            className="text-left p-5 rounded-xl border-2 border-blue-200 bg-blue-50 hover:border-blue-400 hover:bg-blue-100 transition-colors"
          >
            <Stethoscope className="w-6 h-6 text-blue-700 mb-3" />
            <div className="text-base font-bold text-slate-900">Start First Consultation</div>
            <p className="text-xs text-slate-600 mt-1">
              {consultNeedsPatient
                ? "No patient is selected yet. We'll take you to OPD Reception to add the first chart, then open Smart Rx."
                : "Open Smart Rx Studio for the selected patient."}
            </p>
          </button>

          <button
            type="button"
            onClick={onAddPatients}
            className="text-left p-5 rounded-xl border border-slate-200 bg-slate-50 hover:border-slate-400 transition-colors"
          >
            <UserPlus className="w-6 h-6 text-slate-700 mb-3" />
            <div className="text-base font-bold text-slate-900">Add Patients</div>
            <p className="text-xs text-slate-600 mt-1">
              {hasPatients
                ? "Register another walk-in at OPD Reception. Saved patients stay in this clinic after refresh."
                : "Open OPD Reception and register your first patient. Saving writes to your clinic record — not a demo queue."}
            </p>
          </button>

          {showStaff && onAddStaff && (
            <button
              type="button"
              onClick={onAddStaff}
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

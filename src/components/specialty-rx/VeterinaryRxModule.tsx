import React from "react";
import { PawPrint } from "lucide-react";
import { ImmunizationChartPanel } from "../immunization/ImmunizationChart";

/**
 * Veterinary consult module. The animal is the patient. Species and breed
 * are fields on that record. The owner is the existing guardian contact.
 */
export const VeterinaryRxModule: React.FC<{
  patientId?: string;
  canRecord?: boolean;
}> = ({ patientId, canRecord = false }) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6 min-w-0">
      <div className="bg-gradient-to-r from-amber-900 via-stone-900 to-slate-900 text-white p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-200">
            <PawPrint className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-200 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-500/30">
              Veterinary practice
            </span>
            <h3 className="text-base font-bold text-white tracking-tight break-words">
              Dog and cat immunization chart
            </h3>
          </div>
        </div>
      </div>
      <div className="p-4 bg-slate-50/50">
        {patientId ? (
          <ImmunizationChartPanel patientId={patientId} audience="veterinary" canRecord={canRecord} />
        ) : (
          <p className="text-sm text-slate-600">Open a patient to compute the chart from the date of birth.</p>
        )}
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { Baby, Calculator, Syringe, Sparkles, CheckCircle2 } from 'lucide-react';
import { PediatricAssessment } from '../../types';

interface PediatricsRxModuleProps {
  assessment: PediatricAssessment;
  patientAge: number;
  patientWeight?: number;
  onUpdateAssessment: (assessment: PediatricAssessment) => void;
}

export const PediatricsRxModule: React.FC<PediatricsRxModuleProps> = ({
  assessment,
  patientAge,
  patientWeight = 12,
  onUpdateAssessment
}) => {
  const [weightKg, setWeightKg] = useState<number>(patientWeight || 12);
  const [selectedDrug, setSelectedDrug] = useState<'Paracetamol' | 'Amoxicillin-Clav' | 'Ibuprofen' | 'Cetirizine'>('Paracetamol');

  // Dosage calculator computation
  const computeDosage = () => {
    switch (selectedDrug) {
      case 'Paracetamol':
        return `${(weightKg * 15).toFixed(0)} mg per dose (15 mg/kg) every 6 hours SOS. Syrup 120mg/5ml = ${( (weightKg * 15) / 24 ).toFixed(1)} ml or Syrup 250mg/5ml = ${( (weightKg * 15) / 50 ).toFixed(1)} ml`;
      case 'Amoxicillin-Clav':
        return `${(weightKg * 45).toFixed(0)} mg/day (45 mg/kg/day) divided into 2 doses = ${(weightKg * 22.5).toFixed(0)} mg twice daily after food`;
      case 'Ibuprofen':
        return `${(weightKg * 10).toFixed(0)} mg per dose (10 mg/kg) every 8 hours with milk`;
      case 'Cetirizine':
        return `${weightKg < 15 ? '2.5 mg (2.5 ml)' : '5 mg (5 ml)'} once daily at bedtime`;
      default:
        return '';
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
      <div className="bg-gradient-to-r from-emerald-900 via-teal-950 to-slate-900 text-white p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-300">
            <Baby className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                Pediatrics & Child Health
              </span>
              <span className="text-xs text-slate-300">Weight-Based Precision Dosing & Growth Tracker</span>
            </div>
            <h3 className="text-base font-bold text-white tracking-tight">
              Pediatric Dosing Calculator, Milestones & Immunization Due
            </h3>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4 bg-slate-50/50">
        {/* Weight-Based Dosage Calculator Box */}
        <div className="bg-emerald-50/80 p-4 rounded-xl border border-emerald-200 shadow-2xs">
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-bold text-emerald-900 uppercase tracking-wider flex items-center gap-1.5">
              <Calculator className="w-4 h-4 text-emerald-700" />
              Real-Time Pediatric Dosage Auto-Calculator (mg/kg basis)
            </label>
            <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300">
              Age: {patientAge} Yrs
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-600 uppercase">Child Weight (kg)</label>
              <input 
                type="number"
                step="0.5"
                value={weightKg}
                onChange={(e) => setWeightKg(parseFloat(e.target.value) || 1)}
                className="w-full px-3 py-1.5 bg-white border border-emerald-300 rounded-lg text-xs font-bold text-slate-900"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-600 uppercase">Drug to Compute</label>
              <select
                value={selectedDrug}
                onChange={(e) => setSelectedDrug(e.target.value as any)}
                className="w-full px-3 py-1.5 bg-white border border-emerald-300 rounded-lg text-xs font-semibold text-slate-900"
              >
                <option value="Paracetamol">Paracetamol Syrup (15 mg/kg)</option>
                <option value="Amoxicillin-Clav">Amox-Clav Syrup (45 mg/kg/day)</option>
                <option value="Ibuprofen">Ibuprofen Syrup (10 mg/kg)</option>
                <option value="Cetirizine">Cetirizine Syrup (Allergy)</option>
              </select>
            </div>
            <div className="sm:col-span-1 flex items-end">
              <button
                type="button"
                onClick={() => onUpdateAssessment({
                  ...assessment,
                  calculatedDosageBasis: `${selectedDrug}: ${computeDosage()}`
                })}
                className="w-full py-1.5 px-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-lg transition-colors"
              >
                + Inject into Rx
              </button>
            </div>
          </div>

          <div className="mt-2.5 p-2 bg-white/90 rounded-lg border border-emerald-200 text-xs text-emerald-950 font-medium flex items-center gap-2">
            <span className="font-bold text-emerald-800">Computed Output:</span>
            <span>{computeDosage()}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Milestones */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
              Developmental Milestones
            </label>
            <select
              value={assessment.developmentalMilestones}
              onChange={(e) => onUpdateAssessment({ ...assessment, developmentalMilestones: e.target.value as any })}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold focus:ring-1 focus:ring-emerald-500"
            >
              <option value="Age Appropriate">Age Appropriate / Normal Development</option>
              <option value="Mild Delay">Mild Delay (Language / Motor)</option>
              <option value="Needs Evaluation">Needs Detailed Developmental Evaluation</option>
            </select>
          </div>

          {/* Vaccines Due */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1 flex items-center gap-1">
              <Syringe className="w-3.5 h-3.5 text-emerald-600" />
              Immunization / Vaccines Due
            </label>
            <input 
              type="text"
              value={(assessment.immunizationsDue || []).join(', ')}
              onChange={(e) => onUpdateAssessment({
                ...assessment,
                immunizationsDue: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
              })}
              placeholder="e.g. MMR Booster, Typhoid Conjugate, Influenza Annual"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

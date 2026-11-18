import React from 'react';
import { Heart, Activity, AlertCircle, Droplets, ShieldAlert } from 'lucide-react';
import { CardiologyAssessment } from '../../types';

interface CardiologyRxModuleProps {
  assessment: CardiologyAssessment;
  onUpdateAssessment: (assessment: CardiologyAssessment) => void;
}

export const CardiologyRxModule: React.FC<CardiologyRxModuleProps> = ({
  assessment,
  onUpdateAssessment
}) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
      <div className="bg-gradient-to-r from-rose-900 via-rose-950 to-slate-900 text-white p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-rose-500/20 border border-rose-400/30 flex items-center justify-center text-rose-300">
            <Heart className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-rose-300 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-500/30">
                Cardiology Workflow
              </span>
              <span className="text-xs text-slate-300">Hemodynamics, NYHA Functional Class & Target Goals</span>
            </div>
            <h3 className="text-base font-bold text-white tracking-tight">
              Cardiac Function Assessment & Dietary Sodium/Fluid Limits
            </h3>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4 bg-slate-50/50">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* NYHA Class */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
              NYHA Functional Class
            </label>
            <select
              value={assessment.nyhaFunctionalClass}
              onChange={(e) => onUpdateAssessment({ ...assessment, nyhaFunctionalClass: e.target.value as any })}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold focus:ring-1 focus:ring-rose-500"
            >
              <option value="Class I">NYHA Class I - No limitation of physical activity</option>
              <option value="Class II">NYHA Class II - Slight limitation; comfortable at rest</option>
              <option value="Class III">NYHA Class III - Marked limitation; comfortable only at rest</option>
              <option value="Class IV">NYHA Class IV - Inability to carry on physical activity without discomfort</option>
            </select>
          </div>

          {/* Target Blood Pressure */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
              Target Resting BP
            </label>
            <input 
              type="text"
              value={assessment.targetBloodPressure}
              onChange={(e) => onUpdateAssessment({ ...assessment, targetBloodPressure: e.target.value })}
              placeholder="e.g. < 130/80 mmHg"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-rose-500"
            />
          </div>

          {/* Target Heart Rate */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
              Target Resting HR
            </label>
            <input 
              type="text"
              value={assessment.targetRestingHeartRate}
              onChange={(e) => onUpdateAssessment({ ...assessment, targetRestingHeartRate: e.target.value })}
              placeholder="e.g. 60 - 70 bpm"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-rose-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* ECG Summary */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1 flex items-center gap-1">
              <Activity className="w-3.5 h-3.5 text-rose-600" />
              12-Lead ECG Interpretation
            </label>
            <input 
              type="text"
              value={assessment.ecgSummary || ''}
              onChange={(e) => onUpdateAssessment({ ...assessment, ecgSummary: e.target.value })}
              placeholder="e.g. Normal sinus rhythm, rate 74 bpm, T-wave inversion in V4-V6"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-rose-500"
            />
          </div>

          {/* 2D Echo Summary */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1 flex items-center gap-1">
              <Heart className="w-3.5 h-3.5 text-rose-600" />
              2D Echocardiography / LVEF %
            </label>
            <input 
              type="text"
              value={assessment.echoFindings || ''}
              onChange={(e) => onUpdateAssessment({ ...assessment, echoFindings: e.target.value })}
              placeholder="e.g. LVEF 55%, Grade I Diastolic Dysfunction, No RWMA"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-rose-500"
            />
          </div>
        </div>

        {/* Sodium and Fluid Limits */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <label className="text-[11px] font-bold text-slate-600 uppercase block">Daily Sodium Limit</label>
              <div className="flex items-center gap-2">
                <input 
                  type="number"
                  step="0.5"
                  value={assessment.dailySodiumLimitGrams}
                  onChange={(e) => onUpdateAssessment({ ...assessment, dailySodiumLimitGrams: parseFloat(e.target.value) || 2 })}
                  className="w-20 px-2 py-1 bg-slate-50 border border-slate-300 rounded text-xs font-bold"
                />
                <span className="text-xs font-medium text-slate-600">Grams/day (&lt; 1 level tsp salt)</span>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center shrink-0">
              <Droplets className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <label className="text-[11px] font-bold text-slate-600 uppercase block">Daily Fluid Restriction</label>
              <div className="flex items-center gap-2">
                <input 
                  type="number"
                  step="100"
                  value={assessment.dailyFluidLimitMl || 1500}
                  onChange={(e) => onUpdateAssessment({ ...assessment, dailyFluidLimitMl: parseInt(e.target.value) || 1500 })}
                  className="w-24 px-2 py-1 bg-slate-50 border border-slate-300 rounded text-xs font-bold"
                />
                <span className="text-xs font-medium text-slate-600">mL/24 hours total fluid</span>
              </div>
            </div>
          </div>
        </div>

        {/* Indian CAD Risk Profile, Past Interventions & Antithrombotic Regimen */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-rose-600" />
            Indian Cardiovascular Risk Profile, Prior Interventions &amp; Antithrombotic Therapy
          </label>
          <div className="flex flex-wrap gap-1.5">
            {[
              'Type 2 Diabetes',
              'Hypertension',
              'Dyslipidemia (High Lp(a)/TG)',
              'Tobacco / Smokeless Gutkha',
              'Premature Family CAD (<55M/<65F)',
              'Rheumatic Valve History (RHD)',
              'CKD',
            ].map((rf) => {
              const active = (assessment.cadRiskFactors || []).includes(rf);
              return (
                <button
                  key={rf}
                  type="button"
                  onClick={() => {
                    const cur = assessment.cadRiskFactors || [];
                    const next = cur.includes(rf) ? cur.filter((x) => x !== rf) : [...cur, rf];
                    onUpdateAssessment({ ...assessment, cadRiskFactors: next });
                  }}
                  className={`px-2 py-0.5 rounded text-[11px] border transition-all ${
                    active
                      ? 'bg-rose-100 text-rose-900 border-rose-300 font-bold'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {active ? '✓ ' : ''}
                  {rf}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block">
                Past Cardiac Events / Interventions (PTCA / CABG / Valve)
              </label>
              <input
                type="text"
                value={assessment.pastCardiacInterventions || ''}
                onChange={(e) => onUpdateAssessment({ ...assessment, pastCardiacInterventions: e.target.value })}
                placeholder="e.g. DES to proximal LAD (2024) / No prior ACS"
                className="w-full mt-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block">
                Antiplatelet / Anticoagulation Status
              </label>
              <input
                type="text"
                value={assessment.antithromboticRegimen || ''}
                onChange={(e) => onUpdateAssessment({ ...assessment, antithromboticRegimen: e.target.value })}
                placeholder="e.g. DAPT (Aspirin 75mg + Clopidogrel 75mg) / Apixaban 5mg BD"
                className="w-full mt-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { Heart, Calendar, Baby, Activity, AlertCircle, CheckCircle2, ShieldCheck, Sparkles } from 'lucide-react';
import { GynecologyAssessment } from '../../types';

interface GynecologyRxModuleProps {
  assessment: GynecologyAssessment;
  onChange: (updated: GynecologyAssessment) => void;
}

export const GynecologyRxModule: React.FC<GynecologyRxModuleProps> = ({
  assessment,
  onChange,
}) => {
  // Naegele's rule calculation: LMP + 9 months + 7 days
  const handleLmpChange = (newLmp: string) => {
    if (!newLmp) {
      onChange({ ...assessment, lmpDate: newLmp });
      return;
    }
    const lmp = new Date(newLmp);
    if (isNaN(lmp.getTime())) {
      onChange({ ...assessment, lmpDate: newLmp });
      return;
    }
    // Add 280 days (40 weeks) for EDD
    const edd = new Date(lmp.getTime() + 280 * 24 * 60 * 60 * 1000);
    const eddStr = edd.toISOString().split('T')[0];

    // Calculate current gestational weeks based on current local date (2026-09-01)
    const today = new Date('2026-09-01');
    const diffDays = Math.max(0, Math.floor((today.getTime() - lmp.getTime()) / (24 * 60 * 60 * 1000)));
    const weeks = Math.floor(diffDays / 7);
    const days = diffDays % 7;

    let trimester: GynecologyAssessment['trimester'] = '1st Trimester';
    if (weeks >= 28) trimester = '3rd Trimester';
    else if (weeks >= 14) trimester = '2nd Trimester';

    onChange({
      ...assessment,
      lmpDate: newLmp,
      calculatedEdd: eddStr,
      gestationalAgeWeeks: weeks,
      gestationalAgeDays: days,
      trimester
    });
  };

  const toggleChecklist = (index: number) => {
    const list = assessment.antenatalChecklist || [];
    const updated = list.map((item, i) =>
      i === index ? { ...item, completed: !item.completed } : item
    );
    onChange({ ...assessment, antenatalChecklist: updated });
  };

  return (
    <div className="space-y-4 bg-gradient-to-br from-pink-50/50 via-white to-rose-50/40 p-4 sm:p-5 rounded-xl border border-pink-200/80 shadow-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-pink-100 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-pink-600 text-white shadow-xs">
            <Baby className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <span>Obstetrics & Antenatal Maternity Tracker</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-pink-100 text-pink-800 border border-pink-300">
                {assessment.trimester} ({assessment.gestationalAgeWeeks}w {assessment.gestationalAgeDays}d)
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              LMP-EDD Naegele calculator, fetal heart rate monitoring, fundal height, and trimester protocols
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-600">Gravida / Para:</span>
          <div className="flex items-center gap-1 bg-white border border-pink-200 rounded-md px-2 py-1 text-xs font-mono font-bold text-pink-700">
            <span>G{assessment.gravidaPara?.g || 1}</span>
            <span>P{assessment.gravidaPara?.p || 0}</span>
            <span>L{assessment.gravidaPara?.l || 0}</span>
            <span>A{assessment.gravidaPara?.a || 0}</span>
          </div>
        </div>
      </div>

      {/* LMP, EDD & Gestational Age Matrix */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border border-pink-200/70 p-3 shadow-xs">
          <label className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-pink-600" />
            LMP (Last Menstrual Period):
          </label>
          <input
            type="date"
            value={assessment.lmpDate || '2026-03-17'}
            onChange={(e) => handleLmpChange(e.target.value)}
            className="w-full text-xs font-bold text-slate-800 p-1.5 mt-1 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-pink-500"
          />
        </div>

        <div className="bg-white rounded-lg border border-pink-200/70 p-3 shadow-xs">
          <label className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-pink-600" />
            EDD (Expected Delivery Date):
          </label>
          <input
            type="date"
            value={assessment.calculatedEdd || '2026-12-22'}
            onChange={(e) => onChange({ ...assessment, calculatedEdd: e.target.value })}
            className="w-full text-xs font-bold text-pink-700 p-1.5 mt-1 bg-pink-50/60 border border-pink-200 rounded-md focus:outline-none"
          />
        </div>

        <div className="bg-white rounded-lg border border-pink-200/70 p-3 shadow-xs">
          <label className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
            <Heart className="w-3.5 h-3.5 text-rose-500" />
            Fetal Heart Rate (FHR):
          </label>
          <div className="flex items-center gap-1 mt-1">
            <input
              type="number"
              value={assessment.fetalHeartRateBpm || 144}
              onChange={(e) => onChange({ ...assessment, fetalHeartRateBpm: Number(e.target.value) })}
              className="w-20 text-xs font-bold text-slate-800 p-1.5 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-pink-500"
            />
            <span className="text-xs text-slate-500">bpm (120-160)</span>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-pink-200/70 p-3 shadow-xs">
          <label className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
            <Activity className="w-3.5 h-3.5 text-pink-600" />
            Fundal Height (FH):
          </label>
          <div className="flex items-center gap-1 mt-1">
            <input
              type="number"
              value={assessment.fundalHeightCm || 24}
              onChange={(e) => onChange({ ...assessment, fundalHeightCm: Number(e.target.value) })}
              className="w-20 text-xs font-bold text-slate-800 p-1.5 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-pink-500"
            />
            <span className="text-xs text-slate-500">cm (~GA in wks)</span>
          </div>
        </div>
      </div>

      {/* Presentation, Quickening & Antenatal Protocol Checklist */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Clinical Exam Findings */}
        <div className="bg-white rounded-lg border border-slate-200 p-3.5 space-y-3 shadow-xs">
          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
            <ShieldCheck className="w-3.5 h-3.5 text-pink-600" />
            Obstetric Physical Findings & Presentation
          </span>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-[11px] font-medium text-slate-500">Fetal Presentation:</label>
              <select
                value={assessment.presentation || 'Cephalic / Vertex'}
                onChange={(e) => onChange({ ...assessment, presentation: e.target.value as any })}
                className="w-full text-xs font-semibold text-slate-800 p-1.5 mt-1 bg-slate-50 border border-slate-200 rounded-md focus:outline-none"
              >
                <option value="Cephalic / Vertex">Cephalic / Vertex</option>
                <option value="Breech">Breech</option>
                <option value="Transverse">Transverse</option>
                <option value="Unstable">Unstable Lie</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-500">Fetal Movements (Quickening):</label>
              <button
                type="button"
                onClick={() => onChange({ ...assessment, quickeningPresent: !assessment.quickeningPresent })}
                className={`w-full text-xs font-bold p-1.5 mt-1 rounded-md border flex items-center justify-center gap-1.5 transition-all ${
                  assessment.quickeningPresent !== false
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                    : 'bg-rose-50 text-rose-700 border-rose-300'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{assessment.quickeningPresent !== false ? 'Positive (Active Kicks)' : 'Reduced Movements'}</span>
              </button>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-medium text-slate-500">High-Risk Obstetric Flags:</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {['Gestational Diabetes (GDM)', 'PIH / Preeclampsia', 'Rh Negative Mother', 'Previous LSCS', 'Advanced Maternal Age', 'Low Lying Placenta'].map((flag) => {
                const isSelected = assessment.highRiskFactors?.includes(flag);
                return (
                  <button
                    key={flag}
                    type="button"
                    onClick={() => {
                      const current = assessment.highRiskFactors || [];
                      const updated = isSelected
                        ? current.filter((f) => f !== flag)
                        : [...current, flag];
                      onChange({ ...assessment, highRiskFactors: updated });
                    }}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-all ${
                      isSelected
                        ? 'bg-rose-100 text-rose-800 border-rose-300 font-bold'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {isSelected ? '⚠️ ' : ''}{flag}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Antenatal Milestone Checklist */}
        <div className="bg-white rounded-lg border border-slate-200 p-3.5 space-y-2.5 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              Standard Antenatal Protocol Milestones
            </span>
            <span className="text-[11px] font-medium text-slate-500">
              {(assessment.antenatalChecklist || []).filter((i) => i.completed).length} / {(assessment.antenatalChecklist || []).length} Completed
            </span>
          </div>

          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
            {(assessment.antenatalChecklist || []).map((item, idx) => (
              <div
                key={idx}
                onClick={() => toggleChecklist(idx)}
                className={`flex items-center justify-between p-2 rounded-md border text-xs cursor-pointer transition-all ${
                  item.completed
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={item.completed}
                    onChange={() => {}}
                    className="rounded text-pink-600 focus:ring-pink-500 h-3.5 w-3.5 cursor-pointer"
                  />
                  <span className={`font-medium ${item.completed ? 'line-through text-slate-500' : 'text-slate-800'}`}>
                    {item.item}
                  </span>
                </div>
                {item.dueDate && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                    Due: {item.dueDate}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

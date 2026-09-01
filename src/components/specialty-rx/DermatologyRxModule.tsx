import React from 'react';
import { Sparkles, Sun, Shield, Plus, Trash2 } from 'lucide-react';
import { DermatologyAssessment } from '../../types';

interface DermatologyRxModuleProps {
  assessment: DermatologyAssessment;
  onUpdateAssessment: (assessment: DermatologyAssessment) => void;
}

export const DermatologyRxModule: React.FC<DermatologyRxModuleProps> = ({
  assessment,
  onUpdateAssessment
}) => {
  const handleAddProcedure = () => {
    const currentProcs = assessment.inClinicProceduresPerformed || [];
    onUpdateAssessment({
      ...assessment,
      inClinicProceduresPerformed: [
        ...currentProcs,
        {
          procedureName: 'Chemical Peel / Extraction / Intralesional TAC',
          area: 'Facial malar region',
          notes: 'Well tolerated without complications'
        }
      ]
    });
  };

  const handleRemoveProcedure = (index: number) => {
    const currentProcs = assessment.inClinicProceduresPerformed || [];
    onUpdateAssessment({
      ...assessment,
      inClinicProceduresPerformed: currentProcs.filter((_, i) => i !== index)
    });
  };

  const handleUpdateProcedure = (index: number, field: string, value: string) => {
    const currentProcs = [...(assessment.inClinicProceduresPerformed || [])];
    currentProcs[index] = { ...currentProcs[index], [field]: value };
    onUpdateAssessment({
      ...assessment,
      inClinicProceduresPerformed: currentProcs
    });
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
      <div className="bg-gradient-to-r from-purple-900 via-purple-950 to-slate-900 text-white p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-500/20 border border-purple-400/30 flex items-center justify-center text-purple-300">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-purple-300 bg-purple-950/60 px-2 py-0.5 rounded border border-purple-500/30">
                Dermatology & Cosmetology
              </span>
              <span className="text-xs text-slate-300">Fitzpatrick Skin Phototyping & Lesion Topography</span>
            </div>
            <h3 className="text-base font-bold text-white tracking-tight">
              Skin Examination, In-Clinic Dermato-Procedures & Photoprotection
            </h3>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4 bg-slate-50/50">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Fitzpatrick Phototype */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
              Fitzpatrick Skin Phototype
            </label>
            <select
              value={assessment.fitzpatrickSkinType}
              onChange={(e) => onUpdateAssessment({ ...assessment, fitzpatrickSkinType: e.target.value as any })}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold focus:ring-1 focus:ring-purple-500"
            >
              <option value="Type I">Type I - Always burns, never tans (Pale/Freckles)</option>
              <option value="Type II">Type II - Burns easily, tans minimally</option>
              <option value="Type III">Type III - Sometimes mild burn, tans gradually</option>
              <option value="Type IV">Type IV - Burns minimally, tans easily (Olive/Indian)</option>
              <option value="Type V">Type V - Rarely burns, tans darkly (Brown skin)</option>
              <option value="Type VI">Type VI - Never burns, deeply pigmented</option>
            </select>
          </div>

          {/* Lesion Distribution */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs md:col-span-2">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
              Lesion Morphology & Topographical Distribution
            </label>
            <input 
              type="text"
              value={assessment.distribution}
              onChange={(e) => onUpdateAssessment({ ...assessment, distribution: e.target.value })}
              placeholder="e.g. Centromial facial distribution, cheeks and forehead with inflammatory papules"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-purple-500"
            />
          </div>
        </div>

        {/* In-Clinic Dermato Procedures */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-purple-600" />
              In-Clinic Dermato-Surgical Procedures Performed Today
            </label>
            <button
              type="button"
              onClick={handleAddProcedure}
              className="px-2.5 py-1 text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200"
            >
              + Add Dermato-Procedure
            </button>
          </div>

          {(assessment.inClinicProceduresPerformed || []).length === 0 ? (
            <p className="text-xs text-slate-400 italic">No in-clinic procedures performed (chemical peel, comedone extraction, cryotherapy, or ILS)</p>
          ) : (
            <div className="space-y-2">
              {(assessment.inClinicProceduresPerformed || []).map((proc, idx) => (
                <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2 p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs items-center">
                  <div className="md:col-span-4">
                    <input 
                      type="text" 
                      value={proc.procedureName}
                      onChange={(e) => handleUpdateProcedure(idx, 'procedureName', e.target.value)}
                      placeholder="Procedure Name"
                      className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <input 
                      type="text" 
                      value={proc.area}
                      onChange={(e) => handleUpdateProcedure(idx, 'area', e.target.value)}
                      placeholder="Anatomical Area"
                      className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                    />
                  </div>
                  <div className="md:col-span-4">
                    <input 
                      type="text" 
                      value={proc.notes}
                      onChange={(e) => handleUpdateProcedure(idx, 'notes', e.target.value)}
                      placeholder="Outcome & Tolerance"
                      className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                    />
                  </div>
                  <div className="md:col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleRemoveProcedure(idx)}
                      className="p-1 text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sun Protection Advice */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
            <Sun className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <label className="text-[11px] font-bold text-slate-600 uppercase block">Sunscreen & Photoprotection Directives</label>
            <input 
              type="text"
              value={assessment.sunProtectionAdvice}
              onChange={(e) => onUpdateAssessment({ ...assessment, sunProtectionAdvice: e.target.value })}
              placeholder="e.g. Broad spectrum SPF 50+ Gel 20 mins before sun exposure, reapply every 3 hrs"
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

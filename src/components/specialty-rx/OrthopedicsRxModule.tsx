import React from 'react';
import { Bone, Shield, Activity, FileText } from 'lucide-react';
import { OrthopedicAssessment } from '../../types';

interface OrthopedicsRxModuleProps {
  assessment: OrthopedicAssessment;
  onUpdateAssessment: (assessment: OrthopedicAssessment) => void;
}

export const OrthopedicsRxModule: React.FC<OrthopedicsRxModuleProps> = ({
  assessment,
  onUpdateAssessment
}) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
      <div className="bg-gradient-to-r from-indigo-900 via-indigo-950 to-slate-900 text-white p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
            <Bone className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300 bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-500/30">
                Orthopedics & Traumatology
              </span>
              <span className="text-xs text-slate-300">Joint Biomechanics, Weight Bearing & Splint Directives</span>
            </div>
            <h3 className="text-base font-bold text-white tracking-tight">
              Musculoskeletal Evaluation, Radiologic Findings & Joint Infiltration
            </h3>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4 bg-slate-50/50">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Affected Joint */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
              Affected Joint / Limb
            </label>
            <input 
              type="text"
              value={assessment.affectedJointLimb}
              onChange={(e) => onUpdateAssessment({ ...assessment, affectedJointLimb: e.target.value })}
              placeholder="e.g. Right Knee / Left Ankle"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Weight Bearing Status */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
              Prescribed Weight-Bearing Status
            </label>
            <select
              value={assessment.weightBearingStatus}
              onChange={(e) => onUpdateAssessment({ ...assessment, weightBearingStatus: e.target.value as any })}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold focus:ring-1 focus:ring-indigo-500"
            >
              <option value="Full Weight Bearing (FWB)">Full Weight Bearing (FWB)</option>
              <option value="Partial Weight Bearing (PWB)">Partial Weight Bearing (PWB with stick/crutches)</option>
              <option value="Non-Weight Bearing (NWB)">Non-Weight Bearing (NWB - Strict)</option>
              <option value="Touch Down Weight Bearing">Touch Down Weight Bearing</option>
            </select>
          </div>

          {/* Splint or Brace Applied */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
              Splint / Brace / POP Slab
            </label>
            <input 
              type="text"
              value={assessment.splintOrBraceApplied || ''}
              onChange={(e) => onUpdateAssessment({ ...assessment, splintOrBraceApplied: e.target.value })}
              placeholder="e.g. Hinged Knee Brace with 30° flexion stop"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* X-Ray Findings */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-indigo-600" />
              Radiological / X-Ray Findings Summary
            </label>
            <input 
              type="text"
              value={assessment.xrayFindingsSummary || ''}
              onChange={(e) => onUpdateAssessment({ ...assessment, xrayFindingsSummary: e.target.value })}
              placeholder="e.g. Medial joint space narrowing, subchondral sclerosis, Kellgren-Lawrence Grade II"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Joint Infiltration */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1 flex items-center gap-1">
              <Shield className="w-3.5 h-3.5 text-indigo-600" />
              In-Clinic Intra-Articular Infiltration / Aspiration
            </label>
            <input 
              type="text"
              value={assessment.inClinicInfiltration || ''}
              onChange={(e) => onUpdateAssessment({ ...assessment, inClinicInfiltration: e.target.value })}
              placeholder="e.g. Intra-articular Hyaluronic Acid 2ml injected under sterile technique"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

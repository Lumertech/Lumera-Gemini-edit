import React from 'react';
import { Brain, Activity, Zap } from 'lucide-react';
import { NeurologyAssessment } from '../../types';

interface NeurologyRxModuleProps {
  assessment: NeurologyAssessment;
  onChange: (updated: NeurologyAssessment) => void;
}

export const NeurologyRxModule: React.FC<NeurologyRxModuleProps> = ({ assessment, onChange }) => {
  return (
    <div
      data-testid="neurology-rx-module"
      className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6"
    >
      <div className="bg-gradient-to-r from-violet-900 via-indigo-950 to-slate-900 text-white p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-violet-500/20 border border-violet-400/30 flex items-center justify-center text-violet-300">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-violet-300 bg-violet-950/60 px-2 py-0.5 rounded border border-violet-500/30">
                Neurology Clinical Exam
              </span>
              <span className="text-xs text-slate-300">Higher Mental, Cranial Nerves, Motor/Sensory &amp; Seizure/Migraine Log</span>
            </div>
            <h3 className="text-base font-bold text-white tracking-tight">
              Structured Neurological Localization, Episode Semiology &amp; Neuroimaging
            </h3>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4 bg-slate-50/50 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">Syndrome Category</label>
            <select
              value={assessment.symptomCategory || 'Headache / Migraine'}
              onChange={(e) => onChange({ ...assessment, symptomCategory: e.target.value as any })}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-semibold"
            >
              <option value="Headache / Migraine">Headache / Migraine</option>
              <option value="Seizure / Epilepsy">Seizure / Epilepsy</option>
              <option value="Stroke / TIA">Stroke / TIA Follow-up</option>
              <option value="Neuropathy / Spine">Peripheral Neuropathy / Radiculopathy</option>
              <option value="Movement / Memory">Movement Disorder / Cognitive</option>
            </select>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">Temporal Onset</label>
            <select
              value={assessment.onsetCourse || 'Chronic / Episodic'}
              onChange={(e) => onChange({ ...assessment, onsetCourse: e.target.value as any })}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-semibold"
            >
              <option value="Hyperacute (<6h)">Hyperacute (&lt;6h — Stroke Alert)</option>
              <option value="Acute (Days)">Acute (Days)</option>
              <option value="Subacute (Weeks)">Subacute (Weeks)</option>
              <option value="Chronic / Episodic">Chronic / Episodic</option>
            </select>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-[11px] font-bold text-slate-700 uppercase flex items-center gap-1 mb-1">
              <Zap className="w-3.5 h-3.5 text-violet-600" />
              Episode Frequency &amp; Triggers
            </label>
            <input
              type="text"
              value={assessment.episodeFrequencyTriggers || ''}
              onChange={(e) => onChange({ ...assessment, episodeFrequencyTriggers: e.target.value })}
              placeholder="e.g. 4 migraine days/mo, triggered by fasting & travel"
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">
              Higher Mental Functions &amp; Cranial Nerves (II–XII)
            </label>
            <input
              type="text"
              value={assessment.cranialNervesSummary || ''}
              onChange={(e) => onChange({ ...assessment, cranialNervesSummary: e.target.value })}
              placeholder="e.g. GCS 15/15, speech fluent, pupils PERL, EOM full, no facial asymmetry"
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-[11px] font-bold text-slate-700 uppercase flex items-center gap-1 mb-1">
              <Activity className="w-3.5 h-3.5 text-violet-600" />
              Motor Power, Reflexes, Sensory &amp; Plantars
            </label>
            <input
              type="text"
              value={assessment.motorSensorySummary || ''}
              onChange={(e) => onChange({ ...assessment, motorSensorySummary: e.target.value })}
              placeholder="e.g. Power 5/5 all 4 limbs, DTRs 2+ symmetric, plantars bilateral flexor"
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">Gait, Romberg &amp; Cerebellar</label>
            <input
              type="text"
              value={assessment.gaitAndCerebellar || ''}
              onChange={(e) => onChange({ ...assessment, gaitAndCerebellar: e.target.value })}
              placeholder="e.g. Normal tandem gait, Romberg negative, no dysmetria/nystagmus"
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">
              MRI / CT Brain / EEG / NCV Summary
            </label>
            <input
              type="text"
              value={assessment.neuroimagingEegSummary || ''}
              onChange={(e) => onChange({ ...assessment, neuroimagingEegSummary: e.target.value })}
              placeholder="e.g. MRI Brain normal / Awake EEG no epileptiform discharges"
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
            />
          </div>
        </div>
      </div>
    </div>
  );
};


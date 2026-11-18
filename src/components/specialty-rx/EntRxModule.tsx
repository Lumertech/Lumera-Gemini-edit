import React from 'react';
import { Ear, Activity, ShieldAlert, Stethoscope } from 'lucide-react';
import { EntAssessment } from '../../types';

interface EntRxModuleProps {
  assessment: EntAssessment;
  onChange: (updated: EntAssessment) => void;
}

export const EntRxModule: React.FC<EntRxModuleProps> = ({ assessment, onChange }) => {
  return (
    <div
      data-testid="ent-rx-module"
      className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6"
    >
      <div className="bg-gradient-to-r from-sky-900 via-cyan-950 to-slate-900 text-white p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-sky-300">
            <Ear className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-sky-300 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-500/30">
                ENT &amp; Head-Neck Otorhinolaryngology
              </span>
              <span className="text-xs text-slate-300">Otoscopy, Rhinoscopy, Tuning Fork, PTA &amp; OSMF Screen</span>
            </div>
            <h3 className="text-base font-bold text-white tracking-tight">
              Ear, Nose, Throat, Vertigo &amp; Oral Mucosal Examination
            </h3>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4 bg-slate-50/50 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">Primary Focus</label>
            <select
              value={assessment.primarySite || 'Ear / Otology'}
              onChange={(e) => onChange({ ...assessment, primarySite: e.target.value as any })}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-semibold"
            >
              <option value="Ear / Otology">Ear / Otology (CSOM / ASOM / Hearing)</option>
              <option value="Nose & PNS">Nose &amp; Paranasal Sinuses (DNS / Rhinitis)</option>
              <option value="Throat & Larynx">Throat, Tonsils &amp; Larynx</option>
              <option value="Head, Neck & Vertigo">Vertigo (BPPV) &amp; Head-Neck</option>
            </select>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">Otoscopy — Right Ear (AD)</label>
            <input
              type="text"
              value={assessment.otoscopyRight || ''}
              onChange={(e) => onChange({ ...assessment, otoscopyRight: e.target.value })}
              placeholder="e.g. EAC clear, TM intact with cone of light / Central perforation"
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">Otoscopy — Left Ear (AS)</label>
            <input
              type="text"
              value={assessment.otoscopyLeft || ''}
              onChange={(e) => onChange({ ...assessment, otoscopyLeft: e.target.value })}
              placeholder="e.g. EAC clear, TM intact & mobile"
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-[11px] font-bold text-slate-700 uppercase flex items-center gap-1 mb-1">
              <Activity className="w-3.5 h-3.5 text-sky-600" />
              Tuning Fork (512 Hz Rinne / Weber)
            </label>
            <input
              type="text"
              value={assessment.tuningForkRinneWeber || ''}
              onChange={(e) => onChange({ ...assessment, tuningForkRinneWeber: e.target.value })}
              placeholder="e.g. Rinne AC > BC B/L; Weber central"
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-[11px] font-bold text-slate-700 uppercase flex items-center gap-1 mb-1">
              <Stethoscope className="w-3.5 h-3.5 text-sky-600" />
              Anterior Rhinoscopy &amp; PNS
            </label>
            <input
              type="text"
              value={assessment.anteriorRhinoscopyDns || ''}
              onChange={(e) => onChange({ ...assessment, anteriorRhinoscopyDns: e.target.value })}
              placeholder="e.g. Mild DNS to left, pale boggy inferior turbinates, no sinus tenderness"
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">
              Oropharynx &amp; Brodsky Tonsil Grade
            </label>
            <select
              value={assessment.oropharynxTonsilGrade || 'Grade I'}
              onChange={(e) => onChange({ ...assessment, oropharynxTonsilGrade: e.target.value as any })}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-semibold"
            >
              <option value="Grade I">Grade I (&lt;25% airway, normal pillars)</option>
              <option value="Grade II">Grade II (25–50% airway)</option>
              <option value="Grade III">Grade III (50–75% enlargement / congestion)</option>
              <option value="Grade IV">Grade IV (&gt;75% kissing tonsils)</option>
              <option value="Post-Tonsillectomy">Post-Tonsillectomy Fossae Healed</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-[11px] font-bold text-slate-700 uppercase flex items-center gap-1 mb-1">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
              Oral Mucosa &amp; OSMF Check (India Screen)
            </label>
            <input
              type="text"
              value={assessment.oralMucosaSubmucousCheck || ''}
              onChange={(e) => onChange({ ...assessment, oralMucosaSubmucousCheck: e.target.value })}
              placeholder="e.g. Buccal mucosa supple, mouth opening >40mm, no fibrous bands/leukoplakia"
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">
              PTA / Tympanometry / DNE / IDL Notes
            </label>
            <input
              type="text"
              value={assessment.audiometryOrEndoscopyNotes || ''}
              onChange={(e) => onChange({ ...assessment, audiometryOrEndoscopyNotes: e.target.value })}
              placeholder="e.g. PTA: 28 dB mild conductive loss right ear; Type B/C tympanogram"
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">
              Vestibular / Dix-Hallpike &amp; Epley
            </label>
            <input
              type="text"
              value={assessment.vertigoDixHallpike || ''}
              onChange={(e) => onChange({ ...assessment, vertigoDixHallpike: e.target.value })}
              placeholder="e.g. Dix-Hallpike negative / Right posterior canal BPPV — Epley performed"
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
            />
          </div>
        </div>
      </div>
    </div>
  );
};


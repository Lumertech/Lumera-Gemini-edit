import React from 'react';
import { Eye, Glasses, Scan, Compass, ShieldAlert, Sparkles, CheckCircle2 } from 'lucide-react';
import { OphthalmologyAssessment } from '../../types';

interface OphthalmologyRxModuleProps {
  assessment: OphthalmologyAssessment;
  onChange: (updated: OphthalmologyAssessment) => void;
}

export const OphthalmologyRxModule: React.FC<OphthalmologyRxModuleProps> = ({
  assessment,
  onChange,
}) => {
  const updateRefraction = (
    eye: 'OD' | 'OS',
    field: 'sphere' | 'cyl' | 'axis' | 'add',
    val: string
  ) => {
    if (eye === 'OD') {
      onChange({
        ...assessment,
        refractionOD: { ...assessment.refractionOD, [field]: val }
      });
    } else {
      onChange({
        ...assessment,
        refractionOS: { ...assessment.refractionOS, [field]: val }
      });
    }
  };

  return (
    <div className="space-y-4 bg-gradient-to-br from-teal-50/50 via-white to-blue-50/40 p-4 sm:p-5 rounded-xl border border-teal-200/80 shadow-xs">
      {/* Module Title */}
      <div className="flex items-center justify-between border-b border-teal-100 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-teal-600 text-white shadow-xs">
            <Eye className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <span>Ophthalmology & Optometry Refraction Suite</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-800 border border-teal-300/80">
                Snellen & Goldmann IOP
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              Refraction power matrix, intraocular pressure (IOP), slit lamp biomicroscopy, and fundus exam
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-slate-500">PD (Pupillary Distance):</span>
          <div className="flex items-center gap-1 bg-white border border-teal-200 rounded-md px-2 py-1">
            <input
              type="number"
              value={assessment.pupillaryDistanceMm || 63}
              onChange={(e) => onChange({ ...assessment, pupillaryDistanceMm: Number(e.target.value) })}
              className="w-12 text-center text-xs font-bold text-teal-800 focus:outline-none"
            />
            <span className="text-[11px] text-slate-400">mm</span>
          </div>
        </div>
      </div>

      {/* Refraction & Visual Acuity Grid (OD Right Eye vs OS Left Eye) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Right Eye (OD - Oculus Dexter) */}
        <div className="bg-white rounded-lg border border-slate-200 p-3.5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="font-bold text-xs text-teal-900 flex items-center gap-1.5">
              <Glasses className="w-3.5 h-3.5 text-teal-600" />
              OD (Right Eye / Oculus Dexter)
            </span>
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] text-slate-500 font-medium">Visual Acuity:</label>
              <input
                type="text"
                value={assessment.visualAcuityOD || '6/6'}
                onChange={(e) => onChange({ ...assessment, visualAcuityOD: e.target.value })}
                placeholder="6/18 -> 6/6"
                className="text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-200 rounded px-2 py-0.5 w-28 focus:outline-none focus:border-teal-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500">Sphere (SPH)</span>
              <input
                type="text"
                value={assessment.refractionOD?.sphere || '-1.75'}
                onChange={(e) => updateRefraction('OD', 'sphere', e.target.value)}
                className="w-full text-center font-mono font-bold text-xs bg-slate-50 border border-slate-200 rounded py-1 mt-1 text-slate-800 focus:outline-none focus:border-teal-500"
              />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500">Cylinder (CYL)</span>
              <input
                type="text"
                value={assessment.refractionOD?.cyl || '-0.75'}
                onChange={(e) => updateRefraction('OD', 'cyl', e.target.value)}
                className="w-full text-center font-mono font-bold text-xs bg-slate-50 border border-slate-200 rounded py-1 mt-1 text-slate-800 focus:outline-none focus:border-teal-500"
              />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500">Axis (AX)</span>
              <input
                type="text"
                value={assessment.refractionOD?.axis || '90°'}
                onChange={(e) => updateRefraction('OD', 'axis', e.target.value)}
                className="w-full text-center font-mono font-bold text-xs bg-slate-50 border border-slate-200 rounded py-1 mt-1 text-slate-800 focus:outline-none focus:border-teal-500"
              />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500">Near Add (ADD)</span>
              <input
                type="text"
                value={assessment.refractionOD?.add || '+0.00'}
                onChange={(e) => updateRefraction('OD', 'add', e.target.value)}
                className="w-full text-center font-mono font-bold text-xs bg-slate-50 border border-slate-200 rounded py-1 mt-1 text-slate-800 focus:outline-none focus:border-teal-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 text-xs">
            <span className="text-slate-600 flex items-center gap-1">
              <Scan className="w-3.5 h-3.5 text-teal-600" />
              IOP (Tonometry):
            </span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={assessment.iopOD || 15}
                onChange={(e) => onChange({ ...assessment, iopOD: Number(e.target.value) })}
                className="w-14 text-center font-bold text-xs bg-slate-50 border border-slate-200 rounded py-0.5 text-slate-800 focus:outline-none"
              />
              <span className="text-[11px] text-slate-500">mmHg</span>
              <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${assessment.iopOD > 21 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {assessment.iopOD > 21 ? 'Elevated' : 'Normal (10-21)'}
              </span>
            </div>
          </div>
        </div>

        {/* Left Eye (OS - Oculus Sinister) */}
        <div className="bg-white rounded-lg border border-slate-200 p-3.5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="font-bold text-xs text-teal-900 flex items-center gap-1.5">
              <Glasses className="w-3.5 h-3.5 text-teal-600" />
              OS (Left Eye / Oculus Sinister)
            </span>
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] text-slate-500 font-medium">Visual Acuity:</label>
              <input
                type="text"
                value={assessment.visualAcuityOS || '6/6'}
                onChange={(e) => onChange({ ...assessment, visualAcuityOS: e.target.value })}
                placeholder="6/24 -> 6/6"
                className="text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-200 rounded px-2 py-0.5 w-28 focus:outline-none focus:border-teal-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500">Sphere (SPH)</span>
              <input
                type="text"
                value={assessment.refractionOS?.sphere || '-2.25'}
                onChange={(e) => updateRefraction('OS', 'sphere', e.target.value)}
                className="w-full text-center font-mono font-bold text-xs bg-slate-50 border border-slate-200 rounded py-1 mt-1 text-slate-800 focus:outline-none focus:border-teal-500"
              />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500">Cylinder (CYL)</span>
              <input
                type="text"
                value={assessment.refractionOS?.cyl || '-1.00'}
                onChange={(e) => updateRefraction('OS', 'cyl', e.target.value)}
                className="w-full text-center font-mono font-bold text-xs bg-slate-50 border border-slate-200 rounded py-1 mt-1 text-slate-800 focus:outline-none focus:border-teal-500"
              />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500">Axis (AX)</span>
              <input
                type="text"
                value={assessment.refractionOS?.axis || '85°'}
                onChange={(e) => updateRefraction('OS', 'axis', e.target.value)}
                className="w-full text-center font-mono font-bold text-xs bg-slate-50 border border-slate-200 rounded py-1 mt-1 text-slate-800 focus:outline-none focus:border-teal-500"
              />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500">Near Add (ADD)</span>
              <input
                type="text"
                value={assessment.refractionOS?.add || '+0.00'}
                onChange={(e) => updateRefraction('OS', 'add', e.target.value)}
                className="w-full text-center font-mono font-bold text-xs bg-slate-50 border border-slate-200 rounded py-1 mt-1 text-slate-800 focus:outline-none focus:border-teal-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 text-xs">
            <span className="text-slate-600 flex items-center gap-1">
              <Scan className="w-3.5 h-3.5 text-teal-600" />
              IOP (Tonometry):
            </span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={assessment.iopOS || 16}
                onChange={(e) => onChange({ ...assessment, iopOS: Number(e.target.value) })}
                className="w-14 text-center font-bold text-xs bg-slate-50 border border-slate-200 rounded py-0.5 text-slate-800 focus:outline-none"
              />
              <span className="text-[11px] text-slate-500">mmHg</span>
              <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${assessment.iopOS > 21 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {assessment.iopOS > 21 ? 'Elevated' : 'Normal (10-21)'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Slit Lamp Biomicroscopy & Fundus Exam */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-1.5">
          <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-teal-600" />
            Anterior Segment (Slit Lamp Findings)
          </label>
          <textarea
            rows={2}
            value={assessment.anteriorSegment || ''}
            onChange={(e) => onChange({ ...assessment, anteriorSegment: e.target.value })}
            placeholder="Cornea clear, anterior chamber deep & quiet, iris normal, crystalline lens clear..."
            className="w-full text-xs text-slate-800 p-2 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-teal-500"
          />
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-teal-600" />
              Posterior Segment & Fundus Exam
            </label>
            <div className="text-[11px] font-medium text-slate-500">
              C:D Ratio OD/OS: <span className="font-bold text-slate-800">{assessment.fundusExam?.cupToDiscRatioOD || '0.3'} / {assessment.fundusExam?.cupToDiscRatioOS || '0.3'}</span>
            </div>
          </div>
          <textarea
            rows={2}
            value={assessment.fundusExam?.retinaFindings || ''}
            onChange={(e) => onChange({
              ...assessment,
              fundusExam: {
                ...assessment.fundusExam,
                retinaFindings: e.target.value
              }
            })}
            placeholder="Disc pink with distinct margins. Macula normal with foveal reflex. No diabetic retinopathy or hypertensive vascular changes..."
            className="w-full text-xs text-slate-800 p-2 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-teal-500"
          />
        </div>
      </div>
    </div>
  );
};

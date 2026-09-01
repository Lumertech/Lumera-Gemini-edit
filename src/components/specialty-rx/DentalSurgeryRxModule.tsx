import React, { useState } from 'react';
import { Smile, Wrench, AlertTriangle, Plus, Trash2, CheckCircle2, Shield } from 'lucide-react';
import { DentalAssessment, DentalToothCondition } from '../../types';

interface DentalSurgeryRxModuleProps {
  assessment: DentalAssessment;
  onChange: (updated: DentalAssessment) => void;
}

// FDI 2-digit tooth numbering system:
// Upper Right (18-11), Upper Left (21-28)
// Lower Left (38-31), Lower Right (41-48)
const UPPER_TEETH = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER_TEETH = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

const CONDITION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Healthy: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  Caries: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-400' },
  Restored: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' },
  'Root Canal': { bg: 'bg-rose-100', text: 'text-rose-800', border: 'border-rose-400' },
  Missing: { bg: 'bg-slate-200', text: 'text-slate-600', border: 'border-slate-400' },
  Crown: { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-300' },
  'Extraction Needed': { bg: 'bg-red-200', text: 'text-red-900', border: 'border-red-500' }
};

export const DentalSurgeryRxModule: React.FC<DentalSurgeryRxModuleProps> = ({
  assessment,
  onChange,
}) => {
  const [selectedTooth, setSelectedTooth] = useState<number>(36);
  const [newProcName, setNewProcName] = useState('');
  const [newProcCost, setNewProcCost] = useState(1500);

  const currentCondition: DentalToothCondition = assessment.teethStatus[selectedTooth] || {
    condition: 'Healthy',
    notes: ''
  };

  const handleSetToothCondition = (condition: DentalToothCondition['condition']) => {
    const updatedStatus = {
      ...assessment.teethStatus,
      [selectedTooth]: {
        ...currentCondition,
        condition
      }
    };
    onChange({ ...assessment, teethStatus: updatedStatus });
  };

  const handleSetToothNotes = (notes: string) => {
    const updatedStatus = {
      ...assessment.teethStatus,
      [selectedTooth]: {
        ...currentCondition,
        notes
      }
    };
    onChange({ ...assessment, teethStatus: updatedStatus });
  };

  const handleAddProcedure = () => {
    if (!newProcName.trim()) return;
    const updatedProc = [
      ...assessment.plannedProcedures,
      {
        toothNumber: selectedTooth,
        procedure: newProcName,
        estimatedCost: newProcCost,
        status: 'Planned' as const
      }
    ];
    onChange({ ...assessment, plannedProcedures: updatedProc });
    setNewProcName('');
  };

  const handleRemoveProcedure = (index: number) => {
    const updatedProc = assessment.plannedProcedures.filter((_, i) => i !== index);
    onChange({ ...assessment, plannedProcedures: updatedProc });
  };

  return (
    <div className="space-y-4 bg-gradient-to-br from-amber-50/50 via-white to-cyan-50/40 p-4 sm:p-5 rounded-xl border border-amber-200/80 shadow-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-amber-100 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-amber-600 text-white shadow-xs">
            <Smile className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <span>Interactive Dental Charting & Odontogram</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                32-Tooth FDI System
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              Select any tooth to mark caries, restorations, endodontics, or schedule surgical extractions
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-md px-2 py-1">
            <span className="text-slate-500 font-medium">Periodontal:</span>
            <select
              value={assessment.periodontalStatus || 'Healthy'}
              onChange={(e) => onChange({ ...assessment, periodontalStatus: e.target.value as any })}
              className="font-bold text-slate-800 focus:outline-none bg-transparent cursor-pointer"
            >
              <option value="Healthy">Healthy</option>
              <option value="Gingivitis">Gingivitis</option>
              <option value="Moderate Periodontitis">Moderate Periodontitis</option>
              <option value="Severe Bone Loss">Severe Bone Loss</option>
            </select>
          </div>
        </div>
      </div>

      {/* 32-Tooth Interactive Odontogram Arch */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 shadow-xs">
        <div className="flex items-center justify-between text-xs text-slate-500 font-semibold px-2">
          <span>Maxillary (Upper Arch)</span>
          <span className="text-[11px] text-slate-400">Click tooth number to view or edit status</span>
          <span>Maxillary (Upper Arch)</span>
        </div>

        {/* Upper Arch Buttons */}
        <div className="grid grid-cols-16 gap-1 sm:gap-1.5 overflow-x-auto pb-1">
          {UPPER_TEETH.map((tooth) => {
            const status = assessment.teethStatus[tooth]?.condition || 'Healthy';
            const colors = CONDITION_COLORS[status] || CONDITION_COLORS.Healthy;
            const isSelected = selectedTooth === tooth;

            return (
              <button
                key={tooth}
                type="button"
                onClick={() => setSelectedTooth(tooth)}
                className={`flex flex-col items-center justify-center p-1.5 rounded-lg border text-center transition-all ${
                  isSelected ? 'ring-2 ring-amber-500 ring-offset-1 scale-105' : 'hover:scale-102'
                } ${colors.bg} ${colors.border}`}
                title={`Tooth #${tooth} - ${status}`}
              >
                <span className={`text-[11px] font-bold ${colors.text}`}>#{tooth}</span>
                <span className="text-[9px] font-medium text-slate-600 truncate max-w-[38px] block">
                  {status === 'Healthy' ? 'OK' : status.slice(0, 4)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="h-px bg-slate-100 my-1"></div>

        {/* Lower Arch Buttons */}
        <div className="grid grid-cols-16 gap-1 sm:gap-1.5 overflow-x-auto pb-1">
          {LOWER_TEETH.map((tooth) => {
            const status = assessment.teethStatus[tooth]?.condition || 'Healthy';
            const colors = CONDITION_COLORS[status] || CONDITION_COLORS.Healthy;
            const isSelected = selectedTooth === tooth;

            return (
              <button
                key={tooth}
                type="button"
                onClick={() => setSelectedTooth(tooth)}
                className={`flex flex-col items-center justify-center p-1.5 rounded-lg border text-center transition-all ${
                  isSelected ? 'ring-2 ring-amber-500 ring-offset-1 scale-105' : 'hover:scale-102'
                } ${colors.bg} ${colors.border}`}
                title={`Tooth #${tooth} - ${status}`}
              >
                <span className={`text-[11px] font-bold ${colors.text}`}>#{tooth}</span>
                <span className="text-[9px] font-medium text-slate-600 truncate max-w-[38px] block">
                  {status === 'Healthy' ? 'OK' : status.slice(0, 4)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500 font-semibold px-2">
          <span>Mandibular (Lower Arch)</span>
          <span className="text-[11px] text-slate-400">Right Quadrant (4x) &larr; &rarr; Left Quadrant (3x)</span>
          <span>Mandibular (Lower Arch)</span>
        </div>
      </div>

      {/* Selected Tooth Quick Diagnostic Editor & Procedure Plan */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Selected Tooth Diagnostic Box */}
        <div className="bg-white rounded-lg border border-amber-200 p-3.5 space-y-2.5 shadow-xs">
          <div className="flex items-center justify-between border-b border-amber-100 pb-2">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <span className="w-6 h-6 rounded-full bg-amber-600 text-white flex items-center justify-center text-xs font-bold">
                #{selectedTooth}
              </span>
              <span>Tooth #{selectedTooth} Condition & Pathology</span>
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${CONDITION_COLORS[currentCondition.condition]?.bg || 'bg-slate-100'} ${CONDITION_COLORS[currentCondition.condition]?.text || 'text-slate-800'}`}>
              {currentCondition.condition}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {(['Healthy', 'Caries', 'Restored', 'Root Canal', 'Missing', 'Crown', 'Extraction Needed'] as const).map((cond) => (
              <button
                key={cond}
                type="button"
                onClick={() => handleSetToothCondition(cond)}
                className={`px-2 py-1.5 rounded-md text-[11px] font-semibold border transition-all text-center ${
                  currentCondition.condition === cond
                    ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {cond}
              </button>
            ))}
          </div>

          <div>
            <label className="text-[11px] font-medium text-slate-500">Clinical Findings / Notes on Tooth #{selectedTooth}:</label>
            <input
              type="text"
              value={currentCondition.notes || ''}
              onChange={(e) => handleSetToothNotes(e.target.value)}
              placeholder="e.g. Deep occlusal fissure decay, cold hypersensitivity, tender on percussion..."
              className="w-full text-xs text-slate-800 p-1.5 mt-1 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>

        {/* Planned Dental Procedures & Treatment Estimate */}
        <div className="bg-white rounded-lg border border-slate-200 p-3.5 space-y-2.5 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5 text-amber-600" />
              Planned Procedures & Estimations
            </span>
            <span className="text-xs font-bold text-emerald-700">
              Est. Total: ₹{assessment.plannedProcedures.reduce((acc, p) => acc + p.estimatedCost, 0)}
            </span>
          </div>

          <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
            {assessment.plannedProcedures.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-2 text-center">No dental procedures scheduled</p>
            ) : (
              assessment.plannedProcedures.map((proc, idx) => (
                <div key={idx} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    {proc.toothNumber && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px]">
                        #{proc.toothNumber}
                      </span>
                    )}
                    <span className="font-medium text-slate-800">{proc.procedure}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-700">₹{proc.estimatedCost}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveProcedure(idx)}
                      className="text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Add Procedure Quick Form */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="text"
              value={newProcName}
              onChange={(e) => setNewProcName(e.target.value)}
              placeholder={`Add procedure for Tooth #${selectedTooth}...`}
              className="flex-1 text-xs text-slate-800 p-1.5 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-amber-500"
            />
            <input
              type="number"
              value={newProcCost}
              onChange={(e) => setNewProcCost(Number(e.target.value))}
              className="w-16 text-center text-xs font-bold text-slate-800 p-1.5 bg-slate-50 border border-slate-200 rounded-md focus:outline-none"
            />
            <button
              type="button"
              onClick={handleAddProcedure}
              className="px-2.5 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold flex items-center gap-1 shadow-xs"
            >
              <Plus className="w-3 h-3" />
              <span>Add</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

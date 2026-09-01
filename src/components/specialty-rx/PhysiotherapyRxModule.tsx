import React, { useState } from 'react';
import { 
  Activity, 
  Dumbbell, 
  Flame, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Sliders, 
  Clock, 
  ShieldCheck, 
  Sparkles, 
  Info,
  ChevronDown,
  ChevronUp,
  BookmarkPlus
} from 'lucide-react';
import { 
  PhysiotherapyAssessment, 
  PhysiotherapyProcedure, 
  PrescribedExercise 
} from '../../types';
import { PHYSIO_EXERCISE_DATABASE, PHYSIO_PROCEDURES_CATALOG } from '../../data/clinicalData';

interface PhysiotherapyRxModuleProps {
  assessment: PhysiotherapyAssessment;
  procedures: PhysiotherapyProcedure[];
  exercises: PrescribedExercise[];
  onUpdateAssessment: (assessment: PhysiotherapyAssessment) => void;
  onUpdateProcedures: (procedures: PhysiotherapyProcedure[]) => void;
  onUpdateExercises: (exercises: PrescribedExercise[]) => void;
}

export const PhysiotherapyRxModule: React.FC<PhysiotherapyRxModuleProps> = ({
  assessment,
  procedures,
  exercises,
  onUpdateAssessment,
  onUpdateProcedures,
  onUpdateExercises
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'assessment' | 'procedures' | 'exercises'>('assessment');
  const [exerciseFilter, setExerciseFilter] = useState<string>('All');
  const [showCatalogModal, setShowCatalogModal] = useState(false);
  const [showProcedureModal, setShowProcedureModal] = useState(false);

  // New Exercise Form State
  const [newExercise, setNewExercise] = useState<PrescribedExercise>({
    id: '',
    exerciseName: '',
    targetArea: 'Spine & Neck',
    sets: 3,
    reps: 10,
    holdSeconds: 5,
    frequency: '2x Daily',
    resistanceBand: 'None',
    instructions: '',
    precautions: ''
  });

  // New Procedure Form State
  const [newProcedure, setNewProcedure] = useState<PhysiotherapyProcedure>({
    id: '',
    name: 'Trigger Point Dry Needling (DN)',
    type: 'Dry Needling',
    targetArea: '',
    parameters: '4 Needles (0.25 x 40mm), Piston technique with local twitch response',
    durationMinutes: 15,
    patientTolerance: 'Well Tolerated'
  });

  // Handler for VAS score change
  const handleVasChange = (score: number) => {
    onUpdateAssessment({
      ...assessment,
      vasPainScore: score
    });
  };

  // Add ROM item
  const handleAddRomItem = () => {
    onUpdateAssessment({
      ...assessment,
      jointRomFindings: [
        ...assessment.jointRomFindings,
        {
          joint: 'Cervical / Lumbar / Shoulder',
          movement: 'Flexion / Abduction',
          degrees: '70° (Restricted)',
          endFeel: 'Capsular / Firm'
        }
      ]
    });
  };

  // Remove ROM item
  const handleRemoveRomItem = (index: number) => {
    const updated = assessment.jointRomFindings.filter((_, i) => i !== index);
    onUpdateAssessment({
      ...assessment,
      jointRomFindings: updated
    });
  };

  // Update ROM item
  const handleUpdateRomItem = (index: number, field: string, value: string) => {
    const updated = [...assessment.jointRomFindings];
    updated[index] = { ...updated[index], [field]: value };
    onUpdateAssessment({
      ...assessment,
      jointRomFindings: updated
    });
  };

  // Add MMT item
  const handleAddMmtItem = () => {
    onUpdateAssessment({
      ...assessment,
      muscleStrengthMmt: [
        ...assessment.muscleStrengthMmt,
        {
          muscleGroup: 'Muscle Group',
          grade: '4/5 (Good)'
        }
      ]
    });
  };

  // Remove MMT item
  const handleRemoveMmtItem = (index: number) => {
    const updated = assessment.muscleStrengthMmt.filter((_, i) => i !== index);
    onUpdateAssessment({
      ...assessment,
      muscleStrengthMmt: updated
    });
  };

  // Update MMT item
  const handleUpdateMmtItem = (index: number, field: string, value: any) => {
    const updated = [...assessment.muscleStrengthMmt];
    updated[index] = { ...updated[index], [field]: value };
    onUpdateAssessment({
      ...assessment,
      muscleStrengthMmt: updated
    });
  };

  // Add Special Test
  const handleAddSpecialTest = () => {
    onUpdateAssessment({
      ...assessment,
      specialOrthopedicTests: [
        ...assessment.specialOrthopedicTests,
        {
          testName: 'Straight Leg Raise / Neer / Hawkins',
          result: 'Positive (+)',
          notes: ''
        }
      ]
    });
  };

  // Remove Special Test
  const handleRemoveSpecialTest = (index: number) => {
    const updated = assessment.specialOrthopedicTests.filter((_, i) => i !== index);
    onUpdateAssessment({
      ...assessment,
      specialOrthopedicTests: updated
    });
  };

  // Update Special Test
  const handleUpdateSpecialTest = (index: number, field: string, value: any) => {
    const updated = [...assessment.specialOrthopedicTests];
    updated[index] = { ...updated[index], [field]: value };
    onUpdateAssessment({
      ...assessment,
      specialOrthopedicTests: updated
    });
  };

  // Add Procedure
  const handleAddProcedure = (proc: PhysiotherapyProcedure) => {
    const procToAdd = {
      ...proc,
      id: `proc-${Date.now()}`
    };
    onUpdateProcedures([...procedures, procToAdd]);
    setShowProcedureModal(false);
  };

  // Remove Procedure
  const handleRemoveProcedure = (id: string) => {
    onUpdateProcedures(procedures.filter(p => p.id !== id));
  };

  // Add Exercise
  const handleAddExercise = (ex: PrescribedExercise) => {
    const exToAdd = {
      ...ex,
      id: `ex-${Date.now()}`
    };
    onUpdateExercises([...exercises, exToAdd]);
    setShowCatalogModal(false);
  };

  // Remove Exercise
  const handleRemoveExercise = (id: string) => {
    onUpdateExercises(exercises.filter(e => e.id !== id));
  };

  // Filtered exercise database catalog
  const filteredCatalog = exerciseFilter === 'All' 
    ? PHYSIO_EXERCISE_DATABASE 
    : PHYSIO_EXERCISE_DATABASE.filter(e => e.targetArea === exerciseFilter);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
      {/* Specialty Header */}
      <div className="bg-gradient-to-r from-teal-800 via-teal-900 to-slate-900 text-white p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-500/20 border border-teal-400/30 flex items-center justify-center text-teal-300">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-teal-300 bg-teal-950/60 px-2 py-0.5 rounded border border-teal-500/30">
                  Physiotherapy & Rehab Workflow
                </span>
                <span className="text-xs text-slate-300">Clinical Mobility & Needling Protocol</span>
              </div>
              <h3 className="text-base font-bold text-white tracking-tight">
                Mobility Assessment, In-Clinic Interventions & Home Exercise Program (HEP)
              </h3>
            </div>
          </div>

          {/* Sub Navigation Tabs */}
          <div className="flex bg-slate-800/80 p-1 rounded-lg border border-slate-700">
            <button
              type="button"
              onClick={() => setActiveSubTab('assessment')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeSubTab === 'assessment'
                  ? 'bg-teal-500 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              1. Mobility Assessment
              <span className="bg-teal-900/80 text-teal-200 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                VAS {assessment.vasPainScore}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('procedures')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeSubTab === 'procedures'
                  ? 'bg-teal-500 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              2. Performed Therapy
              <span className="bg-teal-900/80 text-teal-200 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                {procedures.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('exercises')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeSubTab === 'exercises'
                  ? 'bg-teal-500 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Dumbbell className="w-3.5 h-3.5" />
              3. Prescribed Exercises
              <span className="bg-teal-900/80 text-teal-200 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                {exercises.length}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* TAB 1: MOBILITY & FUNCTIONAL ASSESSMENT */}
      {activeSubTab === 'assessment' && (
        <div className="p-5 space-y-6 bg-slate-50/50">
          {/* VAS Pain Scale & Character */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3">
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-amber-500" />
                  Visual Analogue Pain Scale (VAS 0 - 10) & Pain Character
                </label>
                <p className="text-xs text-slate-500">Current pain intensity reported during provocative movement</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                  assessment.vasPainScore <= 3 
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                    : assessment.vasPainScore <= 6 
                    ? 'bg-amber-100 text-amber-800 border border-amber-300' 
                    : 'bg-rose-100 text-rose-800 border border-rose-300'
                }`}>
                  Score: {assessment.vasPainScore} / 10 ({
                    assessment.vasPainScore === 0 ? 'No Pain' :
                    assessment.vasPainScore <= 3 ? 'Mild Discomfort' :
                    assessment.vasPainScore <= 6 ? 'Moderate Pain' :
                    assessment.vasPainScore <= 8 ? 'Severe Pain' : 'Extreme / Agonizing Pain'
                  })
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <input 
                  type="range" 
                  min="0" 
                  max="10" 
                  step="1"
                  value={assessment.vasPainScore}
                  onChange={(e) => handleVasChange(parseInt(e.target.value))}
                  className="w-full h-2.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
                />
                <div className="flex justify-between text-[11px] text-slate-500 font-medium mt-1">
                  <span>0 (Pain-free)</span>
                  <span>3 (Mild)</span>
                  <span>6 (Moderate)</span>
                  <span>8 (Severe)</span>
                  <span>10 (Worst)</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">Pain Quality / Character:</label>
                <div className="flex flex-wrap gap-1.5">
                  {(['Aching', 'Sharp / Shooting', 'Burning', 'Dull / Throbbing', 'Radiating / Neural'] as const).map(ptype => (
                    <button
                      key={ptype}
                      type="button"
                      onClick={() => onUpdateAssessment({ ...assessment, painType: ptype })}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${
                        assessment.painType === ptype 
                          ? 'bg-teal-600 text-white border-teal-600 font-semibold shadow-xs' 
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {ptype}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 pt-3 border-t border-slate-100">
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">Aggravating Factors:</label>
                <input 
                  type="text" 
                  value={assessment.painAggravatingFactors || ''}
                  onChange={(e) => onUpdateAssessment({ ...assessment, painAggravatingFactors: e.target.value })}
                  placeholder="e.g. Prolonged sitting, overhead reaching, morning stiffness"
                  className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-teal-500 bg-white"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">Relieving Factors:</label>
                <input 
                  type="text" 
                  value={assessment.painRelievingFactors || ''}
                  onChange={(e) => onUpdateAssessment({ ...assessment, painRelievingFactors: e.target.value })}
                  placeholder="e.g. Moist heat pack, prone posture, short walking breaks"
                  className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-teal-500 bg-white"
                />
              </div>
            </div>
          </div>

          {/* Joint ROM & Mobility Findings */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-teal-600" />
                  Joint Range of Motion (ROM) & Mobility Restrictions
                </label>
                <p className="text-xs text-slate-500">Active / passive movement angles with capsular end-feel</p>
              </div>
              <button
                type="button"
                onClick={handleAddRomItem}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Joint ROM
              </button>
            </div>

            <div className="space-y-2">
              {assessment.jointRomFindings.map((rom, idx) => (
                <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2 p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs items-center">
                  <div className="md:col-span-3">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Joint Involved</label>
                    <input 
                      type="text" 
                      value={rom.joint}
                      onChange={(e) => handleUpdateRomItem(idx, 'joint', e.target.value)}
                      placeholder="e.g. Left Glenohumeral"
                      className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Movement Plane</label>
                    <input 
                      type="text" 
                      value={rom.movement}
                      onChange={(e) => handleUpdateRomItem(idx, 'movement', e.target.value)}
                      placeholder="e.g. Abduction / External Rot"
                      className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Degrees / Limitation</label>
                    <input 
                      type="text" 
                      value={rom.degrees}
                      onChange={(e) => handleUpdateRomItem(idx, 'degrees', e.target.value)}
                      placeholder="e.g. 75° (Normal 180° - Restricted)"
                      className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">End-Feel</label>
                    <select
                      value={rom.endFeel}
                      onChange={(e) => handleUpdateRomItem(idx, 'endFeel', e.target.value)}
                      className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs focus:ring-1 focus:ring-teal-500"
                    >
                      <option value="Normal">Normal</option>
                      <option value="Capsular / Firm">Capsular / Firm</option>
                      <option value="Empty / Painful">Empty / Painful</option>
                      <option value="Bone-to-bone">Bone-to-bone</option>
                      <option value="Spastic">Spastic</option>
                    </select>
                  </div>
                  <div className="md:col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleRemoveRomItem(idx)}
                      className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                      title="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Muscle Strength (MMT) & Special Tests */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* MMT Grading */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-teal-600" />
                  Manual Muscle Testing (MMT 0-5)
                </label>
                <button
                  type="button"
                  onClick={handleAddMmtItem}
                  className="px-2 py-0.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded border border-teal-200"
                >
                  + Add Muscle
                </button>
              </div>

              <div className="space-y-2">
                {assessment.muscleStrengthMmt.map((mmt, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-slate-50 p-2 rounded border border-slate-200 text-xs">
                    <input 
                      type="text" 
                      value={mmt.muscleGroup}
                      onChange={(e) => handleUpdateMmtItem(idx, 'muscleGroup', e.target.value)}
                      placeholder="e.g. Rotator Cuff / Quadriceps"
                      className="flex-1 px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                    />
                    <select
                      value={mmt.grade}
                      onChange={(e) => handleUpdateMmtItem(idx, 'grade', e.target.value)}
                      className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-medium"
                    >
                      <option value="5/5 (Normal)">5/5 (Normal)</option>
                      <option value="4/5 (Good)">4/5 (Good)</option>
                      <option value="3/5 (Fair - Anti-gravity)">3/5 (Fair - Anti-grav)</option>
                      <option value="2/5 (Poor)">2/5 (Poor - Gravity elim)</option>
                      <option value="1/5 (Trace)">1/5 (Trace flicker)</option>
                      <option value="0/5 (No contraction)">0/5 (Zero)</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => handleRemoveMmtItem(idx)}
                      className="p-1 text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Special Orthopedic Tests */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-teal-600" />
                  Special Clinical Ortho / Neuro Tests
                </label>
                <button
                  type="button"
                  onClick={handleAddSpecialTest}
                  className="px-2 py-0.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded border border-teal-200"
                >
                  + Add Test
                </button>
              </div>

              <div className="space-y-2">
                {assessment.specialOrthopedicTests.map((t, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-slate-50 p-2 rounded border border-slate-200 text-xs">
                    <input 
                      type="text" 
                      value={t.testName}
                      onChange={(e) => handleUpdateSpecialTest(idx, 'testName', e.target.value)}
                      placeholder="e.g. SLR Test / Neer Impingement"
                      className="flex-1 px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                    />
                    <select
                      value={t.result}
                      onChange={(e) => handleUpdateSpecialTest(idx, 'result', e.target.value)}
                      className={`px-2 py-1 rounded text-xs font-bold ${
                        t.result === 'Positive (+)' ? 'bg-rose-100 text-rose-800 border border-rose-300' : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      }`}
                    >
                      <option value="Positive (+)">Positive (+)</option>
                      <option value="Negative (-)">Negative (-)</option>
                      <option value="Equivocal">Equivocal</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => handleRemoveSpecialTest(idx)}
                      className="p-1 text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Gait, Posture & Functional Goals */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                Gait & Postural Assessment
              </label>
              <textarea 
                rows={2}
                value={assessment.gaitAndPosture || ''}
                onChange={(e) => onUpdateAssessment({ ...assessment, gaitAndPosture: e.target.value })}
                placeholder="e.g. Antalgic gait with right lateral trunk shift (sciatic list), rounded shoulders"
                className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-teal-500 bg-white"
              />
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                Rehabilitation & Functional Goals (3 - 6 Weeks)
              </label>
              <textarea 
                rows={2}
                value={assessment.functionalGoals.join('\n')}
                onChange={(e) => onUpdateAssessment({ 
                  ...assessment, 
                  functionalGoals: e.target.value.split('\n').filter(Boolean) 
                })}
                placeholder="e.g. Centralize radicular sciatic symptoms&#10;Achieve pain-free sitting > 45 mins&#10;Restore overhead reach"
                className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-teal-500 bg-white"
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: IN-CLINIC PERFORMED THERAPIES (Dry Needling, IFT, Laser, Manual Therapy) */}
      {activeSubTab === 'procedures' && (
        <div className="p-5 space-y-5 bg-slate-50/50">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <div>
              <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Flame className="w-4 h-4 text-teal-600" />
                In-Clinic Interventions & Performed Modalities Log
              </h4>
              <p className="text-xs text-slate-500">
                Log active physical modalities, dry needling trigger points, electrotherapy, and manual mobilizations performed during this consultation
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowProcedureModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-lg shadow-sm transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              + Add Performed Procedure
            </button>
          </div>

          {/* List of Performed Procedures */}
          {procedures.length === 0 ? (
            <div className="text-center py-10 bg-white rounded-xl border border-dashed border-slate-300 p-6">
              <Flame className="w-8 h-8 text-slate-400 mx-auto mb-2 opacity-50" />
              <p className="text-xs font-semibold text-slate-700">No in-clinic procedures logged yet</p>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                Add Dry Needling (trigger point release), IFT, Ultrasound, High-Intensity Laser, or Joint Mobilization performed on the patient today.
              </p>
              <button
                type="button"
                onClick={() => setShowProcedureModal(true)}
                className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg"
              >
                <Plus className="w-3.5 h-3.5" />
                Select from Procedure Catalog
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {procedures.map((proc) => (
                <div key={proc.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs relative flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          proc.type === 'Dry Needling' ? 'bg-amber-100 text-amber-800 border border-amber-300' :
                          proc.type === 'Manual Therapy' ? 'bg-purple-100 text-purple-800 border border-purple-300' :
                          proc.type === 'Electrotherapy & Modality' ? 'bg-blue-100 text-blue-800 border border-blue-300' :
                          'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        }`}>
                          {proc.type}
                        </span>
                        <span className="text-xs font-bold text-slate-900">{proc.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveProcedure(proc.id)}
                        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="space-y-1.5 text-xs text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-700">Target Area:</span>
                        <span className="text-slate-900 font-medium">{proc.targetArea}</span>
                      </div>
                      {proc.parameters && (
                        <div className="text-[11px] bg-slate-50 p-2 rounded border border-slate-200 text-slate-700">
                          <span className="font-semibold text-slate-800">Technique / Parameters: </span>
                          {proc.parameters}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100 text-xs">
                    <div className="flex items-center gap-1 text-slate-500">
                      <Clock className="w-3.5 h-3.5 text-teal-600" />
                      <span>{proc.durationMinutes} Minutes Session</span>
                    </div>
                    <span className="text-[11px] font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                      {proc.patientTolerance}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Quick Procedure Template Picker Modal */}
          {showProcedureModal && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl border border-slate-200">
                <div className="p-4 bg-gradient-to-r from-teal-800 to-slate-900 text-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Flame className="w-5 h-5 text-teal-300" />
                    <h3 className="font-bold text-sm">Add In-Clinic Procedure / Modality</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowProcedureModal(false)}
                    className="text-slate-300 hover:text-white text-xs font-bold px-2 py-1 rounded bg-white/10"
                  >
                    Close
                  </button>
                </div>

                <div className="p-5 overflow-y-auto space-y-4 flex-1">
                  <p className="text-xs text-slate-500 font-medium">
                    Select a standardized modality preset or configure a custom procedure below:
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {PHYSIO_PROCEDURES_CATALOG.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleAddProcedure(item)}
                        className="text-left p-3 rounded-xl border border-slate-200 hover:border-teal-500 hover:bg-teal-50/50 transition-all flex flex-col justify-between group"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700 bg-teal-100/70 px-1.5 py-0.5 rounded">
                              {item.type}
                            </span>
                            <span className="text-[10px] text-slate-400 font-medium">{item.durationMinutes} min</span>
                          </div>
                          <h5 className="text-xs font-bold text-slate-900 group-hover:text-teal-900 mb-1">
                            {item.name}
                          </h5>
                          <p className="text-[11px] text-slate-500 line-clamp-2">{item.targetArea}</p>
                        </div>
                        <div className="mt-2 text-[11px] font-semibold text-teal-600 flex items-center gap-1">
                          <Plus className="w-3 h-3" /> Select & Add
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Custom Procedure Form */}
                  <div className="mt-4 pt-4 border-t border-slate-200 bg-slate-50 p-4 rounded-xl">
                    <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                      Or Configure Custom Needling / Therapy
                    </h5>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="text-[10px] font-bold text-slate-600 uppercase">Procedure Name</label>
                        <input 
                          type="text" 
                          value={newProcedure.name}
                          onChange={(e) => setNewProcedure({ ...newProcedure, name: e.target.value })}
                          placeholder="e.g. Dry Needling / Cupping"
                          className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-600 uppercase">Modality Type</label>
                        <select
                          value={newProcedure.type}
                          onChange={(e) => setNewProcedure({ ...newProcedure, type: e.target.value as any })}
                          className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"
                        >
                          <option value="Dry Needling">Dry Needling</option>
                          <option value="Electrotherapy & Modality">Electrotherapy & Modality</option>
                          <option value="Manual Therapy">Manual Therapy</option>
                          <option value="Taping & Cupping">Taping & Cupping</option>
                          <option value="Traction & Decompression">Traction & Decompression</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-600 uppercase">Target Muscles / Joint</label>
                        <input 
                          type="text" 
                          value={newProcedure.targetArea}
                          onChange={(e) => setNewProcedure({ ...newProcedure, targetArea: e.target.value })}
                          placeholder="e.g. Upper Trapezius / Piriformis"
                          className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-600 uppercase">Parameters / Needles</label>
                        <input 
                          type="text" 
                          value={newProcedure.parameters || ''}
                          onChange={(e) => setNewProcedure({ ...newProcedure, parameters: e.target.value })}
                          placeholder="e.g. 4 Needles, 0.25x40mm, Piston"
                          className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAddProcedure(newProcedure)}
                      disabled={!newProcedure.name || !newProcedure.targetArea}
                      className="mt-3 w-full py-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-colors"
                    >
                      Add Custom Procedure
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: PRESCRIBED HOME EXERCISE PROGRAM (HEP) */}
      {activeSubTab === 'exercises' && (
        <div className="p-5 space-y-5 bg-slate-50/50">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <div>
              <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Dumbbell className="w-4 h-4 text-teal-600" />
                Prescribed Home Exercise Program (HEP)
              </h4>
              <p className="text-xs text-slate-500">
                Tailored rehabilitation exercises with sets, repetitions, hold duration, frequency, and resistance band parameters
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCatalogModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-lg shadow-sm transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              + Add from Exercise Library
            </button>
          </div>

          {/* Active Prescribed Exercises */}
          {exercises.length === 0 ? (
            <div className="text-center py-10 bg-white rounded-xl border border-dashed border-slate-300 p-6">
              <Dumbbell className="w-8 h-8 text-slate-400 mx-auto mb-2 opacity-50" />
              <p className="text-xs font-semibold text-slate-700">No home exercises prescribed yet</p>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                Select clinical exercises from our library covering cervical spine, rotator cuff, lumbar stabilization, knee biomechanics, and ankle proprioception.
              </p>
              <button
                type="button"
                onClick={() => setShowCatalogModal(true)}
                className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg"
              >
                <Plus className="w-3.5 h-3.5" />
                Open Exercise Library
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {exercises.map((ex, index) => (
                <div key={ex.id || index} className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="w-6 h-6 rounded-full bg-teal-100 text-teal-800 text-xs font-bold flex items-center justify-center">
                        {index + 1}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                        {ex.targetArea}
                      </span>
                      <h5 className="text-sm font-bold text-slate-900">{ex.exerciseName}</h5>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveExercise(ex.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded"
                      title="Remove Exercise"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Sets, Reps, Hold, Frequency Tags */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 my-2.5 bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs">
                    <div>
                      <span className="text-[10px] font-bold text-slate-500 uppercase block">Sets</span>
                      <span className="font-bold text-slate-800">{ex.sets} Sets</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-slate-500 uppercase block">Reps</span>
                      <span className="font-bold text-slate-800">{ex.reps} Repetitions</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-slate-500 uppercase block">Hold</span>
                      <span className="font-bold text-slate-800">{ex.holdSeconds > 0 ? `${ex.holdSeconds} Secs` : 'Dynamic'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-slate-500 uppercase block">Frequency</span>
                      <span className="font-bold text-teal-700">{ex.frequency}</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-slate-500 uppercase block">Resistance Band</span>
                      <span className="font-semibold text-slate-700">{ex.resistanceBand || 'None'}</span>
                    </div>
                  </div>

                  {/* Instructions & Precautions */}
                  <div className="text-xs space-y-1 text-slate-600">
                    <p><span className="font-semibold text-slate-700">Instructions:</span> {ex.instructions}</p>
                    {ex.precautions && (
                      <p className="text-amber-800 bg-amber-50/70 px-2 py-1 rounded border border-amber-200/60 text-[11px]">
                        <span className="font-semibold">Precaution:</span> {ex.precautions}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Exercise Library Modal */}
          {showCatalogModal && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl border border-slate-200">
                <div className="p-4 bg-gradient-to-r from-teal-800 to-slate-900 text-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Dumbbell className="w-5 h-5 text-teal-300" />
                    <h3 className="font-bold text-sm">Physiotherapy Exercise Library</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCatalogModal(false)}
                    className="text-slate-300 hover:text-white text-xs font-bold px-2 py-1 rounded bg-white/10"
                  >
                    Close
                  </button>
                </div>

                {/* Target Area Filter Bar */}
                <div className="p-3 bg-slate-100 border-b border-slate-200 flex flex-wrap gap-1.5">
                  {['All', 'Spine & Neck', 'Shoulder & Arm', 'Lower Back & Core', 'Hip & Knee', 'Ankle & Foot', 'Full Body & Balance'].map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setExerciseFilter(cat)}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                        exerciseFilter === cat
                          ? 'bg-teal-700 text-white shadow-xs'
                          : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* Catalog Grid */}
                <div className="p-5 overflow-y-auto space-y-3 flex-1">
                  {filteredCatalog.map((ex) => (
                    <div 
                      key={ex.id}
                      className="p-3.5 bg-slate-50 hover:bg-teal-50/40 rounded-xl border border-slate-200 hover:border-teal-400 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700 bg-teal-100 px-1.5 py-0.5 rounded">
                            {ex.targetArea}
                          </span>
                          <h5 className="text-xs font-bold text-slate-900">{ex.exerciseName}</h5>
                        </div>
                        <p className="text-[11px] text-slate-600 line-clamp-2">{ex.instructions}</p>
                        <div className="flex items-center gap-3 text-[11px] text-slate-500 font-medium">
                          <span>{ex.sets} Sets × {ex.reps} Reps</span>
                          <span>• Hold: {ex.holdSeconds}s</span>
                          <span>• Freq: {ex.frequency}</span>
                          {ex.resistanceBand && ex.resistanceBand !== 'None' && (
                            <span className="text-teal-700 font-semibold">• Band: {ex.resistanceBand}</span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleAddExercise(ex)}
                        className="self-end sm:self-center px-3 py-1.5 text-xs font-bold text-teal-700 bg-white hover:bg-teal-600 hover:text-white border border-teal-300 rounded-lg shadow-2xs transition-all shrink-0 flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" /> Prescribe
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

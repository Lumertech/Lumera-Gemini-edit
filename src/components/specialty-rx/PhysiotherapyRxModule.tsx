import React, { useEffect, useState } from 'react';
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
  preferredSubTab?: 'assessment' | 'procedures' | 'exercises';
  hepRevision?: number;
  highlightPopulated?: boolean;
}

export const PhysiotherapyRxModule: React.FC<PhysiotherapyRxModuleProps> = ({
  assessment,
  procedures,
  exercises,
  onUpdateAssessment,
  onUpdateProcedures,
  onUpdateExercises,
  preferredSubTab,
  hepRevision,
  highlightPopulated = false,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'assessment' | 'procedures' | 'exercises'>('assessment');

  useEffect(() => {
    if (preferredSubTab) setActiveSubTab(preferredSubTab);
  }, [preferredSubTab, hepRevision]);
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
        <div className={`p-5 space-y-6 bg-slate-50/50${highlightPopulated ? ' ring-2 ring-violet-400 ring-inset bg-violet-50/40' : ''}`}>
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

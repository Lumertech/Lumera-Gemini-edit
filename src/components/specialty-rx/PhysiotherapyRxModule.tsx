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

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

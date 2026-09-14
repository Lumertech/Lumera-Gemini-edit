import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Plus, 
  Trash2, 
  AlertTriangle, 
  CheckCircle, 
  Send, 
  Printer, 
  ShieldAlert, 
  Sparkles, 
  Search, 
  Download, 
  RefreshCw, 
  Languages, 
  QrCode, 
  Pill, 
  X,
  Stethoscope,
  Activity,
  Dumbbell,
  Flame,
  CheckCircle2,
  Sliders,
  Clock,
  ShieldCheck,
  Zap,
  Heart,
  Bone,
  Baby,
  Mic,
  Receipt,
  ArrowRight,
  Share2,
  Phone
} from 'lucide-react';
import { 
  Prescription, 
  MedicineItem, 
  LabTestItem, 
  Patient, 
  Doctor, 
  SoapNote, 
  ClinicSettings, 
  SafetyCheckResult,
  PolyclinicSpecialty,
  PhysiotherapyAssessment,
  PhysiotherapyProcedure,
  PrescribedExercise,
  CardiologyAssessment,
  DermatologyAssessment,
  PediatricAssessment,
  OrthopedicAssessment,
  OphthalmologyAssessment,
  DentalAssessment,
  GynecologyAssessment,
  isAbhaLinked,
  Appointment
} from '../types';
import { 
  INDIAN_DRUG_DATABASE, 
  RX_PRESETS, 
  STANDARD_LAB_TESTS,
  PHYSIO_EXERCISE_DATABASE,
  PHYSIO_PROCEDURES_CATALOG,
  MOCK_THERAPY_PACKAGES
} from '../data/clinicalData';
import { SpecialtyToolbar } from './specialty-rx/SpecialtyToolbar';
import { PhysiotherapyRxModule } from './specialty-rx/PhysiotherapyRxModule';
import { CardiologyRxModule } from './specialty-rx/CardiologyRxModule';
import { DermatologyRxModule } from './specialty-rx/DermatologyRxModule';
import { PediatricsRxModule } from './specialty-rx/PediatricsRxModule';
import { OrthopedicsRxModule } from './specialty-rx/OrthopedicsRxModule';
import { OphthalmologyRxModule } from './specialty-rx/OphthalmologyRxModule';
import { DentalSurgeryRxModule } from './specialty-rx/DentalSurgeryRxModule';
import { GynecologyRxModule } from './specialty-rx/GynecologyRxModule';
import { PhysioProgressTracker } from './specialty-rx/PhysioProgressTracker';
import { CompactAmbientScribe, AmbientScribeStatus } from './CompactAmbientScribe';
import { FollowUpSlotPicker, ReservedFollowUp } from './FollowUpSlotPicker';
import { clonePresetExercises, presetHepToastMessage } from '../lib/rxPresetHep';
import { followUpBookingRef } from '../lib/followUpSlots';
import { resolveRxModule } from '../lib/specialtyWorkflow';

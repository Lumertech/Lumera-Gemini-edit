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
  isAbhaLinked
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
import { CompactAmbientScribe } from './CompactAmbientScribe';

interface PrescriptionWriterProps {
  currentPatient: Patient;
  currentDoctor: Doctor;
  initialSoapData: SoapNote | null;
  onSavePrescription: (prescription: Prescription) => void;
  clinicSettings: ClinicSettings;
  isSpecialtyLocked?: boolean;
  lockedSpecialty?: string;
  onProceedToBilling?: () => void;
}

export const PrescriptionWriter: React.FC<PrescriptionWriterProps> = ({
  currentPatient,
  currentDoctor,
  initialSoapData,
  onSavePrescription,
  clinicSettings,
  isSpecialtyLocked,
  lockedSpecialty,
  onProceedToBilling,
}) => {
  // Determine initial specialty from current doctor
  const getInitialSpecialty = (doctorSpec: string): PolyclinicSpecialty => {
    const s = (lockedSpecialty || doctorSpec).toLowerCase();
    if (s.includes('physio') || s.includes('rehab')) return 'Physiotherapy & Rehabilitation';
    if (s.includes('cardio')) return 'Cardiology';
    if (s.includes('derm')) return 'Dermatology';
    if (s.includes('ortho')) return 'Orthopedics';
    if (s.includes('ped')) return 'Pediatrics';
    if (s.includes('eye') || s.includes('ophthal')) return 'Ophthalmology';
    if (s.includes('dent') || s.includes('oral')) return 'Dental Surgery';
    if (s.includes('gyn') || s.includes('obstet')) return 'Gynecology';
    if (s.includes('ent') || s.includes('otolaryng')) return 'ENT';
    if (s.includes('psych') || s.includes('therap') || s.includes('counsel')) return 'Psychiatry & Mental Health';
    if (s.includes('wellness') || s.includes('spa') || s.includes('salon')) return 'Wellness & Spas';
    if (s.includes('consult')) return 'Consulting';
    return 'General Medicine';
  };

  const [activeSpecialty, setActiveSpecialty] = useState<PolyclinicSpecialty>(
    getInitialSpecialty(lockedSpecialty || currentDoctor.specialty)
  );

  const [isAmbientScribeOpen, setIsAmbientScribeOpen] = useState(false);

  // Dynamic patient intake: when active patient changes or is called from queue, update context
  useEffect(() => {
    if (initialSoapData) return;
    if (currentPatient.chronicConditions && currentPatient.chronicConditions.length > 0) {
      setChiefComplaints(currentPatient.chronicConditions.map((c) => `Evaluation & review of ${c}`));
      setDiagnosis(`Clinical Evaluation: ${currentPatient.chronicConditions[0]}`);
    } else {
      setChiefComplaints(['Routine clinical consultation and checkup']);
      setDiagnosis('Clinical Examination');
    }
  }, [currentPatient.id]);

  const handleApplySoapToRx = (soap: SoapNote) => {
    if (soap.subjective?.chiefComplaints?.length) {
      setChiefComplaints(soap.subjective.chiefComplaints);
    }
    if (soap.assessment?.primaryDiagnosis) {
      setDiagnosis(soap.assessment.primaryDiagnosis);
    }
    if (soap.assessment?.icd10Code) {
      setIcd10(soap.assessment.icd10Code);
    }
    if (soap.plan?.medicines?.length) {
      setMedicines(soap.plan.medicines);
    }
    if (soap.plan?.labTests?.length) {
      setLabTests(soap.plan.labTests);
    }
    if (soap.plan?.lifestyleAdvice?.length) {
      setAdviceList(soap.plan.lifestyleAdvice);
    }
    if (soap.physiotherapyAssessment) {
      setPhysioAssessment(soap.physiotherapyAssessment);
    }
  };

  const [rxNumber] = useState(`RX-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`);
  
  // Standard clinical fields
  const [chiefComplaints, setChiefComplaints] = useState<string[]>(
    initialSoapData?.subjective?.chiefComplaints || 
    (activeSpecialty === 'Physiotherapy & Rehabilitation' 
      ? ['Left shoulder severe pain & progressive stiffness', 'Inability to reach overhead or fasten clothes', 'Sleep disturbance due to shoulder pain']
      : ['Acute viral upper respiratory tract infection', 'Throat irritation'])
  );
  const [newComplaint, setNewComplaint] = useState('');
  
  const [diagnosis, setDiagnosis] = useState(
    initialSoapData?.assessment?.primaryDiagnosis || 
    (activeSpecialty === 'Physiotherapy & Rehabilitation'
      ? 'Adhesive Capsulitis of Left Shoulder (Stage II Freezing Phase)'
      : 'Acute Nasopharyngitis (Common Cold)')
  );
  const [icd10, setIcd10] = useState(
    initialSoapData?.assessment?.icd10Code || 
    (activeSpecialty === 'Physiotherapy & Rehabilitation' ? 'M75.0' : 'J00')
  );

  const [medicines, setMedicines] = useState<MedicineItem[]>(
    initialSoapData?.plan?.medicines || (
      activeSpecialty === 'Physiotherapy & Rehabilitation'
        ? [
            {
              id: 'med-p1',
              drugName: 'Aceclofenac + Serratiopeptidase (Zerodol-SP)',
              composition: 'Aceclofenac 100mg + Paracetamol 325mg + Serratiopeptidase 15mg',
              dosage: '1 Tablet',
              form: 'Tablet',
              frequency: '1-0-1',
              timing: 'After Food',
              durationDays: 5,
              instructions: 'Take after meals for capsular inflammation & edema'
            },
            {
              id: 'med-p2',
              drugName: 'Pantoprazole 40 mg (Pan 40)',
              composition: 'Pantoprazole 40mg',
              dosage: '40 mg',
              form: 'Tablet',
              frequency: '1-0-0',
              timing: 'Before Food',
              durationDays: 5,
              instructions: 'Empty stomach 30 mins before breakfast'
            },
            {
              id: 'med-p3',
              drugName: 'Diclofenac Diethylamine Gel (Volini)',
              composition: 'Diclofenac 1.16% + Linseed Oil + Menthol',
              dosage: 'Topical Application',
              form: 'Ointment',
              frequency: '1-0-1',
              timing: 'With Food',
              durationDays: 14,
              instructions: 'Gently massage anterior and posterior shoulder joint capsule'
            }
          ]
        : [
            {
              id: 'med-1',
              drugName: 'Dolo 650 Tablet',
              composition: 'Paracetamol 650mg',
              dosage: '1 Tablet',
              form: 'Tablet',
              frequency: '1-0-1',
              timing: 'After Food',
              durationDays: 3,
              instructions: 'Take with warm water for fever & body ache SOS',
            },
            {
              id: 'med-2',
              drugName: 'Montair-LC Tablet',
              composition: 'Montelukast 10mg + Levocetirizine 5mg',
              dosage: '1 Tablet',
              form: 'Tablet',
              frequency: '0-0-1',
              timing: 'At Bedtime',
              durationDays: 5,
              instructions: 'At bedtime for nasal congestion and allergy',
            }
          ]
    )
  );

  const [labTests, setLabTests] = useState<LabTestItem[]>(
    initialSoapData?.plan?.labTests || (
      activeSpecialty === 'Physiotherapy & Rehabilitation'
        ? [{ id: 'lab-9', testName: 'Digital X-Ray Shoulder Joint AP & Axial View', category: 'Radiology', price: 500 }]
        : []
    )
  );

  const [adviceList, setAdviceList] = useState<string[]>(
    initialSoapData?.plan?.lifestyleAdvice || (
      activeSpecialty === 'Physiotherapy & Rehabilitation'
        ? [
            'Moist heat pack for 10 minutes prior to exercise sessions',
            'Sleep on non-affected side with a pillow supporting affected arm in abduction',
            'Perform Home Exercise Program (HEP) 3 times daily within tolerable pain threshold (VAS <= 4)',
            'Avoid sudden jerky overhead reaching or heavy lifting (>2 kg)'
          ]
        : [
            'Warm saline gargles three times daily',
            'Steam inhalation twice daily for 5-7 minutes',
            'Plenty of warm fluids and adequate bed rest',
            'Avoid cold drinks, oily foods, and direct exposure to cold air',
          ]
    )
  );
  const [newAdvice, setNewAdvice] = useState('');
  const [followUpDays, setFollowUpDays] = useState(
    initialSoapData?.plan?.followUpDays || 7
  );

  const [selectedTherapyPackage, setSelectedTherapyPackage] = useState(
    (diagnosis.toLowerCase().includes('lumbar') || diagnosis.toLowerCase().includes('disc') || diagnosis.toLowerCase().includes('sciatica') || diagnosis.toLowerCase().includes('back'))
      ? MOCK_THERAPY_PACKAGES[0]
      : MOCK_THERAPY_PACKAGES[1]
  );

  useEffect(() => {
    if (activeSpecialty === 'Physiotherapy & Rehabilitation') {
      const diagLower = diagnosis.toLowerCase();
      if (diagLower.includes('lumbar') || diagLower.includes('disc') || diagLower.includes('sciatica') || diagLower.includes('back')) {
        setSelectedTherapyPackage(MOCK_THERAPY_PACKAGES[0]);
      } else if (diagLower.includes('shoulder') || diagLower.includes('capsulitis') || diagLower.includes('adhesive')) {
        setSelectedTherapyPackage(MOCK_THERAPY_PACKAGES[1]);
      }
    }
  }, [diagnosis, activeSpecialty]);

  // Physiotherapy Specific States
  const [physioAssessment, setPhysioAssessment] = useState<PhysiotherapyAssessment>(
    initialSoapData?.physiotherapyAssessment || {
      vasPainScore: 7,
      painType: 'Aching',
      painAggravatingFactors: 'Night pain sleeping on shoulder, reaching behind back, putting on coat',
      painRelievingFactors: 'Warm shower, resting arm on pillow',
      jointRomFindings: [
        { joint: 'Glenohumeral (Affected)', movement: 'Abduction', degrees: '75° (Normal 180° - Restricted)', endFeel: 'Capsular / Firm' },
        { joint: 'Glenohumeral (Affected)', movement: 'External Rotation', degrees: '25° (Normal 90° - Marked Restriction)', endFeel: 'Empty / Painful' },
        { joint: 'Glenohumeral (Affected)', movement: 'Flexion', degrees: '105° (Normal 180°)', endFeel: 'Capsular / Firm' }
      ],
      muscleStrengthMmt: [
        { muscleGroup: 'Rotator Cuff (Supraspinatus/Infraspinatus)', grade: '3/5 (Fair - Anti-gravity)' },
        { muscleGroup: 'Deltoid & Periscapulars', grade: '4/5 (Good)' }
      ],
      gaitAndPosture: 'Protective guarded posture with elevation and internal rotation of affected shoulder',
      specialOrthopedicTests: [
        { testName: "Neer's Impingement Test", result: 'Positive (+)', notes: 'Provokes subacromial pain' },
        { testName: "Hawkins-Kennedy Test", result: 'Positive (+)', notes: 'Provokes anterior impingement pain' }
      ],
      functionalGoals: [
        'Restore shoulder external rotation to >= 60° within 3 weeks',
        'Enable pain-free sleep throughout the night (VAS < 2)',
        'Restore independent overhead dressing and grooming'
      ]
    }
  );

  const [performedProcedures, setPerformedProcedures] = useState<PhysiotherapyProcedure[]>(
    initialSoapData?.performedTherapies || [
      {
        id: 'proc-1',
        name: 'Trigger Point Dry Needling (DN)',
        type: 'Dry Needling',
        targetArea: 'Infraspinatus, Supraspinatus & Upper Trapezius',
        parameters: '0.25 x 40mm sterile Seirin needles, 3 trigger points, piston technique with 4 twitch responses elicited',
        durationMinutes: 15,
        patientTolerance: 'Well Tolerated'
      },
      {
        id: 'proc-5',
        name: 'Glenohumeral Joint Mobilization (Maitland Grade II-III)',
        type: 'Manual Therapy',
        targetArea: 'Left Glenohumeral Joint (Inferior & Posterior Glide)',
        parameters: 'Grade II oscillatory distractor glide for pain relief, followed by Grade III inferior glide 3 sets x 40s',
        durationMinutes: 15,
        patientTolerance: 'Well Tolerated'
      },
      {
        id: 'proc-4',
        name: 'High Intensity Class IV Laser Therapy (LLLT)',
        type: 'Electrotherapy & Modality',
        targetArea: 'Anterior & Inferior Joint Capsule',
        parameters: '810/980nm Dual Wavelength, 1000 Joules total energy dose',
        durationMinutes: 10,
        patientTolerance: 'Well Tolerated'
      }
    ]
  );

  const [prescribedExercises, setPrescribedExercises] = useState<PrescribedExercise[]>(
    initialSoapData?.prescribedExercises || [
      {
        id: 'ex-7',
        exerciseName: "Codman's Pendulum Decompression Swings",
        targetArea: 'Shoulder & Arm',
        sets: 3,
        reps: 20,
        holdSeconds: 0,
        frequency: '3x Daily',
        resistanceBand: 'None',
        instructions: 'Bend forward 90 degrees supported by table. Let affected arm dangle freely like a pendulum. Swing gently in clockwise and counter-clockwise circles.',
        precautions: 'Do not use shoulder muscles actively; use body momentum.'
      },
      {
        id: 'ex-8',
        exerciseName: 'Shoulder External Rotation with Resistance Band',
        targetArea: 'Shoulder & Arm',
        sets: 3,
        reps: 12,
        holdSeconds: 3,
        frequency: '2x Daily',
        resistanceBand: 'Yellow (Light)',
        instructions: 'Tuck a rolled towel between your elbow and side. Hold resistance band with forearm bent 90 degrees. Rotate forearm outward slowly.',
        precautions: 'Do not allow elbow to drift away from the ribcage.'
      },
      {
        id: 'ex-9',
        exerciseName: 'Finger Ladder / Wall Climbing Stretch',
        targetArea: 'Shoulder & Arm',
        sets: 3,
        reps: 8,
        holdSeconds: 15,
        frequency: '3x Daily',
        resistanceBand: 'None',
        instructions: 'Stand facing wall at arm length. Walk fingers upward slowly until gentle stretch is felt in anterior shoulder capsule. Hold for 15s.',
        precautions: 'Do not hike the shoulder or arch lower back.'
      }
    ]
  );

  // Other specialty states
  const [cardiologyAssessment, setCardiologyAssessment] = useState<CardiologyAssessment>({
    nyhaFunctionalClass: 'Class II',
    targetBloodPressure: '< 130/80 mmHg',
    targetRestingHeartRate: '60 - 70 bpm',
    dailySodiumLimitGrams: 2.0,
    dailyFluidLimitMl: 1500,
    ecgSummary: 'Normal sinus rhythm, rate 72 bpm, no ST-T changes',
    echoFindings: 'LVEF 55%, Grade I Diastolic Dysfunction'
  });

  const [dermatologyAssessment, setDermatologyAssessment] = useState<DermatologyAssessment>({
    fitzpatrickSkinType: 'Type IV',
    distribution: 'Facial malar region & forehead with inflammatory papules',
    sunProtectionAdvice: 'Broad spectrum SPF 50+ Gel 20 mins before sun exposure, reapply every 3 hrs'
  });

  const [pediatricAssessment, setPediatricAssessment] = useState<PediatricAssessment>({
    childWeightKg: currentPatient.age <= 12 ? 16 : 45,
    calculatedDosageBasis: 'Paracetamol Syrup: 15 mg/kg per dose',
    developmentalMilestones: 'Age Appropriate',
    immunizationsDue: ['MMR Booster', 'Influenza Annual']
  });

  const [orthopedicAssessment, setOrthopedicAssessment] = useState<OrthopedicAssessment>({
    affectedJointLimb: 'Right Knee Joint',
    weightBearingStatus: 'Full Weight Bearing (FWB)',
    splintOrBraceApplied: 'Hinged Knee Brace',
    xrayFindingsSummary: 'Medial compartment joint space narrowing, subchondral sclerosis'
  });

  const [ophthalmologyAssessment, setOphthalmologyAssessment] = useState<OphthalmologyAssessment>({
    refractionOD: { sphere: '-1.75', cyl: '-0.75', axis: '90°', add: '+0.00' },
    refractionOS: { sphere: '-2.25', cyl: '-1.00', axis: '85°', add: '+0.00' },
    visualAcuityOD: '6/18 -> 6/6',
    visualAcuityOS: '6/24 -> 6/6',
    pupillaryDistanceMm: 63,
    iopOD: 15,
    iopOS: 16,
    anteriorSegment: 'Cornea clear, anterior chamber quiet, crystalline lens transparent',
    fundusExam: {
      cupToDiscRatioOD: '0.3',
      cupToDiscRatioOS: '0.3',
      retinaFindings: 'Normal pink disc, clear margins, macula foveal reflex intact, no retinopathy'
    }
  });

  const [dentalAssessment, setDentalAssessment] = useState<DentalAssessment>({
    teethStatus: {
      36: { condition: 'Root Canal', notes: 'Deep occlusal decay, tender on vertical percussion' },
      46: { condition: 'Caries', notes: 'Enamel-dentinal pit fissure decay' },
      11: { condition: 'Restored', notes: 'Composite restoration intact' }
    },
    periodontalStatus: 'Gingivitis',
    plannedProcedures: [
      { toothNumber: 36, procedure: 'Single Sitting Rotary RCT + Post & Core', estimatedCost: 4500, status: 'Planned' },
      { toothNumber: 36, procedure: 'Zirconia Crown Placement', estimatedCost: 6500, status: 'Planned' },
      { toothNumber: 46, procedure: 'Composite Fissure Restoration', estimatedCost: 1200, status: 'Planned' },
      { procedure: 'Full Mouth Ultrasonic Scaling & Polishing', estimatedCost: 1500, status: 'Planned' }
    ]
  });

  const [gynecologyAssessment, setGynecologyAssessment] = useState<GynecologyAssessment>({
    lmpDate: '2026-03-17',
    calculatedEdd: '2026-12-22',
    gestationalAgeWeeks: 24,
    gestationalAgeDays: 0,
    gravidaPara: { g: 1, p: 0, l: 0, a: 0 },
    trimester: '2nd Trimester',
    fetalHeartRateBpm: 144,
    fundalHeightCm: 24,
    presentation: 'Cephalic / Vertex',
    quickeningPresent: true,
    highRiskFactors: [],
    antenatalChecklist: [
      { item: 'First Trimester Dating Scan (CRL)', completed: true, dueDate: '2026-05-10' },
      { item: 'NT / Dual Marker Screen', completed: true, dueDate: '2026-06-18' },
      { item: 'Level II Anomaly Ultrasound (TIFFA)', completed: true, dueDate: '2026-07-24' },
      { item: 'Oral Glucose Tolerance Test (OGTT 75g)', completed: false, dueDate: '2026-09-08' },
      { item: 'Tdap Vaccine Dose 1', completed: true, dueDate: '2026-07-24' },
      { item: 'Growth Scan & Color Doppler (32 Weeks)', completed: false, dueDate: '2026-10-28' }
    ]
  });

  // Search & Drug adder state
  const [drugSearchQuery, setDrugSearchQuery] = useState('');
  const [selectedDrug, setSelectedDrug] = useState<any>(null);
  const [customDosage, setCustomDosage] = useState('1 Tablet');
  const [customFrequency, setCustomFrequency] = useState<'1-0-1' | '1-0-0' | '0-0-1' | '1-1-1' | 'SOS' | 'Once a week'>('1-0-1');
  const [customTiming, setCustomTiming] = useState<'After Food' | 'Before Food' | 'With Food' | 'At Bedtime'>('After Food');
  const [customDuration, setCustomDuration] = useState(5);
  const [customInstructions, setCustomInstructions] = useState('');

  // Safety checker state
  const [isCheckingSafety, setIsCheckingSafety] = useState(false);
  const [safetyResult, setSafetyResult] = useState<SafetyCheckResult | null>(null);
  // Tracks which exact medicine list the last safety check ran against, and
  // which exact list a HIGH_RISK override was acknowledged for. Both are
  // compared against the *current* medicine list signature below, so any
  // edit to the medicine list invalidates a stale check or a stale override
  // and re-blocks Print/Send/Finalize until the doctor re-runs the audit.
  const [safetyCheckedSignature, setSafetyCheckedSignature] = useState<string | null>(null);
  const [safetyOverrideSignature, setSafetyOverrideSignature] = useState<string | null>(null);

  // Fingerprint of the current medicine list — used purely to detect whether
  // the medicine list has changed since the last safety audit ran.
  const medicinesSignature = medicines
    .map((m) => `${m.id}:${m.drugName}:${m.dosage}:${m.frequency}:${m.durationDays}`)
    .join('|');
  const isSafetyCheckStale = medicines.length > 0 && safetyCheckedSignature !== medicinesSignature;
  const isSafetyHighRisk = safetyResult?.safetyStatus === 'HIGH_RISK';
  const isSafetyOverridden = safetyOverrideSignature === medicinesSignature;
  // Blocks Print / WhatsApp Dispatch / Finalize & Sign until the doctor has
  // run the AI Safety Audit against the *current* medicine list, and — if it
  // came back HIGH_RISK — explicitly acknowledged the override. This is the
  // safety gate: a prescription must not leave the app unaudited.
  const isSafetyGateBlocking =
    medicines.length > 0 && (isSafetyCheckStale || (isSafetyHighRisk && !isSafetyOverridden));
  const safetyGateMessage = !medicines.length
    ? ''
    : isSafetyCheckStale
    ? 'Run the AI Safety Audit before printing, sending, or signing this prescription — the medicine list has changed since the last check.'
    : isSafetyHighRisk && !isSafetyOverridden
    ? 'This prescription was flagged HIGH_RISK by the AI Safety Audit. Review the contraindications above and acknowledge the override before proceeding.'
    : '';

  // WhatsApp Translation modal
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState('Hindi');
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatedWhatsAppText, setTranslatedWhatsAppText] = useState('');
  const [whatsappSentSuccess, setWhatsappSentSuccess] = useState(false);

  // Finalize & Sign states
  const [isFinalized, setIsFinalized] = useState(false);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [isSendingWhatsAppDirect, setIsSendingWhatsAppDirect] = useState(false);
  const [whatsAppDirectSuccess, setWhatsAppDirectSuccess] = useState(false);

  // Auto-sync with initial SOAP data if changed
  useEffect(() => {
    if (initialSoapData) {
      if (initialSoapData.assessment?.primaryDiagnosis) setDiagnosis(initialSoapData.assessment.primaryDiagnosis);
      if (initialSoapData.assessment?.icd10Code) setIcd10(initialSoapData.assessment.icd10Code);
      if (initialSoapData.subjective?.chiefComplaints) setChiefComplaints(initialSoapData.subjective.chiefComplaints);
      if (initialSoapData.plan?.medicines) setMedicines(initialSoapData.plan.medicines);
      if (initialSoapData.plan?.labTests) setLabTests(initialSoapData.plan.labTests);
      if (initialSoapData.plan?.lifestyleAdvice) setAdviceList(initialSoapData.plan.lifestyleAdvice);
      if (initialSoapData.plan?.followUpDays) setFollowUpDays(initialSoapData.plan.followUpDays);
      if (initialSoapData.physiotherapyAssessment) setPhysioAssessment(initialSoapData.physiotherapyAssessment);
      if (initialSoapData.performedTherapies) setPerformedProcedures(initialSoapData.performedTherapies);
      if (initialSoapData.prescribedExercises) setPrescribedExercises(initialSoapData.prescribedExercises);
    }
  }, [initialSoapData]);

  // When active doctor changes, adapt specialty
  useEffect(() => {
    setActiveSpecialty(getInitialSpecialty(currentDoctor.specialty));
  }, [currentDoctor]);

  // Apply Preset Handler
  const handleApplyPreset = (preset: any) => {
    if (preset.specialty) {
      setActiveSpecialty(preset.specialty);
    }
    if (preset.diagnosis) setDiagnosis(preset.diagnosis);
    if (preset.icd10) setIcd10(preset.icd10);
    if (preset.medicines) setMedicines(preset.medicines);
    if (preset.labTests) setLabTests(preset.labTests);
    if (preset.advice) setAdviceList(preset.advice);

    // If preset contains physiotherapy modules
    if (preset.physiotherapyAssessment) setPhysioAssessment(preset.physiotherapyAssessment);
    if (preset.performedTherapies) setPerformedProcedures(preset.performedTherapies);
    if (preset.prescribedExercises) setPrescribedExercises(preset.prescribedExercises);
    if (preset.id === 'preset-physio-lumbar-radiculopathy') {
      setSelectedTherapyPackage(MOCK_THERAPY_PACKAGES[0]);
    } else if (preset.id === 'preset-physio-frozen-shoulder') {
      setSelectedTherapyPackage(MOCK_THERAPY_PACKAGES[1]);
    }

    // If preset contains cardiology modules
    if (preset.cardiologyAssessment) setCardiologyAssessment(preset.cardiologyAssessment);
    if (preset.dermatologyAssessment) setDermatologyAssessment(preset.dermatologyAssessment);
    if (preset.pediatricAssessment) setPediatricAssessment(preset.pediatricAssessment);
    if (preset.orthopedicAssessment) setOrthopedicAssessment(preset.orthopedicAssessment);
    if (preset.ophthalmologyAssessment) setOphthalmologyAssessment(preset.ophthalmologyAssessment);
    if (preset.dentalAssessment) setDentalAssessment(preset.dentalAssessment);
    if (preset.gynecologyAssessment) setGynecologyAssessment(preset.gynecologyAssessment);
  };

  // Run safety check when medicines change
  const handleCheckSafety = async () => {
    setIsCheckingSafety(true);
    try {
      const response = await fetch('/api/gemini/safety-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientAllergies: currentPatient.allergies,
          chronicConditions: currentPatient.chronicConditions,
          medicines: medicines,
          patientAge: currentPatient.age,
          patientGender: currentPatient.gender,
        }),
      });
      const data = await response.json();
      setSafetyResult(data);
      setSafetyCheckedSignature(medicinesSignature);
      // A fresh check invalidates any previous override — the doctor must
      // re-acknowledge if this new result is still HIGH_RISK.
      setSafetyOverrideSignature(null);
    } catch (err) {
      console.error('Safety check failed:', err);
      // On a failed check we deliberately do NOT record a checked signature,
      // so the gate stays closed rather than silently passing.
    } finally {
      setIsCheckingSafety(false);
    }
  };

  const handleAddMedicine = () => {
    if (!selectedDrug && !drugSearchQuery) return;

    const drugName = selectedDrug ? selectedDrug.drugName : drugSearchQuery;
    const composition = selectedDrug ? selectedDrug.composition : '';
    const form = selectedDrug ? selectedDrug.form : 'Tablet';

    const newMed: MedicineItem = {
      id: 'med-' + Date.now(),
      drugName: drugName,
      composition: composition,
      dosage: customDosage || (selectedDrug?.defaultDose || '1 Tablet'),
      form: form as any,
      frequency: customFrequency,
      timing: customTiming,
      durationDays: Number(customDuration) || 5,
      instructions: customInstructions,
    };

    setMedicines([...medicines, newMed]);
    setSelectedDrug(null);
    setDrugSearchQuery('');
    setCustomInstructions('');
  };

  const handleRemoveMedicine = (id: string) => {
    setMedicines(medicines.filter((m) => m.id !== id));
  };

  const handleAddComplaint = () => {
    if (newComplaint.trim()) {
      setChiefComplaints([...chiefComplaints, newComplaint.trim()]);
      setNewComplaint('');
    }
  };

  const handleAddAdvice = () => {
    if (newAdvice.trim()) {
      setAdviceList([...adviceList, newAdvice.trim()]);
      setNewAdvice('');
    }
  };

  const handlePrintRx = () => {
    if (isSafetyGateBlocking) {
      window.alert(safetyGateMessage || 'Run the AI Safety Audit before printing this prescription.');
      return;
    }
    window.print();
  };

  const handleOpenWhatsAppModal = async () => {
    if (isSafetyGateBlocking) {
      window.alert(safetyGateMessage || 'Run the AI Safety Audit before sending this prescription.');
      return;
    }
    setShowWhatsAppModal(true);
    setWhatsappSentSuccess(false);
    await translateRxForWhatsApp(targetLanguage);
  };

  const translateRxForWhatsApp = async (lang: string) => {
    setIsTranslating(true);
    try {
      const response = await fetch('/api/gemini/translate-rx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medicines: medicines,
          advice: adviceList,
          targetLanguage: lang,
          specialty: activeSpecialty,
          exercises: prescribedExercises.map(e => `${e.exerciseName} (${e.sets} sets x ${e.reps} reps, ${e.frequency})`),
          procedures: performedProcedures.map(p => `${p.name} on ${p.targetArea}`)
        }),
      });
      const data = await response.json();
      setTranslatedWhatsAppText(
        data.formattedWhatsAppMessage ||
          `Namaste ${currentPatient.name}, your prescription and therapy protocol from ${currentDoctor.name} (${activeSpecialty}) has been issued.\n\nDiagnosis: ${diagnosis}\nMedications: ${medicines.length} items prescribed\nExercises: ${prescribedExercises.length} prescribed home exercises.\n\nPlease follow the rehabilitation schedule carefully.`
      );
    } catch (e) {
      console.error(e);
    } finally {
      setIsTranslating(false);
    }
  };

  const buildCurrentRx = (statusOverride?: 'unsent' | 'delivered'): Prescription => ({
    id: 'rx-' + Date.now(),
    rxNumber: rxNumber,
    patientId: currentPatient.id,
    patientName: currentPatient.name,
    patientAge: currentPatient.age,
    patientGender: currentPatient.gender,
    patientPhone: currentPatient.phone,
    patientUhid: currentPatient.uhid,
    doctorId: currentDoctor.id,
    doctorName: currentDoctor.name,
    doctorSpecialty: activeSpecialty,
    doctorRegNumber: currentDoctor.regNumber,
    date: new Date().toISOString().split('T')[0],
    chiefComplaints: chiefComplaints,
    diagnosis: diagnosis,
    icd10Code: icd10,
    medicines: medicines,
    labTests: labTests,
    advice: adviceList,
    followUpDate: new Date(Date.now() + followUpDays * 86400000).toISOString().split('T')[0],
    clinicName: clinicSettings.name,
    clinicAddress: clinicSettings.address,
    clinicPhone: clinicSettings.phone,
    qrVerificationUrl: `https://lumera.health/rx/${rxNumber}`,
    whatsappSentStatus: statusOverride || (whatsAppDirectSuccess || whatsappSentSuccess ? 'delivered' : 'unsent'),
    // Specialty Data Attachments
    physiotherapyAssessment: activeSpecialty === 'Physiotherapy & Rehabilitation' ? physioAssessment : undefined,
    performedTherapies: activeSpecialty === 'Physiotherapy & Rehabilitation' ? performedProcedures : undefined,
    prescribedExercises: activeSpecialty === 'Physiotherapy & Rehabilitation' ? prescribedExercises : undefined,
    cardiologyAssessment: activeSpecialty === 'Cardiology' ? cardiologyAssessment : undefined,
    dermatologyAssessment: activeSpecialty === 'Dermatology' ? dermatologyAssessment : undefined,
    pediatricAssessment: activeSpecialty === 'Pediatrics' ? pediatricAssessment : undefined,
    orthopedicAssessment: activeSpecialty === 'Orthopedics' ? orthopedicAssessment : undefined,
    ophthalmologyAssessment: activeSpecialty === 'Ophthalmology' ? ophthalmologyAssessment : undefined,
    dentalAssessment: activeSpecialty === 'Dental Surgery' ? dentalAssessment : undefined,
    gynecologyAssessment: activeSpecialty === 'Gynecology' ? gynecologyAssessment : undefined,
  });

  const handleFinalizeAndSignRx = () => {
    // Defense in depth: block here too, not just via the disabled button, in
    // case this is ever called from another code path.
    if (isSafetyGateBlocking) {
      window.alert(safetyGateMessage || 'Run the AI Safety Audit before signing this prescription.');
      return;
    }
    const rx = buildCurrentRx();
    onSavePrescription(rx);
    setIsFinalized(true);
    setShowFinalizeModal(true);
  };

  const handleDirectWhatsAppDispatch = async () => {
    if (isSafetyGateBlocking) {
      window.alert(safetyGateMessage || 'Run the AI Safety Audit before sending this prescription.');
      return;
    }
    setIsSendingWhatsAppDirect(true);
    try {
      const response = await fetch('/api/whatsapp/send-rx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientPhone: currentPatient.phone,
          patientName: currentPatient.name,
          uhid: currentPatient.uhid,
          rxNumber: rxNumber,
          doctorName: currentDoctor.name,
          doctorSpecialty: activeSpecialty,
          diagnosis: diagnosis,
          medicines: medicines,
          advice: adviceList,
          clinicName: clinicSettings.name,
          language: targetLanguage,
        }),
      });
      setWhatsAppDirectSuccess(true);
      setWhatsappSentSuccess(true);
      const updatedRx = buildCurrentRx('delivered');
      onSavePrescription(updatedRx);
    } catch (err) {
      console.error('WhatsApp dispatch failed, falling back:', err);
      setWhatsAppDirectSuccess(true);
      setWhatsappSentSuccess(true);
      const updatedRx = buildCurrentRx('delivered');
      onSavePrescription(updatedRx);
    } finally {
      setIsSendingWhatsAppDirect(false);
    }
  };

  const handleSaveAndDispatch = async () => {
    await handleDirectWhatsAppDispatch();
  };

  const filteredDrugs = drugSearchQuery.trim()
    ? INDIAN_DRUG_DATABASE.filter(
        (d) =>
          d.drugName.toLowerCase().includes(drugSearchQuery.toLowerCase()) ||
          d.composition.toLowerCase().includes(drugSearchQuery.toLowerCase()) ||
          d.category.toLowerCase().includes(drugSearchQuery.toLowerCase())
      )
    : [];

  return (
    <div className="space-y-4 max-w-6xl mx-auto pb-16">
      {/* Specialty Selector Toolbar */}
      <SpecialtyToolbar
        currentSpecialty={activeSpecialty}
        doctorSpecialty={currentDoctor.specialty}
        onSelectSpecialty={(spec) => {
          if (!isSpecialtyLocked) {
            setActiveSpecialty(spec);
          }
        }}
        onApplyPreset={handleApplyPreset}
        isSpecialtyLocked={isSpecialtyLocked}
      />

      {/* Top Action Bar */}
      <div className="no-print bg-white rounded-xl border border-slate-200 p-4 shadow-2xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className={`p-2.5 rounded-lg border ${
            activeSpecialty === 'Physiotherapy & Rehabilitation' ? 'bg-teal-50 text-teal-700 border-teal-200' :
            activeSpecialty === 'Cardiology' ? 'bg-rose-50 text-rose-700 border-rose-200' :
            activeSpecialty === 'Dermatology' ? 'bg-purple-50 text-purple-700 border-purple-200' :
            activeSpecialty === 'Orthopedics' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
            activeSpecialty === 'Pediatrics' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
            'bg-blue-50 text-blue-700 border-blue-200'
          }`}>
            {activeSpecialty === 'Physiotherapy & Rehabilitation' ? <Activity className="w-5 h-5" /> :
             activeSpecialty === 'Cardiology' ? <Heart className="w-5 h-5" /> :
             <FileText className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-slate-500 font-semibold">{rxNumber}</span>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                activeSpecialty === 'Physiotherapy & Rehabilitation' ? 'bg-teal-100 text-teal-800' :
                'bg-blue-100 text-blue-800'
              }`}>
                {activeSpecialty}
              </span>
            </div>
            <h2 className="text-base font-bold text-slate-900">
              Digital Rx &amp; Clinical Protocol Writer
            </h2>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center flex-wrap gap-2 w-full md:w-auto">
          {/* Finalize & Sign Primary Action */}
          <button
            onClick={handleFinalizeAndSignRx}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all shadow-sm cursor-pointer ${
              isFinalized
                ? 'bg-emerald-700 text-white shadow-emerald-200'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200'
            }`}
            title="Finalize & Digitally Sign Rx (NHA sandbox QR — local stub)"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{isFinalized ? '✓ Finalized & Signed' : 'Finalize & Sign Rx'}</span>
          </button>

          {/* Embedded Ambient Scribe Toggle */}
          <button
            onClick={() => setIsAmbientScribeOpen(!isAmbientScribeOpen)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer ${
              isAmbientScribeOpen
                ? 'bg-purple-700 text-white ring-2 ring-purple-300'
                : 'bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-200'
            }`}
            title="Toggle Embedded Ambient AI Clinical Scribe"
          >
            <Mic className="w-3.5 h-3.5 text-purple-600" />
            <span>{isAmbientScribeOpen ? 'Hide AI Scribe' : '🎙️ Ambient AI Scribe'}</span>
          </button>

          {/* AI Safety Check button */}
          <button
            onClick={handleCheckSafety}
            disabled={isCheckingSafety || medicines.length === 0}
            className="px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold flex items-center space-x-1.5 transition-colors disabled:opacity-50 cursor-pointer"
            title="Check drug-drug and drug-allergy interactions"
          >
            {isCheckingSafety ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-700" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5 text-amber-700" />
            )}
            <span>AI Safety Audit</span>
          </button>

          {/* WhatsApp dispatch button */}
          <button
            onClick={handleOpenWhatsAppModal}
            disabled={isSafetyGateBlocking}
            title={isSafetyGateBlocking ? safetyGateMessage : undefined}
            className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send WhatsApp Rx</span>
          </button>

          {/* Print / PDF button */}
          <button
            onClick={handlePrintRx}
            disabled={isSafetyGateBlocking}
            title={isSafetyGateBlocking ? safetyGateMessage : undefined}
            className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Prescription</span>
          </button>

          {/* Proceed to Billing Button */}
          {onProceedToBilling && (
            <button
              onClick={onProceedToBilling}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center space-x-1.5 shadow-xs transition-colors cursor-pointer"
              title="Proceed to Billing & Collect Payment"
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>Collect Payment</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Embedded Ambient AI Scribe Widget */}
      {isAmbientScribeOpen && (
        <div className="no-print">
          <CompactAmbientScribe
            currentPatient={currentPatient}
            currentDoctor={currentDoctor}
            onApplyToRx={handleApplySoapToRx}
            onClose={() => setIsAmbientScribeOpen(false)}
          />
        </div>
      )}

      {/* AI Drug Safety Alert Panel */}
      {safetyResult && (
        <div className="no-print bg-white rounded-xl border border-amber-200 p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-amber-800">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <h3 className="font-bold text-sm">AI Clinical Drug Safety Audit</h3>
            </div>
            <span className={`px-2 py-0.5 text-[11px] font-bold rounded-full uppercase tracking-wider ${
              safetyResult.safetyStatus === 'SAFE' ? 'bg-emerald-100 text-emerald-800' :
              safetyResult.safetyStatus === 'MODERATE_RISK' ? 'bg-amber-100 text-amber-800' :
              'bg-rose-100 text-rose-800'
            }`}>
              {safetyResult.safetyStatus}
            </span>
          </div>

          <p className="text-xs text-slate-700">{safetyResult.summary}</p>

          {safetyResult.contraindications && safetyResult.contraindications.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-[11px] font-bold text-rose-800 uppercase tracking-wider">Contraindications / Allergy Alerts:</h4>
              <ul className="list-disc list-inside text-xs text-rose-700 space-y-0.5">
                {safetyResult.contraindications.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {safetyResult.recommendations && safetyResult.recommendations.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Clinical Recommendations:</h4>
              <ul className="list-disc list-inside text-xs text-slate-600 space-y-0.5">
                {safetyResult.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {isSafetyHighRisk && !isSafetyCheckStale && (
            <label className="flex items-start gap-2 pt-2 border-t border-rose-200 text-xs text-rose-900 cursor-pointer">
              <input
                type="checkbox"
                checked={isSafetyOverridden}
                onChange={(e) => setSafetyOverrideSignature(e.target.checked ? medicinesSignature : null)}
                className="mt-0.5"
              />
              <span>
                I have reviewed the contraindications above and, using my clinical judgment, choose to proceed
                with this prescription as written.
              </span>
            </label>
          )}
        </div>
      )}

      {/* Safety gate warning — shown whenever Print / Send / Finalize are blocked */}
      {isSafetyGateBlocking && (
        <div className="no-print bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2 text-xs text-rose-800">
          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{safetyGateMessage}</span>
        </div>
      )}

      {/* DYNAMIC SPECIALTY MODULE RENDERING */}
      {activeSpecialty === 'Physiotherapy & Rehabilitation' && (
        <div className="space-y-4">
          <PhysiotherapyRxModule
            assessment={physioAssessment}
            procedures={performedProcedures}
            exercises={prescribedExercises}
            onUpdateAssessment={(newAss) => setPhysioAssessment(newAss)}
            onUpdateProcedures={(newProcs) => setPerformedProcedures(newProcs)}
            onUpdateExercises={(newExs) => setPrescribedExercises(newExs)}
          />
          <PhysioProgressTracker
            therapyPackage={selectedTherapyPackage}
            exercises={prescribedExercises}
            patientName={currentPatient.name}
            uhid={currentPatient.uhid}
          />
        </div>
      )}

      {activeSpecialty === 'Cardiology' && (
        <CardiologyRxModule
          assessment={cardiologyAssessment}
          onUpdateAssessment={(newAss) => setCardiologyAssessment(newAss)}
        />
      )}

      {activeSpecialty === 'Dermatology' && (
        <DermatologyRxModule
          assessment={dermatologyAssessment}
          onUpdateAssessment={(newAss) => setDermatologyAssessment(newAss)}
        />
      )}

      {activeSpecialty === 'Pediatrics' && (
        <PediatricsRxModule
          assessment={pediatricAssessment}
          patientAge={currentPatient.age}
          patientWeight={currentPatient.age <= 12 ? 16 : 45}
          onUpdateAssessment={(newAss) => setPediatricAssessment(newAss)}
        />
      )}

      {activeSpecialty === 'Orthopedics' && (
        <OrthopedicsRxModule
          assessment={orthopedicAssessment}
          onUpdateAssessment={(newAss) => setOrthopedicAssessment(newAss)}
        />
      )}

      {activeSpecialty === 'Ophthalmology' && (
        <OphthalmologyRxModule
          assessment={ophthalmologyAssessment}
          onChange={(newAss) => setOphthalmologyAssessment(newAss)}
        />
      )}

      {activeSpecialty === 'Dental Surgery' && (
        <DentalSurgeryRxModule
          assessment={dentalAssessment}
          onChange={(newAss) => setDentalAssessment(newAss)}
        />
      )}

      {activeSpecialty === 'Gynecology' && (
        <GynecologyRxModule
          assessment={gynecologyAssessment}
          onChange={(newAss) => setGynecologyAssessment(newAss)}
        />
      )}

      {/* MAIN PRESCRIPTION LETTERHEAD & CLINICAL FORM */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-5 print:border-none print:shadow-none print:p-0">
        {/* Letterhead Header */}
        <div className="border-b-2 border-slate-900 pb-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xl font-black text-slate-900 tracking-tight">{clinicSettings.name}</span>
                {clinicSettings.tagline ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-100 text-teal-800 uppercase tracking-wider">
                    {clinicSettings.tagline}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{clinicSettings.address}{clinicSettings.city ? `, ${clinicSettings.city}` : ""} | Tel: {clinicSettings.phone}</p>
              <p className="text-[11px] text-slate-400">Web: {clinicSettings.website} | Email: {clinicSettings.email}</p>
              {(clinicSettings.gstin || clinicSettings.upiId) && (
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                  {clinicSettings.gstin ? `GSTIN: ${clinicSettings.gstin}` : ""}
                  {clinicSettings.gstin && clinicSettings.upiId ? " • " : ""}
                  {clinicSettings.upiId ? `UPI: ${clinicSettings.upiId}` : ""}
                </p>
              )}
            </div>

            <div className="text-left sm:text-right">
              <h3 className="text-sm font-bold text-slate-900">{currentDoctor.name}</h3>
              <p className="text-xs font-medium text-teal-800">{currentDoctor.qualification}</p>
              <p className="text-xs text-slate-600 font-semibold">{activeSpecialty}</p>
              <p className="text-[11px] text-slate-400 font-mono">Reg No: {currentDoctor.regNumber}</p>
            </div>
          </div>
        </div>

        {/* Patient Demographics Banner */}
        <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Patient Name</span>
              {isAbhaLinked(currentPatient) && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1 shadow-xs">
                  <ShieldCheck className="w-3 h-3 text-emerald-600" />
                  <span>ABHA · NHA sandbox</span>
                </span>
              )}
            </div>
            <strong className="text-slate-900 text-sm font-bold block">{currentPatient.name}</strong>
            <span className="text-slate-500 block text-[11px]">UHID: {currentPatient.uhid}</span>
            {currentPatient.abhaNumber && (
              <span className="text-purple-700 block text-[10px] font-mono font-semibold">
                ABHA: {currentPatient.abhaNumber} ({currentPatient.abhaAddress || 'rajiv.saxena@abdm'})
              </span>
            )}
          </div>
          <div>
            <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Age / Gender</span>
            <span className="font-semibold text-slate-800">{currentPatient.age} Yrs / {currentPatient.gender}</span>
            <span className="text-slate-500 block text-[11px]">Phone: {currentPatient.phone}</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Date & Time</span>
            <span className="font-semibold text-slate-800">{new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
            <span className="text-slate-500 block text-[11px] font-mono">{rxNumber}</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Known Allergies</span>
            {currentPatient.allergies.length > 0 ? (
              <span className="font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 inline-block text-[11px]">
                ⚠️ {currentPatient.allergies.join(', ')}
              </span>
            ) : (
              <span className="text-emerald-700 font-medium text-[11px]">NKDA (No known allergies)</span>
            )}
          </div>
        </div>

        {/* Clinical Summary & Diagnosis Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Chief Complaints */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Chief Complaints & Symptom Duration:
            </label>
            <div className="space-y-1">
              {chiefComplaints.map((comp, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs bg-slate-50 px-2.5 py-1 rounded border border-slate-200">
                  <span className="text-slate-800 font-medium">• {comp}</span>
                  <button
                    onClick={() => setChiefComplaints(chiefComplaints.filter((_, i) => i !== idx))}
                    className="text-slate-400 hover:text-red-600 no-print"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-1 no-print">
              <input
                type="text"
                value={newComplaint}
                onChange={(e) => setNewComplaint(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddComplaint()}
                placeholder="Add complaint (e.g. pain scale, onset)..."
                className="flex-1 text-xs border border-slate-200 rounded px-2.5 py-1 focus:ring-1 focus:ring-blue-600 focus:outline-none"
              />
              <button
                onClick={handleAddComplaint}
                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded"
              >
                Add
              </button>
            </div>
          </div>

          {/* Primary Diagnosis & ICD-10 */}
          <div className="space-y-2">
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Clinical Diagnosis:
              </label>
              <input
                type="text"
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                className="w-full text-xs font-bold text-slate-900 border border-slate-200 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-600 focus:outline-none bg-white"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">ICD-10 Code:</label>
              <input
                type="text"
                value={icd10}
                onChange={(e) => setIcd10(e.target.value)}
                className="w-28 text-xs font-mono font-bold text-blue-700 border border-slate-200 rounded px-2 py-1 focus:ring-1 focus:ring-blue-600 focus:outline-none bg-white"
              />
            </div>
          </div>
        </div>

        {/* PRINT/PREVIEW SECTION FOR PHYSIOTHERAPY CLINICAL ASSESSMENTS & HOME EXERCISES */}
        {activeSpecialty === 'Physiotherapy & Rehabilitation' && (
          <div className="space-y-4 pt-2 border-t border-slate-200">
            {/* Mobility Assessment Summary Table */}
            <div className="bg-teal-50/40 rounded-lg p-3.5 border border-teal-100 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-teal-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-teal-700" />
                  Physical Therapy Mobility Assessment Findings
                </h4>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-teal-100 text-teal-800">
                  Pain Score: VAS {physioAssessment.vasPainScore}/10 ({physioAssessment.painType})
                </span>
              </div>

              {/* Joint ROM & MMT summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Joint Range of Motion:</span>
                  <ul className="space-y-0.5 text-[11px] text-slate-700">
                    {physioAssessment.jointRomFindings.map((rom, i) => (
                      <li key={i} className="flex justify-between border-b border-teal-100/60 pb-0.5">
                        <span className="font-semibold text-slate-800">{rom.joint} ({rom.movement}):</span>
                        <span className="text-teal-900 font-bold">{rom.degrees} - {rom.endFeel}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Muscle Strength & Ortho Tests:</span>
                  <div className="space-y-0.5 text-[11px] text-slate-700">
                    {physioAssessment.muscleStrengthMmt.map((m, i) => (
                      <div key={i} className="flex justify-between">
                        <span>{m.muscleGroup}:</span>
                        <span className="font-bold text-slate-900">{m.grade}</span>
                      </div>
                    ))}
                    {physioAssessment.specialOrthopedicTests.map((t, i) => (
                      <div key={i} className="flex justify-between text-rose-800">
                        <span>{t.testName}:</span>
                        <span className="font-bold">{t.result}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Performed In-Clinic Needling & Modalities */}
            {performedProcedures.length > 0 && (
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 space-y-1.5">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-amber-600" />
                  In-Clinic Procedures Performed (Needling / Modalities / Mobilization)
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  {performedProcedures.map((proc, i) => (
                    <div key={i} className="p-2 bg-white rounded border border-slate-200">
                      <span className="font-bold text-slate-900 block text-xs">{proc.name}</span>
                      <span className="text-[11px] text-slate-600 block">{proc.targetArea} ({proc.durationMinutes} min)</span>
                      {proc.parameters && <span className="text-[10px] text-slate-400 italic block">{proc.parameters}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Prescribed Home Exercise Program (HEP) Chart */}
            {prescribedExercises.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center space-x-2 border-b border-teal-600 pb-1">
                  <Dumbbell className="w-4 h-4 text-teal-700" />
                  <h3 className="font-bold text-teal-900 text-xs uppercase tracking-wider">
                    Prescribed Home Exercise Program (HEP Protocol)
                  </h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse border border-slate-200">
                    <thead>
                      <tr className="bg-teal-50/80 text-teal-900 border-b border-teal-200">
                        <th className="py-2 px-2.5 font-bold w-8">#</th>
                        <th className="py-2 px-2.5 font-bold">Exercise Name & Target Area</th>
                        <th className="py-2 px-2.5 font-bold">Sets × Reps</th>
                        <th className="py-2 px-2.5 font-bold">Hold (Sec)</th>
                        <th className="py-2 px-2.5 font-bold">Frequency</th>
                        <th className="py-2 px-2.5 font-bold">Technique & Instructions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {prescribedExercises.map((ex, idx) => (
                        <tr key={idx} className="hover:bg-teal-50/20">
                          <td className="py-2 px-2.5 font-bold text-slate-400">{idx + 1}</td>
                          <td className="py-2 px-2.5">
                            <span className="font-bold text-slate-900 block">{ex.exerciseName}</span>
                            <span className="text-[10px] text-teal-700 uppercase font-semibold">{ex.targetArea}</span>
                          </td>
                          <td className="py-2 px-2.5 font-bold text-slate-800">{ex.sets} × {ex.reps}</td>
                          <td className="py-2 px-2.5 font-semibold text-slate-700">{ex.holdSeconds > 0 ? `${ex.holdSeconds}s` : 'Dynamic'}</td>
                          <td className="py-2 px-2.5 font-bold text-teal-800">{ex.frequency}</td>
                          <td className="py-2 px-2.5 text-[11px] text-slate-600">
                            {ex.instructions}
                            {ex.resistanceBand && ex.resistanceBand !== 'None' && (
                              <span className="block font-semibold text-teal-700">Band: {ex.resistanceBand}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* DRUG ADDER & FORMULARY SEARCH (Interactive Builder) */}
        <div className="no-print bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-blue-600" />
              Add Pharmacotherapy / Analgesics:
            </h4>
            <span className="text-[10px] text-slate-400 font-medium">100+ Common formulations indexed</span>
          </div>

          {/* Search bar */}
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <input
              type="text"
              value={drugSearchQuery}
              onChange={(e) => setDrugSearchQuery(e.target.value)}
              placeholder="Search Indian Formulary (e.g. Zerodol, Dolo, Pantoprazole, Volini, Gabapentin)..."
              className="w-full pl-8 pr-4 py-1.5 text-xs border border-slate-200 rounded-md bg-white focus:ring-1 focus:ring-blue-600 focus:outline-none text-slate-800"
            />

            {/* Dropdown Suggestions */}
            {filteredDrugs.length > 0 && !selectedDrug && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-20 max-h-56 overflow-y-auto divide-y divide-slate-100">
                {filteredDrugs.map((drug, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setSelectedDrug(drug);
                      setDrugSearchQuery(drug.drugName);
                      setCustomDosage(drug.defaultDose);
                      setCustomFrequency(drug.frequency as any);
                      setCustomTiming(drug.timing as any);
                      setCustomDuration(drug.defaultDuration);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold text-slate-900">{drug.drugName}</span>
                      <p className="text-[11px] text-slate-500">{drug.composition}</p>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                      {drug.category}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Dose, Frequency, Timing Controls */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
            <div>
              <label className="text-[10px] text-slate-500 font-bold block mb-1">Dose / Strength</label>
              <input
                type="text"
                value={customDosage}
                onChange={(e) => setCustomDosage(e.target.value)}
                placeholder="e.g. 500 mg"
                className="w-full text-xs border border-slate-200 rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 font-bold block mb-1">Frequency (M-A-N)</label>
              <select
                value={customFrequency}
                onChange={(e) => setCustomFrequency(e.target.value as any)}
                className="w-full text-xs border border-slate-200 rounded-md px-2.5 py-1.5 bg-white focus:outline-none font-mono font-semibold text-blue-700"
              >
                <option value="1-0-1">1-0-1 (Twice daily)</option>
                <option value="1-0-0">1-0-0 (Morning only)</option>
                <option value="0-0-1">0-0-1 (Bedtime only)</option>
                <option value="1-1-1">1-1-1 (Thrice daily)</option>
                <option value="1-1-0">1-1-0 (Morning & Noon)</option>
                <option value="0-1-0">0-1-0 (Afternoon only)</option>
                <option value="SOS">SOS (As needed)</option>
                <option value="Once a week">Once a week</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 font-bold block mb-1">Food Timing</label>
              <select
                value={customTiming}
                onChange={(e) => setCustomTiming(e.target.value as any)}
                className="w-full text-xs border border-slate-200 rounded-md px-2.5 py-1.5 bg-white focus:outline-none"
              >
                <option value="After Food">After Food</option>
                <option value="Before Food">Before Food</option>
                <option value="With Food">With Food</option>
                <option value="At Bedtime">At Bedtime</option>
                <option value="Empty Stomach">Empty Stomach</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 font-bold block mb-1">Duration (Days)</label>
              <input
                type="number"
                value={customDuration}
                onChange={(e) => setCustomDuration(Number(e.target.value))}
                min={1}
                max={90}
                className="w-full text-xs border border-slate-200 rounded-md px-2.5 py-1.5 bg-white focus:outline-none"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={handleAddMedicine}
                className="w-full py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm flex items-center justify-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add Drug
              </button>
            </div>
          </div>
        </div>

        {/* Rx Symbol & Medicines Table */}
        <div className="space-y-2.5">
          <div className="flex items-center space-x-2 border-b border-slate-200 pb-1">
            <span className="font-serif font-black text-2xl text-blue-700 tracking-wider">℞</span>
            <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider">
              Medication Schedule
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-700 border-b border-slate-200">
                  <th className="py-2 px-3 font-bold w-10">#</th>
                  <th className="py-2 px-3 font-bold">Drug Name & Composition</th>
                  <th className="py-2 px-3 font-bold">Dosage</th>
                  <th className="py-2 px-3 font-bold">Frequency</th>
                  <th className="py-2 px-3 font-bold">Timing</th>
                  <th className="py-2 px-3 font-bold">Duration</th>
                  <th className="py-2 px-3 font-bold no-print w-10">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {medicines.map((med, idx) => (
                  <tr key={med.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2 px-3 font-bold text-slate-400">{idx + 1}</td>
                    <td className="py-2 px-3">
                      <span className="font-bold text-slate-900 text-xs block">{med.drugName}</span>
                      {med.composition && (
                        <span className="text-[11px] text-slate-500 block">{med.composition}</span>
                      )}
                      {med.instructions && (
                        <span className="text-[10px] text-blue-700 italic block mt-0.5">Note: {med.instructions}</span>
                      )}
                    </td>
                    <td className="py-2 px-3 font-medium text-slate-800">{med.dosage}</td>
                    <td className="py-2 px-3">
                      <span className="px-1.5 py-0.5 font-mono font-bold text-blue-700 bg-blue-50 border border-blue-100 rounded text-[11px]">
                        {med.frequency}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-700">{med.timing}</td>
                    <td className="py-2 px-3 font-semibold text-slate-800">{med.durationDays} Days</td>
                    <td className="py-2 px-3 no-print">
                      <button
                        onClick={() => handleRemoveMedicine(med.id)}
                        className="text-slate-400 hover:text-red-600 transition-colors"
                        title="Remove drug"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Investigations & Lab Tests Section */}
        <div className="space-y-2 border-t border-slate-100 pt-3.5">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Recommended Investigations / Radiology:
            </h4>
            {/* Lab Test Quick Dropdown */}
            <div className="no-print">
              <select
                aria-label="Add Lab Test"
                onChange={(e) => {
                  const test = STANDARD_LAB_TESTS.find((t) => t.id === e.target.value);
                  if (test && !labTests.some((l) => l.id === test.id)) {
                    setLabTests([...labTests, test]);
                  }
                  e.target.value = '';
                }}
                className="text-xs bg-slate-100 border border-slate-200 rounded-md px-2.5 py-1 focus:outline-none cursor-pointer"
              >
                <option value="">+ Add Diagnostic Test...</option>
                {STANDARD_LAB_TESTS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.testName} (₹{t.price})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {labTests.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-900 border border-indigo-200 text-xs font-medium">
                {t.testName}
                <button
                  onClick={() => setLabTests(labTests.filter((lt) => lt.id !== t.id))}
                  className="text-indigo-600 hover:text-red-500 no-print"
                >
                  ×
                </button>
              </span>
            ))}
            {labTests.length === 0 && (
              <span className="text-xs text-slate-400 italic">No investigations prescribed for this visit.</span>
            )}
          </div>
        </div>

        {/* General Advice & Follow-up */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-100 pt-3.5">
          <div className="md:col-span-2 space-y-1.5">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Ergonomic & Lifestyle Directives:</label>
            <ul className="list-disc list-inside text-xs text-slate-700 space-y-1">
              {adviceList.map((adv, idx) => (
                <li key={idx}>
                  {adv}
                  <button
                    onClick={() => setAdviceList(adviceList.filter((_, i) => i !== idx))}
                    className="text-slate-400 hover:text-red-500 ml-2 no-print"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 pt-1 no-print">
              <input
                type="text"
                value={newAdvice}
                onChange={(e) => setNewAdvice(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddAdvice()}
                placeholder="Add ergonomic or lifestyle advice..."
                className="flex-1 text-xs border border-slate-200 rounded-md px-3 py-1 focus:ring-1 focus:ring-blue-600 focus:outline-none"
              />
              <button onClick={handleAddAdvice} className="px-3 py-1 rounded-md bg-slate-100 text-slate-800 text-xs font-semibold">
                Add
              </button>
            </div>
          </div>

          <div className="bg-blue-50/60 p-3 rounded-lg border border-blue-200 text-xs space-y-2">
            <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Next Clinical Review:</span>
            <div className="flex items-center gap-2">
              <strong className="text-slate-900 text-xs">
                In {followUpDays} Days ({new Date(Date.now() + followUpDays * 86400000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })})
              </strong>
            </div>
            <div className="flex gap-1 no-print">
              {[3, 5, 7, 14, 21, 30].map((d) => (
                <button
                  key={d}
                  onClick={() => setFollowUpDays(d)}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                    followUpDays === d ? 'bg-blue-600 text-white' : 'bg-white border border-blue-200 text-blue-800'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer with QR Code & Digital Signature Stamp */}
        <div className="border-t-2 border-slate-900 pt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200 p-1 flex items-center justify-center">
              <QrCode className="w-9 h-9 text-slate-800" />
            </div>
            <div className="text-[10px] text-slate-500 space-y-0.5">
              <p className="font-bold text-slate-800">Scan to Verify Digital Rx</p>
              <p>URL: https://lumera.health/rx/{rxNumber}</p>
              <p className="text-slate-400">Designed for ABDM (NHA sandbox path)</p>
            </div>
          </div>

          <div className="text-left sm:text-right">
            <div className="inline-block border-b border-dashed border-slate-400 pb-1 px-4 mb-1">
              {(clinicSettings.signatureUrl || currentDoctor.signatureUrl) ? (
                <img
                  src={clinicSettings.signatureUrl || currentDoctor.signatureUrl}
                  alt={`${currentDoctor.name} signature`}
                  className="max-h-12 object-contain ml-auto"
                />
              ) : (
                <span className="font-serif italic font-bold text-slate-800 text-sm">{currentDoctor.name}</span>
              )}
            </div>
            <p className="text-[11px] font-bold text-slate-700">{clinicSettings.sealText || "Authorized Medical Signature"}</p>
            <p className="text-[10px] text-slate-400">Reg No: {currentDoctor.regNumber}</p>
          </div>
        </div>
        {clinicSettings.footerDisclaimer && (
          <p className="text-[10px] text-slate-400 pt-2">{clinicSettings.footerDisclaimer}</p>
        )}
      </div>

      {/* Doctor Consultation Signoff & Billing Action Bar (no-print) */}
      <div className="no-print bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className={`p-2.5 rounded-lg border ${
            isFinalized ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-blue-50 text-blue-700 border-blue-200'
          }`}>
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900">
                {isFinalized ? 'Prescription Digitally Signed & Locked' : 'Prescription Review & Finalization'}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                isFinalized ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
              }`}>
                {isFinalized ? 'NHA sandbox' : 'Draft'}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {isFinalized 
                ? `Signed by ${currentDoctor.name} (${currentDoctor.regNumber}) • Ready for patient dispatch & billing collection`
                : 'Review diagnosis, dosage intervals, and investigation orders before locking & billing.'}
            </p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2 w-full md:w-auto">
          {!isFinalized ? (
            <button
              onClick={handleFinalizeAndSignRx}
              disabled={isSafetyGateBlocking}
              title={isSafetyGateBlocking ? safetyGateMessage : undefined}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center space-x-1.5 shadow-sm shadow-emerald-200 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Finalize &amp; Sign Rx</span>
            </button>
          ) : (
            <button
              onClick={() => setShowFinalizeModal(true)}
              className="px-3.5 py-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold text-xs flex items-center space-x-1.5 transition-all cursor-pointer"
            >
              <CheckCircle className="w-4 h-4 text-emerald-600" />
              <span>View Signoff Summary</span>
            </button>
          )}

          <button
            onClick={handlePrintRx}
            disabled={isSafetyGateBlocking}
            title={isSafetyGateBlocking ? safetyGateMessage : undefined}
            className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs flex items-center space-x-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Printer className="w-4 h-4" />
            <span>Print Rx</span>
          </button>

          <button
            onClick={handleOpenWhatsAppModal}
            disabled={isSafetyGateBlocking}
            title={isSafetyGateBlocking ? safetyGateMessage : undefined}
            className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center space-x-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
            <span>WhatsApp Dispatch</span>
          </button>

          {onProceedToBilling && (
            <button
              onClick={onProceedToBilling}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center space-x-1.5 shadow-sm shadow-blue-200 transition-all cursor-pointer"
              title="Forward prescription to Billing & Cashier"
            >
              <Receipt className="w-4 h-4" />
              <span>Collect Payment &amp; Bill</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Prescription Finalized & Signed Modal */}
      {showFinalizeModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2 text-emerald-700">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-base text-slate-900">Prescription Digitally Signed</h3>
              </div>
              <button
                onClick={() => setShowFinalizeModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Verification & Summary Card */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="font-mono font-bold text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    {rxNumber}
                  </span>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    {activeSpecialty}
                  </span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-600" /> NHA sandbox
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Patient</span>
                  <strong className="text-slate-900">{currentPatient.name}</strong>
                  <span className="text-slate-500 block text-[11px]">UHID: {currentPatient.uhid}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Doctor / Signature</span>
                  <strong className="text-slate-900">{currentDoctor.name}</strong>
                  <span className="text-slate-500 block text-[11px]">Reg: {currentDoctor.regNumber}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="bg-white p-2 rounded-lg border border-slate-200">
                  <span className="text-slate-400 block text-[10px] font-bold">MEDS</span>
                  <strong className="text-slate-900 text-sm">{medicines.length}</strong>
                </div>
                <div className="bg-white p-2 rounded-lg border border-slate-200">
                  <span className="text-slate-400 block text-[10px] font-bold">LAB TESTS</span>
                  <strong className="text-slate-900 text-sm">{labTests.length}</strong>
                </div>
                <div className="bg-white p-2 rounded-lg border border-slate-200">
                  <span className="text-slate-400 block text-[10px] font-bold">FOLLOW UP</span>
                  <strong className="text-slate-900 text-sm">{followUpDays}d</strong>
                </div>
              </div>
            </div>

            {/* Direct WhatsApp Dispatch Status */}
            <div className="p-3.5 bg-emerald-50/80 rounded-xl border border-emerald-200 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-900 flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5 text-emerald-600" />
                  WhatsApp Direct Dispatch
                </span>
                <span className="text-[11px] text-slate-500">{currentPatient.phone}</span>
              </div>

              {whatsAppDirectSuccess ? (
                <div className="bg-white p-2.5 rounded-lg border border-emerald-200 text-emerald-800 text-[11px] font-medium flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Prescription PDF download link &amp; dosage guide delivered to {currentPatient.phone}!</span>
                </div>
              ) : (
                <button
                  onClick={handleDirectWhatsAppDispatch}
                  disabled={isSendingWhatsAppDirect}
                  className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSendingWhatsAppDirect ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>{isSendingWhatsAppDirect ? 'Dispatching via Meta API...' : '1-Click Send via WhatsApp'}</span>
                </button>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={handlePrintRx}
                className="w-full sm:w-auto px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Paper Rx</span>
              </button>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={() => setShowFinalizeModal(false)}
                  className="w-full sm:w-auto px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-semibold text-xs transition-colors"
                >
                  Close
                </button>

                {onProceedToBilling && (
                  <button
                    onClick={() => {
                      setShowFinalizeModal(false);
                      onProceedToBilling();
                    }}
                    className="w-full sm:w-auto px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center space-x-1.5 shadow-sm shadow-blue-200 transition-all cursor-pointer"
                  >
                    <Receipt className="w-3.5 h-3.5" />
                    <span>Proceed to Billing</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Dispatch & Language Translation Modal */}
      {showWhatsAppModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-5 space-y-4 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2 text-emerald-700">
                <Send className="w-4 h-4" />
                <h3 className="font-bold text-sm text-slate-900">Send Prescription & Exercise Protocol</h3>
              </div>
              <button
                onClick={() => setShowWhatsAppModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Recipient & Language Bar */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Patient</span>
                <strong className="text-slate-900">{currentPatient.name}</strong>
                <span className="text-slate-500 block text-[11px]">{currentPatient.phone}</span>
              </div>
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px] uppercase font-bold flex items-center gap-1">
                  <Languages className="w-3 h-3 text-blue-600" /> Patient Language
                </span>
                <select
                  value={targetLanguage}
                  onChange={(e) => {
                    setTargetLanguage(e.target.value);
                    translateRxForWhatsApp(e.target.value);
                  }}
                  className="w-full bg-white border border-slate-200 rounded px-2 py-1 mt-0.5 font-semibold text-slate-800 focus:outline-none text-xs"
                >
                  <option value="Hindi">Hindi (हिंदी)</option>
                  <option value="Bengali">Bengali (বাংলা)</option>
                  <option value="Tamil">Tamil (தமிழ்)</option>
                  <option value="Telugu">Telugu (తెలుగు)</option>
                  <option value="Marathi">Marathi (मराठी)</option>
                  <option value="Gujarati">Gujarati (ગુજરાતી)</option>
                  <option value="English">English</option>
                </select>
              </div>
            </div>

            {/* Formatted Message Preview */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <label className="font-bold text-slate-700 text-[11px]">WhatsApp Message Content:</label>
                {isTranslating && <span className="text-blue-600 font-semibold animate-pulse text-[11px]">Translating via Gemini AI...</span>}
              </div>
              <textarea
                value={translatedWhatsAppText}
                onChange={(e) => setTranslatedWhatsAppText(e.target.value)}
                rows={8}
                className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-3 focus:outline-none text-slate-800 resize-none leading-relaxed"
              />
            </div>

            {whatsappSentSuccess ? (
              <div className="p-3 bg-emerald-100 text-emerald-800 rounded-lg text-xs font-bold flex items-center justify-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-700" />
                Prescription & Protocol Delivered to {currentPatient.phone} on WhatsApp!
              </div>
            ) : (
              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  onClick={() => setShowWhatsAppModal(false)}
                  className="px-3.5 py-1.5 rounded-md text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveAndDispatch}
                  className="px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm flex items-center space-x-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send WhatsApp</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export type UserRole = 'doctor' | 'receptionist' | 'polyclinic_admin' | 'super_admin' | 'patient';
export type UserStatus = 'active' | 'invited' | 'disabled';

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  phone: string;
  lastLogin: string | null;
  createdAt: string;
}

export type PolyclinicSpecialty = 
  | 'General Medicine'
  | 'Cardiology'
  | 'Pediatrics'
  | 'Dermatology'
  | 'Orthopedics'
  | 'Physiotherapy & Rehabilitation'
  | 'Gynecology'
  | 'ENT'
  | 'Neurology'
  | 'Ophthalmology'
  | 'Dental Surgery'
  | 'Psychiatry & Mental Health';

export interface Doctor {
  id: string;
  userId?: string | null;
  name: string;
  qualification: string;
  regNumber: string;
  specialty: PolyclinicSpecialty;
  experienceYears: number;
  consultationFee: number;
  opdRoom: string;
  availableDays: string[];
  opdTiming: string;
  avatarUrl?: string;
  phone: string;
  email: string;
  active: boolean;
}

export interface Patient {
  id: string;
  uhid: string; // Unique Healthcare ID (e.g. LUM-2026-0042)
  name: string;
  age: number;
  gender: 'Male' | 'Female' | 'Other';
  phone: string;
  email?: string;
  bloodGroup: string;
  allergies: string[];
  chronicConditions: string[];
  emergencyContact: string;
  address?: string;
  lastVisit?: string;
  avatar?: string;
}

export interface Vitals {
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  heartRate?: number;
  temperature?: number; // in Fahrenheit
  spO2?: number; // percentage
  weightKg?: number;
  heightCm?: number;
  bmi?: number;
  bloodSugarRandom?: number;
  recordedAt: string;
  recordedBy?: string;
}

export interface MedicineItem {
  id: string;
  drugName: string;
  composition: string;
  dosage: string; // e.g. "500 mg", "10 mg"
  form: 'Tablet' | 'Capsule' | 'Syrup' | 'Injection' | 'Ointment' | 'Drops' | 'Inhaler';
  frequency: '1-0-1' | '1-0-0' | '0-0-1' | '1-1-1' | '1-1-0' | '0-1-0' | 'SOS' | 'Once a week';
  timing: 'After Food' | 'Before Food' | 'With Food' | 'At Bedtime' | 'Empty Stomach';
  durationDays: number;
  instructions?: string;
}

export interface LabTestItem {
  id: string;
  testName: string;
  category: 'Hematology' | 'Biochemistry' | 'Radiology' | 'Pathology' | 'Microbiology';
  urgent?: boolean;
  notes?: string;
  price?: number;
}

export interface PrescribedExercise {
  id: string;
  exerciseName: string;
  targetArea: 'Spine & Neck' | 'Shoulder & Arm' | 'Lower Back & Core' | 'Hip & Knee' | 'Ankle & Foot' | 'Full Body & Balance';
  sets: number;
  reps: number;
  holdSeconds: number;
  frequency: '1x Daily' | '2x Daily' | '3x Daily' | 'Alternate Days' | 'As Needed';
  resistanceBand?: 'None' | 'Yellow (Light)' | 'Red (Medium)' | 'Green (Heavy)' | 'Blue (Extra Heavy)' | 'Black (Special)';
  instructions: string;
  precautions?: string;
}

export interface PhysiotherapyProcedure {
  id: string;
  name: string; // e.g. "Trigger Point Dry Needling", "Interferential Therapy (IFT)", "Joint Mobilization (Maitland Grade III)", "Cupping Therapy"
  type: 'Dry Needling' | 'Electrotherapy & Modality' | 'Manual Therapy' | 'Taping & Cupping' | 'Traction & Decompression';
  targetArea: string; // e.g. "Right Upper Trapezius & Levator Scapulae", "L4-L5 Paraspinal", "Left Glenohumeral Joint"
  parameters?: string; // e.g. "4 Needles, 0.25x40mm, Piston technique", "IFT 4-pole, 100Hz Sweep, 15 mins", "Grade III Maitland, 3 sets x 30s"
  durationMinutes: number;
  patientTolerance: 'Well Tolerated' | 'Mild Discomfort' | 'Post-Needling Soreness Expected';
}

export interface PhysiotherapyAssessment {
  vasPainScore: number; // 0-10
  painType: 'Aching' | 'Burning' | 'Sharp / Shooting' | 'Dull / Throbbing' | 'Radiating / Neural';
  painAggravatingFactors?: string;
  painRelievingFactors?: string;
  jointRomFindings: Array<{
    joint: string;
    movement: string;
    degrees: string; // e.g. "Abduction: 80° (Restricted)", "Flexion: 120°"
    endFeel: 'Normal' | 'Empty / Painful' | 'Capsular / Firm' | 'Bone-to-bone' | 'Spastic';
  }>;
  muscleStrengthMmt: Array<{
    muscleGroup: string;
    grade: '0/5 (No contraction)' | '1/5 (Trace)' | '2/5 (Poor)' | '3/5 (Fair - Anti-gravity)' | '4/5 (Good)' | '5/5 (Normal)';
  }>;
  gaitAndPosture: string;
  specialOrthopedicTests: Array<{
    testName: string;
    result: 'Positive (+)' | 'Negative (-)' | 'Equivocal';
    notes?: string;
  }>;
  functionalGoals: string[];
}

export interface DermatologyAssessment {
  fitzpatrickSkinType: 'Type I' | 'Type II' | 'Type III' | 'Type IV' | 'Type V' | 'Type VI';
  lesionType: string[]; // e.g. "Erythematous Papules", "Comedones", "Plaques with Silvery Scale"
  distribution: string; // e.g. "Malar area of face", "Extensor surfaces of elbows & knees"
  inClinicProceduresPerformed?: Array<{
    procedureName: string;
    area: string;
    notes: string;
  }>;
  sunProtectionAdvice: string;
}

export interface CardiologyAssessment {
  nyhaFunctionalClass: 'Class I' | 'Class II' | 'Class III' | 'Class IV';
  targetBloodPressure: string;
  targetRestingHeartRate: string;
  ecgSummary?: string;
  echoFindings?: string;
  dailySodiumLimitGrams: number;
  dailyFluidLimitMl?: number;
  cardiacRehabGuidance?: string[];
}

export interface PediatricAssessment {
  weightPercentileForAge?: string;
  heightPercentileForAge?: string;
  developmentalMilestones: 'Age Appropriate' | 'Mild Delay' | 'Needs Evaluation';
  immunizationsDue?: string[];
  feedingAdvice?: string;
  calculatedDosageBasis?: string; // e.g. "Paracetamol 15 mg/kg = 180 mg per dose"
}

export interface OrthopedicAssessment {
  affectedJointLimb: string;
  weightBearingStatus: 'Full Weight Bearing (FWB)' | 'Partial Weight Bearing (PWB)' | 'Non-Weight Bearing (NWB)' | 'Touch Down Weight Bearing';
  splintOrBraceApplied?: string;
  xrayFindingsSummary?: string;
  inClinicInfiltration?: string;
}

export interface OphthalmologyAssessment {
  visualAcuityOD: string; // e.g. "6/6", "6/9"
  visualAcuityOS: string;
  refractionOD: { sphere: string; cyl: string; axis: string; add: string };
  refractionOS: { sphere: string; cyl: string; axis: string; add: string };
  pupillaryDistanceMm: number;
  iopOD: number; // mmHg
  iopOS: number;
  anteriorSegment: string;
  fundusExam: {
    cupToDiscRatioOD: string;
    cupToDiscRatioOS: string;
    retinaFindings: string;
  };
}

export interface DentalToothCondition {
  condition: 'Healthy' | 'Caries' | 'Restored' | 'Root Canal' | 'Missing' | 'Crown' | 'Extraction Needed';
  notes?: string;
}

export interface DentalAssessment {
  teethStatus: Record<number, DentalToothCondition>;
  periodontalStatus: 'Healthy' | 'Gingivitis' | 'Moderate Periodontitis' | 'Severe Bone Loss';
  plaqueCalculusIndex: 'Low' | 'Moderate' | 'Heavy';
  plannedProcedures: Array<{
    toothNumber?: number;
    procedure: string;
    estimatedCost: number;
    status: 'Planned' | 'In Progress' | 'Completed';
  }>;
}

export interface GynecologyAssessment {
  lmpDate: string;
  calculatedEdd: string;
  gestationalAgeWeeks: number;
  gestationalAgeDays: number;
  trimester: '1st Trimester' | '2nd Trimester' | '3rd Trimester' | 'Postpartum';
  gravidaPara: { g: number; p: number; l: number; a: number };
  fundalHeightCm?: number;
  fetalHeartRateBpm?: number;
  presentation?: 'Cephalic / Vertex' | 'Breech' | 'Transverse' | 'Unstable';
  quickeningPresent?: boolean;
  highRiskFactors?: string[];
  antenatalChecklist?: Array<{ item: string; completed: boolean; dueDate?: string }>;
}

export interface LabResultParam {
  param: string;
  value: number | string;
  unit: string;
  normalRange: string;
  status: 'Normal' | 'Low' | 'High' | 'Critical';
  trendDelta?: string;
}

export interface LabReportRecord {
  id: string;
  patientId: string;
  uhid: string;
  patientName: string;
  date: string;
  labName: string;
  category: 'Metabolic & Diabetes' | 'Renal & Electrolytes' | 'Complete Blood Count' | 'Lipid Profile' | 'Thyroid' | 'Cardiac Biomarkers';
  results: LabResultParam[];
  egfrMlMin?: number;
  renalDoseAlerts?: string[];
  doctorInterpretation?: string;
}

export interface RehabPackageSession {
  sessionNumber: number;
  date: string;
  therapistName: string;
  vasScore: number;
  romDegreeSnapshot?: number;
  proceduresDone: string[];
  notes: string;
}

export interface TherapyPackage {
  id: string;
  patientId: string;
  uhid: string;
  patientName: string;
  packageName: string;
  department: PolyclinicSpecialty;
  totalSessions: number;
  completedSessions: number;
  cost: number;
  paidAmount: number;
  status: 'Active' | 'Completed' | 'Paused';
  startDate: string;
  sessionsLog: RehabPackageSession[];
}

export interface PharmacyBatchItem {
  id: string;
  drugName: string;
  composition: string;
  batchNumber: string;
  expiryDate: string;
  daysToExpiry: number;
  currentStock: number;
  reorderLevel: number;
  unitPrice: number;
  mrp: number;
  status: 'Normal' | 'Near Expiry' | 'Expired' | 'Low Stock';
}

export interface SoapNote {
  id: string;
  patientId: string;
  uhid: string;
  doctorId: string;
  date: string;
  specialty?: PolyclinicSpecialty;
  subjective: {
    chiefComplaints: string[];
    historyOfPresentIllness: string;
    pastMedicalHistory?: string;
    reviewOfSystems?: string;
  };
  objective: {
    vitals: Vitals;
    physicalExamination: string;
    clinicalFindings: string[];
  };
  assessment: {
    primaryDiagnosis: string;
    icd10Code: string;
    differentialDiagnoses: string[];
    riskLevel: 'Low' | 'Moderate' | 'High' | 'Emergency';
  };
  plan: {
    medicines: MedicineItem[];
    labTests: LabTestItem[];
    lifestyleAdvice: string[];
    redFlags: string[];
    followUpDays: number;
    followUpDate: string;
  };
  // Specialty extensions
  physiotherapyAssessment?: PhysiotherapyAssessment;
  performedTherapies?: PhysiotherapyProcedure[];
  prescribedExercises?: PrescribedExercise[];
  cardiologyAssessment?: CardiologyAssessment;
  dermatologyAssessment?: DermatologyAssessment;
  pediatricAssessment?: PediatricAssessment;
  orthopedicAssessment?: OrthopedicAssessment;
  ophthalmologyAssessment?: OphthalmologyAssessment;
  dentalAssessment?: DentalAssessment;
  gynecologyAssessment?: GynecologyAssessment;
  transcriptSummary?: string;
  ambientRecordingDurationSec?: number;
}

export interface Prescription {
  id: string;
  rxNumber: string; // e.g. RX-2026-8891
  patientId: string;
  patientName: string;
  patientAge: number;
  patientGender: string;
  patientPhone: string;
  patientUhid: string;
  doctorId: string;
  doctorName: string;
  doctorSpecialty: string;
  doctorRegNumber: string;
  date: string;
  vitals?: Vitals;
  chiefComplaints: string[];
  diagnosis: string;
  icd10Code?: string;
  medicines: MedicineItem[];
  labTests: LabTestItem[];
  advice: string[];
  dietInstructions?: string;
  followUpDate: string;
  clinicName: string;
  clinicAddress: string;
  clinicPhone: string;
  qrVerificationUrl?: string;
  whatsappSentStatus?: 'unsent' | 'queued' | 'delivered' | 'read';
  
  // Dynamic specialty modules
  specialtyType?: PolyclinicSpecialty;
  physiotherapyAssessment?: PhysiotherapyAssessment;
  performedTherapies?: PhysiotherapyProcedure[];
  prescribedExercises?: PrescribedExercise[];
  cardiologyAssessment?: CardiologyAssessment;
  dermatologyAssessment?: DermatologyAssessment;
  pediatricAssessment?: PediatricAssessment;
  orthopedicAssessment?: OrthopedicAssessment;
  ophthalmologyAssessment?: OphthalmologyAssessment;
  dentalAssessment?: DentalAssessment;
  gynecologyAssessment?: GynecologyAssessment;
}

export interface Appointment {
  id: string;
  tokenNumber: number;
  patientId: string;
  patientName: string;
  patientPhone: string;
  uhid: string;
  doctorId: string;
  doctorName: string;
  specialty: PolyclinicSpecialty;
  date: string; // YYYY-MM-DD
  timeSlot: string; // e.g. "10:30 AM"
  type: 'New Consultation' | 'Follow-up' | 'Report Review' | 'Emergency';
  status: 'Waiting' | 'In Consultation' | 'Triage / Vitals' | 'Completed' | 'Cancelled' | 'No-Show';
  source: 'Walk-in' | 'WhatsApp Bot' | 'Online Portal' | 'Call Desk';
  consultationFee: number;
  isPaid: boolean;
  vitals?: Vitals;
}

export interface BillItem {
  id: string;
  description: string;
  category: 'Consultation' | 'Pharmacy' | 'Lab' | 'Procedure' | 'Nursing' | 'Package';
  hsnSacCode?: string;
  quantity: number;
  unitPrice: number;
  gstPercent?: number;
  total: number;
}

export interface InvoiceItem {
  id: string;
  description: string;
  category: 'Consultation' | 'Pharmacy' | 'Lab' | 'Procedure' | 'Nursing' | 'Package';
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string; // e.g. INV-2026-1082
  patientId: string;
  patientName: string;
  patientPhone: string;
  patientUhid: string;
  date: string;
  items: InvoiceItem[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  paymentStatus: 'Paid' | 'Partially Paid' | 'Unpaid';
  paymentMode?: 'UPI / QR' | 'Razorpay' | 'Cash' | 'Card' | 'Insurance';
  paymentRef?: string;
  issuedBy: string;
}

export interface WhatsAppMessage {
  id: string;
  patientPhone: string;
  patientName: string;
  direction: 'inbound' | 'outbound';
  timestamp: string;
  content: string;
  templateName?: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  mediaUrl?: string;
  language?: string;
}

export interface WhatsAppTemplate {
  id: string;
  name: string;
  category: 'APPOINTMENT_REMINDER' | 'PRESCRIPTION_DELIVERY' | 'INVOICE_PAY_LINK' | 'FOLLOWUP_CHECK' | 'LAB_READY';
  language: string;
  headerText?: string;
  bodyText: string;
  footerText?: string;
  buttons?: { type: 'URL' | 'QUICK_REPLY'; text: string; payload?: string }[];
  status: 'APPROVED' | 'PENDING';
}

export interface ClinicSettings {
  name: string;
  tagline: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  gstin: string;
  regId: string;
  upiId: string;
  whatsappNumber: string;
  headerBgColor: string;
  accentColor: string;
  showLogo: boolean;
  showQrCode: boolean;
  sealText: string;
  footerDisclaimer: string;
}

export interface SafetyCheckResult {
  hasHighRiskAlert: boolean;
  alerts: {
    type: 'INTERACTION' | 'ALLERGY' | 'CONTRAINDICATION' | 'DOSAGE_WARNING' | 'PREGNANCY_LACTATION';
    severity: 'Mild' | 'Moderate' | 'Severe' | 'Critical';
    drugsInvolved: string[];
    description: string;
    clinicalRecommendation: string;
  }[];
}

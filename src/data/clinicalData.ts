import { 
  Doctor, 
  Patient, 
  MedicineItem, 
  LabTestItem, 
  Appointment, 
  Invoice, 
  ClinicSettings, 
  WhatsAppTemplate,
  PrescribedExercise,
  PhysiotherapyProcedure,
  PhysiotherapyAssessment,
  CardiologyAssessment,
  DermatologyAssessment,
  PediatricAssessment,
  OrthopedicAssessment,
  OphthalmologyAssessment,
  DentalAssessment,
  GynecologyAssessment,
  LabReportRecord,
  TherapyPackage,
  PharmacyBatchItem,
  PolyclinicSpecialty
} from '../types';

export const PHYSIO_EXERCISE_DATABASE: PrescribedExercise[] = [
  // Spine & Neck
  {
    id: 'ex-1',
    exerciseName: 'Isometric Cervical Neck Contractions (Flexion, Extension & Lateral)',
    targetArea: 'Spine & Neck',
    sets: 3,
    reps: 10,
    holdSeconds: 5,
    frequency: '2x Daily',
    resistanceBand: 'None',
    instructions: 'Sit upright. Place hand on forehead/side of head. Push head gently into palm without moving neck. Hold for 5 seconds.',
    precautions: 'Do not hold breath. Stop if dizziness or radiating sharp arm pain occurs.'
  },
  {
    id: 'ex-2',
    exerciseName: 'Chin Tucks (Deep Neck Flexor Activation)',
    targetArea: 'Spine & Neck',
    sets: 3,
    reps: 12,
    holdSeconds: 5,
    frequency: '3x Daily',
    resistanceBand: 'None',
    instructions: 'Keep eyes facing straight ahead. Glide chin straight back making a subtle double chin. Hold 5 seconds and release.',
    precautions: 'Do not tilt head down. Movement should be horizontal retraction.'
  },
  {
    id: 'ex-3',
    exerciseName: 'McKenzie Lumbar Prone Press-Up / Extension',
    targetArea: 'Lower Back & Core',
    sets: 3,
    reps: 10,
    holdSeconds: 3,
    frequency: '2x Daily',
    resistanceBand: 'None',
    instructions: 'Lie prone on stomach. Place hands under shoulders and press upper body upward while keeping pelvis and buttocks completely relaxed on the mat.',
    precautions: 'Centralizes lumbar disc pain. Discontinue if pain peripheralizes down into the foot.'
  },
  {
    id: 'ex-4',
    exerciseName: 'Cat-Camel Spinal Mobility Flow',
    targetArea: 'Lower Back & Core',
    sets: 2,
    reps: 12,
    holdSeconds: 3,
    frequency: '2x Daily',
    resistanceBand: 'None',
    instructions: 'On quadruped (all 4s). Arch back upward like a cat tucking chin, then smoothly drop abdomen toward floor while lifting chest.',
    precautions: 'Perform gently within pain-free amplitude.'
  },
  {
    id: 'ex-5',
    exerciseName: 'Pelvic Bridging with Gluteal Squeeze',
    targetArea: 'Lower Back & Core',
    sets: 3,
    reps: 15,
    holdSeconds: 5,
    frequency: '2x Daily',
    resistanceBand: 'Yellow (Light)',
    instructions: 'Lie supine with knees bent and feet flat. Squeeze glutes and lift hips until thighs and torso align in a straight diagonal.',
    precautions: 'Avoid hyperextending the lower back at the top of the bridge.'
  },
  {
    id: 'ex-6',
    exerciseName: 'Bird-Dog Contralateral Core Stabilization',
    targetArea: 'Lower Back & Core',
    sets: 3,
    reps: 10,
    holdSeconds: 4,
    frequency: '1x Daily',
    resistanceBand: 'None',
    instructions: 'From quadruped, extend right arm forward and left leg straight back simultaneously without rotating pelvis. Alternate sides.',
    precautions: 'Keep spine neutral; do not let lumbar spine sag.'
  },

  // Shoulder & Arm
  {
    id: 'ex-7',
    exerciseName: "Codman's Pendulum Decompression Swings",
    targetArea: 'Shoulder & Arm',
    sets: 3,
    reps: 20,
    holdSeconds: 0,
    frequency: '3x Daily',
    resistanceBand: 'None',
    instructions: 'Lean forward supporting non-affected arm on a table. Let affected arm dangle freely. Use body momentum to swing arm in gentle circles clockwise and counter-clockwise.',
    precautions: 'Passive movement using gravity. Do not tense shoulder muscles.'
  },
  {
    id: 'ex-8',
    exerciseName: 'Theraband Shoulder External Rotation (Rotator Cuff)',
    targetArea: 'Shoulder & Arm',
    sets: 3,
    reps: 12,
    holdSeconds: 2,
    frequency: '2x Daily',
    resistanceBand: 'Red (Medium)',
    instructions: 'Stand with elbow tucked at 90° with a small towel roll under armpit. Pull resistance band outward away from body, maintaining elbow contact.',
    precautions: 'Control the eccentric return slowly; do not let the band snap back.'
  },
  {
    id: 'ex-9',
    exerciseName: 'Wall Finger Ladder Climbing (Adhesive Capsulitis)',
    targetArea: 'Shoulder & Arm',
    sets: 3,
    reps: 10,
    holdSeconds: 5,
    frequency: '3x Daily',
    resistanceBand: 'None',
    instructions: 'Stand facing the wall arm-length away. Walk fingers slowly up the wall to end range of elevation. Hold at top stretch point.',
    precautions: 'Stop at point of tolerable stretch. Do not shrug the shoulder abnormally.'
  },
  {
    id: 'ex-10',
    exerciseName: 'Scapular Retraction / Wall Angels',
    targetArea: 'Shoulder & Arm',
    sets: 3,
    reps: 12,
    holdSeconds: 3,
    frequency: '2x Daily',
    resistanceBand: 'None',
    instructions: 'Stand against wall with back, head, and elbows touching wall. Slide arms up and down keeping contact with wall.',
    precautions: 'Engage middle and lower trapezius; keep ribs down.'
  },

  // Hip & Knee
  {
    id: 'ex-11',
    exerciseName: 'Isometric Quadriceps Sets (Towel Roll Under Knee)',
    targetArea: 'Hip & Knee',
    sets: 3,
    reps: 15,
    holdSeconds: 6,
    frequency: '3x Daily',
    resistanceBand: 'None',
    instructions: 'Sit with leg straight. Place rolled towel under knee. Tighten anterior thigh muscles pressing back of knee firmly into towel.',
    precautions: 'Ensure full VMO (Vastus Medialis Oblique) contraction.'
  },
  {
    id: 'ex-12',
    exerciseName: 'Straight Leg Raise (SLR) with Ankle Dorsiflexion',
    targetArea: 'Hip & Knee',
    sets: 3,
    reps: 12,
    holdSeconds: 4,
    frequency: '2x Daily',
    resistanceBand: 'None',
    instructions: 'Lie on back, lock knee completely straight, pull toes toward nose, lift leg 45° off the mat. Hold 4 seconds and slowly lower.',
    precautions: 'Do not bend knee during the lift.'
  },
  {
    id: 'ex-13',
    exerciseName: 'Mini Wall Squats (45° Knee Flexion)',
    targetArea: 'Hip & Knee',
    sets: 3,
    reps: 10,
    holdSeconds: 5,
    frequency: '2x Daily',
    resistanceBand: 'None',
    instructions: 'Back against smooth wall, feet shoulder-width apart 1 foot from wall. Slide down until knees reach 45° angle. Hold and slide up.',
    precautions: 'Do not allow knees to track inward or pass in front of toes.'
  },
  {
    id: 'ex-14',
    exerciseName: 'Side-Lying Hip Abduction (Clamshells)',
    targetArea: 'Hip & Knee',
    sets: 3,
    reps: 15,
    holdSeconds: 2,
    frequency: '2x Daily',
    resistanceBand: 'Yellow (Light)',
    instructions: 'Lie on side with hips and knees flexed to 45°. Keep feet touching while opening top knee like a clam shell to target gluteus medius.',
    precautions: 'Do not rotate pelvis backward during the movement.'
  },

  // Ankle & Foot
  {
    id: 'ex-15',
    exerciseName: 'Plantar Fascia Frozen Bottle Roll & Calf Stretch',
    targetArea: 'Ankle & Foot',
    sets: 2,
    reps: 10,
    holdSeconds: 30,
    frequency: '2x Daily',
    resistanceBand: 'None',
    instructions: 'Roll sole of foot over a frozen water bottle for 5-7 minutes. Follow with runner calf stretch against wall holding 30 seconds.',
    precautions: 'Apply moderate firm pressure without causing acute sharp pain.'
  },
  {
    id: 'ex-16',
    exerciseName: 'Single-Leg Balance & Proprioception on Wobble Board',
    targetArea: 'Full Body & Balance',
    sets: 3,
    reps: 5,
    holdSeconds: 30,
    frequency: '1x Daily',
    resistanceBand: 'None',
    instructions: 'Stand on single affected foot with eyes open near a sturdy rail. Progress to eyes closed and soft foam cushion.',
    precautions: 'Always practice near support rail to prevent falls.'
  }
];

export const PHYSIO_PROCEDURES_CATALOG: PhysiotherapyProcedure[] = [
  {
    id: 'proc-1',
    name: 'Trigger Point Dry Needling (DN)',
    type: 'Dry Needling',
    targetArea: 'Right Upper Trapezius & Levator Scapulae',
    parameters: '4 Needles (0.25 x 40mm), Piston & Fast-in Fast-out technique with local twitch response elicited',
    durationMinutes: 15,
    patientTolerance: 'Well Tolerated'
  },
  {
    id: 'proc-2',
    name: 'Interferential Therapy (IFT) 4-Pole Vector',
    type: 'Electrotherapy & Modality',
    targetArea: 'Lumbar Paraspinal (L4-L5-S1)',
    parameters: 'Carrier frequency 4000 Hz, Beat frequency 80-120 Hz, Rhythmic sweep pattern',
    durationMinutes: 20,
    patientTolerance: 'Well Tolerated'
  },
  {
    id: 'proc-3',
    name: 'Therapeutic Ultrasound Therapy (1 MHz Pulsed 1:4)',
    type: 'Electrotherapy & Modality',
    targetArea: 'Lateral Epicondyle (Common Extensor Origin)',
    parameters: 'Pulsed 20% duty cycle, 1.2 W/cm², Coupling gel with phonophoresis',
    durationMinutes: 8,
    patientTolerance: 'Well Tolerated'
  },
  {
    id: 'proc-4',
    name: 'High Intensity Class IV Laser Therapy (LLLT)',
    type: 'Electrotherapy & Modality',
    targetArea: 'Supraspinatus Tendon & Subacromial Space',
    parameters: 'Continuous wave 810nm/980nm, 8 Joules/cm², 1200 Joules total dose',
    durationMinutes: 10,
    patientTolerance: 'Well Tolerated'
  },
  {
    id: 'proc-5',
    name: 'Glenohumeral Joint Mobilization (Maitland Grade III)',
    type: 'Manual Therapy',
    targetArea: 'Left Glenohumeral Joint (Inferior & Posterior Glide)',
    parameters: 'Large amplitude rhythmic oscillations at end-range, 3 sets x 45 seconds',
    durationMinutes: 15,
    patientTolerance: 'Well Tolerated'
  },
  {
    id: 'proc-6',
    name: 'Myofascial Trigger Point Release & Instrument Assisted (IASTM)',
    type: 'Manual Therapy',
    targetArea: 'Iliotibial Band (ITB) & Quadriceps Fascia',
    parameters: 'Ergonomic stainless steel bevel tool, longitudinal strokes & ischemic compression',
    durationMinutes: 12,
    patientTolerance: 'Mild Discomfort'
  },
  {
    id: 'proc-7',
    name: 'Kinesiology Therapeutic Taping (K-Tape)',
    type: 'Taping & Cupping',
    targetArea: 'Patellofemoral Medial Glide & Unloading',
    parameters: 'Y-strip 50% tension over patella, inhibition I-strip over vastus lateralis',
    durationMinutes: 10,
    patientTolerance: 'Well Tolerated'
  },
  {
    id: 'proc-8',
    name: 'Computerized Lumbar Mechanical Decompression Traction',
    type: 'Traction & Decompression',
    targetArea: 'Lumbar Spine (L4-S1)',
    parameters: 'Intermittent traction, Hold 30s / Rest 10s, Pull weight: 24 kg (1/3rd body weight)',
    durationMinutes: 20,
    patientTolerance: 'Well Tolerated'
  }
];

export const INDIAN_DRUG_DATABASE = [
  // Antipyretics & Analgesics
  { drugName: 'Paracetamol 650 mg (Dolo 650)', composition: 'Paracetamol 650mg', form: 'Tablet', defaultDose: '650 mg', frequency: '1-0-1', timing: 'After Food', defaultDuration: 3, category: 'Antipyretic / Analgesic' },
  { drugName: 'Paracetamol 500 mg (Crocin 500)', composition: 'Paracetamol 500mg', form: 'Tablet', defaultDose: '500 mg', frequency: '1-1-1', timing: 'After Food', defaultDuration: 3, category: 'Antipyretic' },
  { drugName: 'Ibuprofen + Paracetamol (Combiflam)', composition: 'Ibuprofen 400mg + Paracetamol 325mg', form: 'Tablet', defaultDose: '1 Tablet', frequency: '1-0-1', timing: 'After Food', defaultDuration: 3, category: 'NSAID / Analgesic' },
  { drugName: 'Aceclofenac + Paracetamol (Zerodol-P)', composition: 'Aceclofenac 100mg + Paracetamol 325mg', form: 'Tablet', defaultDose: '1 Tablet', frequency: '1-0-1', timing: 'After Food', defaultDuration: 5, category: 'NSAID' },
  { drugName: 'Aceclofenac + Serratiopeptidase (Zerodol-SP)', composition: 'Aceclofenac 100mg + Paracetamol 325mg + Serratiopeptidase 15mg', form: 'Tablet', defaultDose: '1 Tablet', frequency: '1-0-1', timing: 'After Food', defaultDuration: 5, category: 'Anti-inflammatory' },
  { drugName: 'Tramadol + Paracetamol (Ultracet)', composition: 'Tramadol 37.5mg + Paracetamol 325mg', form: 'Tablet', defaultDose: '1 Tablet', frequency: 'SOS', timing: 'After Food', defaultDuration: 3, category: 'Opioid Analgesic' },
  
  // Antibiotics & Antimicrobials
  { drugName: 'Amoxicillin + Clavulanate 625 mg (Augmentin 625 Duo)', composition: 'Amoxicillin 500mg + Clavulanic Acid 125mg', form: 'Tablet', defaultDose: '625 mg', frequency: '1-0-1', timing: 'With Food', defaultDuration: 5, category: 'Antibiotic' },
  { drugName: 'Azithromycin 500 mg (Azee 500)', composition: 'Azithromycin 500mg', form: 'Tablet', defaultDose: '500 mg', frequency: '1-0-0', timing: 'Before Food', defaultDuration: 3, category: 'Macrolide Antibiotic' },
  { drugName: 'Cefixime 200 mg (Zifi 200 / Taxim-O 200)', composition: 'Cefixime 200mg', form: 'Tablet', defaultDose: '200 mg', frequency: '1-0-1', timing: 'After Food', defaultDuration: 5, category: 'Cephalosporin Antibiotic' },
  { drugName: 'Cefuroxime Axetil 500 mg (Ceftum 500)', composition: 'Cefuroxime 500mg', form: 'Tablet', defaultDose: '500 mg', frequency: '1-0-1', timing: 'After Food', defaultDuration: 5, category: 'Cephalosporin Antibiotic' },
  { drugName: 'Ciprofloxacin 500 mg (Ciplox 500)', composition: 'Ciprofloxacin 500mg', form: 'Tablet', defaultDose: '500 mg', frequency: '1-0-1', timing: 'After Food', defaultDuration: 5, category: 'Fluoroquinolone' },
  { drugName: 'Metronidazole 400 mg (Flagyl 400)', composition: 'Metronidazole 400mg', form: 'Tablet', defaultDose: '400 mg', frequency: '1-1-1', timing: 'After Food', defaultDuration: 5, category: 'Antiprotozoal / Antibiotic' },
  { drugName: 'Ofloxacin + Ornidazole (O2 Tablet)', composition: 'Ofloxacin 200mg + Ornidazole 500mg', form: 'Tablet', defaultDose: '1 Tablet', frequency: '1-0-1', timing: 'After Food', defaultDuration: 5, category: 'Gastroenteritis Antibiotic' },
  { drugName: 'Nitrofurantoin SR 100 mg (Martifur MR 100)', composition: 'Nitrofurantoin 100mg', form: 'Tablet', defaultDose: '100 mg', frequency: '1-0-1', timing: 'With Food', defaultDuration: 7, category: 'UTI Antibacterial' },
  
  // Gastrointestinal & Antacids
  { drugName: 'Pantoprazole 40 mg (Pan 40)', composition: 'Pantoprazole 40mg', form: 'Tablet', defaultDose: '40 mg', frequency: '1-0-0', timing: 'Before Food', defaultDuration: 7, category: 'Proton Pump Inhibitor' },
  { drugName: 'Pantoprazole + Domperidone (Pan-D)', composition: 'Pantoprazole 40mg + Domperidone 30mg SR', form: 'Capsule', defaultDose: '1 Capsule', frequency: '1-0-0', timing: 'Before Food', defaultDuration: 7, category: 'PPI + Prokinetic' },
  { drugName: 'Rabeprazole + Levosulpiride (Razo-L)', composition: 'Rabeprazole 20mg + Levosulpiride 75mg SR', form: 'Capsule', defaultDose: '1 Capsule', frequency: '1-0-0', timing: 'Before Food', defaultDuration: 14, category: 'GERD / Dyspepsia' },
  { drugName: 'Ondansetron 4 mg (Emeset 4)', composition: 'Ondansetron 4mg', form: 'Tablet', defaultDose: '4 mg', frequency: 'SOS', timing: 'Before Food', defaultDuration: 3, category: 'Antiemetic' },
  { drugName: 'Dicyclomine + Mefenamic Acid (Meftal-Spas)', composition: 'Mefenamic Acid 250mg + Dicyclomine 10mg', form: 'Tablet', defaultDose: '1 Tablet', frequency: 'SOS', timing: 'After Food', defaultDuration: 3, category: 'Antispasmodic' },
  { drugName: 'ORS Sachet (Electral)', composition: 'Oral Rehydration Salts IP', form: 'Syrup', defaultDose: '1 Sachet in 1 Litre Water', frequency: '1-1-1', timing: 'With Food', defaultDuration: 3, category: 'Rehydration' },
  { drugName: 'Bacillus Clausii Spores (Enterogermina)', composition: 'Probiotic Spores 2 Billion', form: 'Syrup', defaultDose: '1 Mini Bottle', frequency: '1-0-1', timing: 'After Food', defaultDuration: 5, category: 'Probiotic' },
  
  // Respiratory & Allergy
  { drugName: 'Montelukast + Levocetirizine (Montair-LC)', composition: 'Montelukast 10mg + Levocetirizine 5mg', form: 'Tablet', defaultDose: '1 Tablet', frequency: '0-0-1', timing: 'At Bedtime', defaultDuration: 10, category: 'Antihistamine / Antiasthmatic' },
  { drugName: 'Levocetirizine 5 mg (Levocet 5)', composition: 'Levocetirizine 5mg', form: 'Tablet', defaultDose: '5 mg', frequency: '0-0-1', timing: 'At Bedtime', defaultDuration: 5, category: 'Antihistamine' },
  { drugName: 'Budesonide + Formoterol Inhaler (Budecort / Foracort 200)', composition: 'Budesonide 200mcg + Formoterol 6mcg', form: 'Inhaler', defaultDose: '2 Puffs', frequency: '1-0-1', timing: 'After Food', defaultDuration: 30, category: 'Inhaled Corticosteroid' },
  { drugName: 'Levosalbutamol + Ambroxol + Guaiphenesin (Ascoril-LS Syrup)', composition: 'Levosalbutamol 1mg + Ambroxol 30mg + Guaiphenesin 50mg per 5ml', form: 'Syrup', defaultDose: '10 ml', frequency: '1-1-1', timing: 'After Food', defaultDuration: 5, category: 'Cough Expectorant' },
  { drugName: 'Dextromethorphan + Chlorpheniramine (Benadryl DR)', composition: 'Dextromethorphan 10mg + CPM 2mg per 5ml', form: 'Syrup', defaultDose: '10 ml', frequency: '1-0-1', timing: 'After Food', defaultDuration: 5, category: 'Dry Cough Suppressant' },
  
  // Cardiovascular & Hypertension
  { drugName: 'Telmisartan 40 mg (Telma 40)', composition: 'Telmisartan 40mg', form: 'Tablet', defaultDose: '40 mg', frequency: '1-0-0', timing: 'After Food', defaultDuration: 30, category: 'Antihypertensive (ARB)' },
  { drugName: 'Telmisartan + Amlodipine (Telma-AM)', composition: 'Telmisartan 40mg + Amlodipine 5mg', form: 'Tablet', defaultDose: '1 Tablet', frequency: '1-0-0', timing: 'After Food', defaultDuration: 30, category: 'ARB + CCB' },
  { drugName: 'Amlodipine 5 mg (Amlong 5)', composition: 'Amlodipine 5mg', form: 'Tablet', defaultDose: '5 mg', frequency: '0-0-1', timing: 'At Bedtime', defaultDuration: 30, category: 'Calcium Channel Blocker' },
  { drugName: 'Metoprolol Succinate ER 25 mg (Betaloc 25)', composition: 'Metoprolol Succinate 25mg', form: 'Tablet', defaultDose: '25 mg', frequency: '1-0-0', timing: 'After Food', defaultDuration: 30, category: 'Beta Blocker' },
  { drugName: 'Rosuvastatin 10 mg (Rosuvas 10)', composition: 'Rosuvastatin 10mg', form: 'Tablet', defaultDose: '10 mg', frequency: '0-0-1', timing: 'At Bedtime', defaultDuration: 30, category: 'Statin / Lipid Lowering' },
  { drugName: 'Atorvastatin 20 mg + Clopidogrel 75 mg (Atorva Gold)', composition: 'Atorvastatin 20mg + Clopidogrel 75mg', form: 'Capsule', defaultDose: '1 Capsule', frequency: '0-0-1', timing: 'At Bedtime', defaultDuration: 30, category: 'Cardiovascular' },
  
  // Diabetes & Endocrine
  { drugName: 'Metformin 500 mg SR (Glycomet 500 SR)', composition: 'Metformin Hydrochloride 500mg SR', form: 'Tablet', defaultDose: '500 mg', frequency: '1-0-1', timing: 'After Food', defaultDuration: 30, category: 'Oral Hypoglycemic' },
  { drugName: 'Metformin 1000 mg SR (Glycomet 1000 SR)', composition: 'Metformin Hydrochloride 1000mg SR', form: 'Tablet', defaultDose: '1000 mg', frequency: '1-0-1', timing: 'After Food', defaultDuration: 30, category: 'Oral Hypoglycemic' },
  { drugName: 'Glimepiride + Metformin (Amaryl M 1mg / 500mg)', composition: 'Glimepiride 1mg + Metformin 500mg SR', form: 'Tablet', defaultDose: '1 Tablet', frequency: '1-0-0', timing: 'Before Food', defaultDuration: 30, category: 'Sulfonylurea + Biguanide' },
  { drugName: 'Dapagliflozin 10 mg (Forxiga 10)', composition: 'Dapagliflozin 10mg', form: 'Tablet', defaultDose: '10 mg', frequency: '1-0-0', timing: 'After Food', defaultDuration: 30, category: 'SGLT2 Inhibitor' },
  { drugName: 'Vildagliptin 50 mg + Metformin 500 mg (Galvus Met)', composition: 'Vildagliptin 50mg + Metformin 500mg', form: 'Tablet', defaultDose: '1 Tablet', frequency: '1-0-1', timing: 'After Food', defaultDuration: 30, category: 'DPP-4i + Metformin' },
  { drugName: 'Thyroxine Sodium 50 mcg (Thyronorm 50)', composition: 'Levothyroxine Sodium 50mcg', form: 'Tablet', defaultDose: '50 mcg', frequency: '1-0-0', timing: 'Empty Stomach', defaultDuration: 30, category: 'Thyroid Hormone' },
  
  // Vitamins, Minerals & Supplements
  { drugName: 'Vitamin D3 60,000 IU (Calcirol / Uprise-D3)', composition: 'Cholecalciferol 60,000 IU', form: 'Capsule', defaultDose: '60,000 IU', frequency: 'Once a week', timing: 'With Food', defaultDuration: 8, category: 'Vitamin Supplement' },
  { drugName: 'Methylcobalamin + Alpha Lipoic Acid (Neurobion Forte / Nurokind)', composition: 'Mecobalamin 1500mcg + ALA 100mg + Benfotiamine', form: 'Tablet', defaultDose: '1 Tablet', frequency: '0-0-1', timing: 'After Food', defaultDuration: 30, category: 'Neurotropic Vitamin' },
  { drugName: 'Calcium + Vitamin D3 (Shelcal 500)', composition: 'Calcium Carbonate 500mg + Vitamin D3 250 IU', form: 'Tablet', defaultDose: '500 mg', frequency: '0-0-1', timing: 'After Food', defaultDuration: 30, category: 'Mineral Supplement' },
  { drugName: 'Ferrous Ascorbate + Folic Acid (Orofer-XT)', composition: 'Elemental Iron 100mg + Folic Acid 1.5mg', form: 'Tablet', defaultDose: '1 Tablet', frequency: '1-0-0', timing: 'After Food', defaultDuration: 30, category: 'Hematinic' }
];

export const STANDARD_LAB_TESTS: LabTestItem[] = [
  { id: 'lab-1', testName: 'Complete Blood Count (CBC with ESR)', category: 'Hematology', price: 350 },
  { id: 'lab-2', testName: 'HbA1c (Glycosylated Hemoglobin)', category: 'Biochemistry', price: 450 },
  { id: 'lab-3', testName: 'Fasting & Post-Prandial Blood Sugar (FBS + PPBS)', category: 'Biochemistry', price: 200 },
  { id: 'lab-4', testName: 'Lipid Profile (Cholesterol, Triglycerides, HDL, LDL, VLDL)', category: 'Biochemistry', price: 650 },
  { id: 'lab-5', testName: 'Liver Function Test (LFT: SGOT, SGPT, Bilirubin, Alk Phos)', category: 'Biochemistry', price: 600 },
  { id: 'lab-6', testName: 'Kidney Function Test (KFT: Urea, Creatinine, Electrolytes, Uric Acid)', category: 'Biochemistry', price: 700 },
  { id: 'lab-7', testName: 'Thyroid Profile (Total T3, T4, Ultrasensitive TSH)', category: 'Biochemistry', price: 550 },
  { id: 'lab-8', testName: 'Urine Routine & Microscopic Examination (Urine R/M)', category: 'Pathology', price: 180 },
  { id: 'lab-9', testName: 'Digital Chest X-Ray PA View', category: 'Radiology', price: 400 },
  { id: 'lab-10', testName: '12-Lead Electrocardiogram (ECG)', category: 'Radiology', price: 250 },
  { id: 'lab-11', testName: 'Ultrasound Whole Abdomen & Pelvis (USG)', category: 'Radiology', price: 1200 },
  { id: 'lab-12', testName: 'Serum 25-OH Vitamin D3 Level', category: 'Biochemistry', price: 1100 },
  { id: 'lab-13', testName: 'Serum Vitamin B12 Level', category: 'Biochemistry', price: 900 },
  { id: 'lab-14', testName: 'Serum Ferritin & Iron Studies', category: 'Hematology', price: 850 },
  { id: 'lab-15', testName: 'Dengue NS1 Antigen & IgM/IgG Rapid', category: 'Microbiology', price: 800 }
];

export const RX_PRESETS = [
  // Physiotherapy & Rehabilitation Presets
  {
    id: 'preset-physio-frozen-shoulder',
    specialty: 'Physiotherapy & Rehabilitation' as PolyclinicSpecialty,
    name: 'Adhesive Capsulitis / Frozen Shoulder Protocol',
    diagnosis: 'Adhesive Capsulitis of Shoulder (Stage II Freezing Phase)',
    icd10: 'M75.0',
    medicines: [
      { id: 'm1', drugName: 'Aceclofenac + Serratiopeptidase (Zerodol-SP)', composition: 'Aceclofenac 100mg + Paracetamol 325mg + Serratiopeptidase 15mg', form: 'Tablet' as const, dosage: '1 Tablet', frequency: '1-0-1' as const, timing: 'After Food' as const, durationDays: 5, instructions: 'Anti-inflammatory for capsular pain' },
      { id: 'm2', drugName: 'Pantoprazole 40 mg (Pan 40)', composition: 'Pantoprazole 40mg', form: 'Tablet' as const, dosage: '40 mg', frequency: '1-0-0' as const, timing: 'Before Food' as const, durationDays: 5, instructions: 'Empty stomach' },
      { id: 'm3', drugName: 'Diclofenac Diethylamine Gel (Volini / Voveran)', composition: 'Diclofenac 1.16% + Linseed Oil + Menthol', form: 'Ointment' as const, dosage: 'Topical Application', frequency: '1-0-1' as const, timing: 'With Food' as const, durationDays: 14, instructions: 'Apply gently over anterior and posterior shoulder joint capsule' }
    ],
    labTests: [
      { id: 'lab-9', testName: 'Digital X-Ray Shoulder Joint AP & Axial View', category: 'Radiology' as const, price: 500 }
    ],
    advice: [
      'Moist heat pack for 10 minutes prior to exercise sessions',
      'Sleep on non-affected side with a pillow supporting affected arm in abduction',
      'Perform Home Exercise Program (HEP) 3 times daily within tolerable pain threshold (VAS <= 4)',
      'Avoid sudden jerky overhead reaching or heavy lifting (>2 kg)'
    ],
    physiotherapyAssessment: {
      vasPainScore: 7,
      painType: 'Aching' as const,
      painAggravatingFactors: 'Night pain sleeping on shoulder, reaching behind back, putting on coat',
      painRelievingFactors: 'Warm shower, resting arm on pillow',
      jointRomFindings: [
        { joint: 'Glenohumeral (Affected)', movement: 'Abduction', degrees: '75° (Normal 180° - Restricted)', endFeel: 'Capsular / Firm' as const },
        { joint: 'Glenohumeral (Affected)', movement: 'External Rotation', degrees: '25° (Normal 90° - Marked Restriction)', endFeel: 'Empty / Painful' as const },
        { joint: 'Glenohumeral (Affected)', movement: 'Flexion', degrees: '105° (Normal 180°)', endFeel: 'Capsular / Firm' as const },
        { joint: 'Glenohumeral (Affected)', movement: 'Internal Rotation', degrees: 'L5 vertebral level (Normal T7)', endFeel: 'Capsular / Firm' as const }
      ],
      muscleStrengthMmt: [
        { muscleGroup: 'Rotator Cuff (Supraspinatus/Infraspinatus)', grade: '3/5 (Fair - Anti-gravity)' as const },
        { muscleGroup: 'Deltoid & Periscapulars', grade: '4/5 (Good)' as const }
      ],
      gaitAndPosture: 'Protective guarded posture with elevation and internal rotation of affected shoulder',
      specialOrthopedicTests: [
        { testName: "Neer's Impingement Test", result: 'Positive (+)' as const, notes: 'Subacromial pain provoked' },
        { testName: "Hawkins-Kennedy Test", result: 'Positive (+)' as const, notes: 'Severe anterior pain' },
        { testName: "Empty Can (Jobe's) Test", result: 'Equivocal' as const, notes: 'Weakness secondary to capsular pain' }
      ],
      functionalGoals: [
        'Restore shoulder external rotation to >= 60° within 3 weeks',
        'Enable pain-free sleep throughout the night (VAS < 2)',
        'Restore independent overhead dressing and grooming'
      ]
    },
    performedTherapies: [
      {
        id: 'proc-1',
        name: 'Trigger Point Dry Needling (DN)',
        type: 'Dry Needling' as const,
        targetArea: 'Infraspinatus, Supraspinatus & Upper Trapezius',
        parameters: '0.25 x 40mm sterile Seirin needles, 3 trigger points, piston technique with 4 twitch responses elicited',
        durationMinutes: 15,
        patientTolerance: 'Well Tolerated' as const
      },
      {
        id: 'proc-5',
        name: 'Glenohumeral Joint Mobilization (Maitland Grade II-III)',
        type: 'Manual Therapy' as const,
        targetArea: 'Left Glenohumeral Joint (Inferior Glide & Posterior Glide)',
        parameters: 'Grade II oscillatory distractor glide for pain relief, followed by Grade III inferior glide 3 sets x 40s',
        durationMinutes: 15,
        patientTolerance: 'Well Tolerated' as const
      },
      {
        id: 'proc-4',
        name: 'High Intensity Class IV Laser Therapy (LLLT)',
        type: 'Electrotherapy & Modality' as const,
        targetArea: 'Anterior & Inferior Joint Capsule',
        parameters: '810/980nm Dual Wavelength, 1000 Joules total energy dose',
        durationMinutes: 10,
        patientTolerance: 'Well Tolerated' as const
      }
    ],
    prescribedExercises: [
      {
        id: 'ex-7',
        exerciseName: "Codman's Pendulum Decompression Swings",
        targetArea: 'Shoulder & Arm' as const,
        sets: 3,
        reps: 20,
        holdSeconds: 0,
        frequency: '3x Daily' as const,
        resistanceBand: 'None' as const,
        instructions: 'Lean forward supporting non-affected arm on a table. Let affected arm dangle freely. Use body momentum to swing arm in gentle circles.',
        precautions: 'Passive movement using gravity. Do not tense shoulder muscles.'
      },
      {
        id: 'ex-9',
        exerciseName: 'Wall Finger Ladder Climbing (Adhesive Capsulitis)',
        targetArea: 'Shoulder & Arm' as const,
        sets: 3,
        reps: 10,
        holdSeconds: 5,
        frequency: '3x Daily' as const,
        resistanceBand: 'None' as const,
        instructions: 'Stand facing the wall. Walk fingers slowly up the wall to end range of elevation. Hold for 5 seconds at top stretch point.',
        precautions: 'Stop at point of tolerable stretch. Do not shrug the shoulder abnormally.'
      },
      {
        id: 'ex-8',
        exerciseName: 'Theraband Shoulder External Rotation (Rotator Cuff)',
        targetArea: 'Shoulder & Arm' as const,
        sets: 3,
        reps: 12,
        holdSeconds: 2,
        frequency: '2x Daily' as const,
        resistanceBand: 'Yellow (Light)' as const,
        instructions: 'Stand with elbow tucked at 90° with a small towel roll under armpit. Pull resistance band outward away from body.',
        precautions: 'Control the eccentric return slowly; do not let the band snap back.'
      }
    ]
  },
  {
    id: 'preset-physio-lumbar-radiculopathy',
    specialty: 'Physiotherapy & Rehabilitation' as PolyclinicSpecialty,
    name: 'Lumbar Disc Herniation & Sciatica (L4-L5 Radiculopathy)',
    diagnosis: 'Lumbar Intervertebral Disc Prolapse (L4-L5) with Sciatic Radiculopathy',
    icd10: 'M51.1',
    medicines: [
      { id: 'm1', drugName: 'Aceclofenac + Serratiopeptidase (Zerodol-SP)', composition: 'Aceclofenac 100mg + Paracetamol 325mg + Serratiopeptidase 15mg', form: 'Tablet' as const, dosage: '1 Tablet', frequency: '1-0-1' as const, timing: 'After Food' as const, durationDays: 5, instructions: 'Twice daily after meals' },
      { id: 'm2', drugName: 'Methylcobalamin + Alpha Lipoic Acid (Neurobion Forte)', composition: 'Mecobalamin 1500mcg + ALA 100mg', form: 'Tablet' as const, dosage: '1 Tablet', frequency: '0-0-1' as const, timing: 'After Food' as const, durationDays: 30, instructions: 'At bedtime for nerve regeneration' }
    ],
    labTests: [
      { id: 'lab-9', testName: 'MRI Lumbar Spine with Screening Whole Spine', category: 'Radiology' as const, price: 3500 }
    ],
    advice: [
      'Maintain strict spinal neutrality; avoid forward bending (flexion) and lifting heavy objects from floor',
      'Use lumbar support cushion while sitting; avoid soft sagging couches and prolonged sitting >30 minutes',
      'Apply cold pack to lower back for 15 minutes during acute flare-ups',
      'Walk on even surfaces for 15-20 minutes twice daily as tolerated'
    ],
    physiotherapyAssessment: {
      vasPainScore: 8,
      painType: 'Radiating / Neural' as const,
      painAggravatingFactors: 'Prolonged sitting, coughing, forward bending, driving',
      painRelievingFactors: 'Prone lying (McKenzie position), short walking breaks',
      jointRomFindings: [
        { joint: 'Lumbar Spine', movement: 'Flexion', degrees: '30° (Severe pain & peripheralization)', endFeel: 'Empty / Painful' as const },
        { joint: 'Lumbar Spine', movement: 'Extension', degrees: '15° (Centralization of leg symptoms)', endFeel: 'Capsular / Firm' as const }
      ],
      muscleStrengthMmt: [
        { muscleGroup: 'Tibialis Anterior (L4 root)', grade: '5/5 (Normal)' as const },
        { muscleGroup: 'Extensor Hallucis Longus (L5 root)', grade: '4/5 (Good)' as const },
        { muscleGroup: 'Gastrocnemius / Soleus (S1 root)', grade: '5/5 (Normal)' as const }
      ],
      gaitAndPosture: 'Antalgic gait with lateral trunk shift away from symptomatic side (sciatic list)',
      specialOrthopedicTests: [
        { testName: 'Straight Leg Raise (SLR) Right', result: 'Positive (+)' as const, notes: 'Shooting pain along L5 dermatome at 40°' },
        { testName: 'Bragard Test (SLR + Dorsiflexion)', result: 'Positive (+)' as const, notes: 'Aggravates posterior thigh and calf radiation' },
        { testName: 'Slump Test', result: 'Positive (+)' as const, notes: 'Reproduces neural tension symptoms' }
      ],
      functionalGoals: [
        'Centralize radicular pain completely out of calf/foot into lower back',
        'Achieve pain-free sitting tolerance of 45 minutes',
        'Restore normal pain-free walking without antalgic list'
      ]
    },
    performedTherapies: [
      {
        id: 'proc-1',
        name: 'Trigger Point Dry Needling (DN)',
        type: 'Dry Needling' as const,
        targetArea: 'Right Piriformis, Gluteus Medius & L4-L5 Multifidus',
        parameters: '0.30 x 60mm deep needles, 4 points, local twitch responses obtained in piriformis',
        durationMinutes: 15,
        patientTolerance: 'Well Tolerated' as const
      },
      {
        id: 'proc-2',
        name: 'Interferential Therapy (IFT) 4-Pole Vector',
        type: 'Electrotherapy & Modality' as const,
        targetArea: 'Lumbar Paraspinal & Sciatic Notch (L4-S1)',
        parameters: '4000Hz carrier, 80-120Hz rhythmic sweep, 4 suction vacuum electrodes',
        durationMinutes: 20,
        patientTolerance: 'Well Tolerated' as const
      },
      {
        id: 'proc-8',
        name: 'Computerized Lumbar Mechanical Decompression Traction',
        type: 'Traction & Decompression' as const,
        targetArea: 'Lumbar Spine (L4-S1)',
        parameters: 'Intermittent traction, 22 kg progressive tension, 30s pull / 10s rest cycle',
        durationMinutes: 20,
        patientTolerance: 'Well Tolerated' as const
      }
    ],
    prescribedExercises: [
      {
        id: 'ex-3',
        exerciseName: 'McKenzie Lumbar Prone Press-Up / Extension',
        targetArea: 'Lower Back & Core' as const,
        sets: 3,
        reps: 10,
        holdSeconds: 3,
        frequency: '3x Daily' as const,
        resistanceBand: 'None' as const,
        instructions: 'Lie prone on stomach. Place hands under shoulders and press upper body upward while keeping pelvis and buttocks completely relaxed on the mat.',
        precautions: 'Centralizes lumbar disc pain. Discontinue if pain peripheralizes down into the foot.'
      },
      {
        id: 'ex-5',
        exerciseName: 'Pelvic Bridging with Gluteal Squeeze',
        targetArea: 'Lower Back & Core' as const,
        sets: 3,
        reps: 12,
        holdSeconds: 5,
        frequency: '2x Daily' as const,
        resistanceBand: 'None' as const,
        instructions: 'Lie supine with knees bent and feet flat. Squeeze glutes and lift hips until thighs and torso align in a straight diagonal.',
        precautions: 'Avoid hyperextending the lower back at the top of the bridge.'
      },
      {
        id: 'ex-6',
        exerciseName: 'Bird-Dog Contralateral Core Stabilization',
        targetArea: 'Lower Back & Core' as const,
        sets: 3,
        reps: 10,
        holdSeconds: 4,
        frequency: '1x Daily' as const,
        resistanceBand: 'None' as const,
        instructions: 'From quadruped, extend right arm forward and left leg straight back simultaneously without rotating pelvis. Alternate sides.',
        precautions: 'Keep spine neutral; do not let lumbar spine sag.'
      }
    ]
  },
  {
    id: 'preset-physio-cervical-spasm',
    specialty: 'Physiotherapy & Rehabilitation' as PolyclinicSpecialty,
    name: 'Cervical Spondylosis & Trapezius Trigger Points',
    diagnosis: 'Cervical Spondylosis with Myofascial Pain Syndrome',
    icd10: 'M47.812',
    medicines: [
      { id: 'm1', drugName: 'Paracetamol 650 mg (Dolo 650)', composition: 'Paracetamol 650mg', form: 'Tablet' as const, dosage: '650 mg', frequency: '1-0-1' as const, timing: 'After Food' as const, durationDays: 3, instructions: 'For neck pain & tension headache' },
      { id: 'm2', drugName: 'Methylcobalamin + Alpha Lipoic Acid (Neurobion Forte)', composition: 'Mecobalamin 1500mcg', form: 'Tablet' as const, dosage: '1 Tablet', frequency: '0-0-1' as const, timing: 'After Food' as const, durationDays: 30, instructions: 'Bedtime' }
    ],
    labTests: [
      { id: 'lab-9', testName: 'Digital X-Ray Cervical Spine AP & Lateral View', category: 'Radiology' as const, price: 450 }
    ],
    advice: [
      'Adjust computer screen to eye level; maintain ergonomic 90° elbow & knee alignment',
      'Take a 2-minute posture micro-break every 30 minutes of desk work',
      'Use ergonomic cervical contour pillow while sleeping',
      'Avoid looking down at smartphones in high flexion (text neck)'
    ],
    physiotherapyAssessment: {
      vasPainScore: 6,
      painType: 'Aching' as const,
      painAggravatingFactors: 'Continuous computer monitor work >1 hr, driving, reading',
      painRelievingFactors: 'Warm shower, neck massage, chin tucks',
      jointRomFindings: [
        { joint: 'Cervical Spine', movement: 'Rotation (Bilateral)', degrees: 'Right 50° / Left 45° (Normal 80°)', endFeel: 'Capsular / Firm' as const },
        { joint: 'Cervical Spine', movement: 'Side Flexion', degrees: 'Right 30° / Left 25° (Normal 45°)', endFeel: 'Empty / Painful' as const }
      ],
      muscleStrengthMmt: [
        { muscleGroup: 'Deep Neck Flexors (Longus Colli/Capitis)', grade: '3/5 (Fair - Anti-gravity)' as const },
        { muscleGroup: 'Rhomboids & Middle Trapezius', grade: '4/5 (Good)' as const }
      ],
      gaitAndPosture: 'Forward head posture (craniovertebral angle < 48°), protracted rounded shoulders',
      specialOrthopedicTests: [
        { testName: "Spurling's Cervical Compression Test", result: 'Negative (-)' as const, notes: 'No nerve root foraminal compression' },
        { testName: 'Upper Limb Tension Test (ULTT1 Median)', result: 'Negative (-)' as const, notes: 'No neural tension' }
      ],
      functionalGoals: [
        'Eliminate cervicogenic tension headaches',
        'Restore painless full cervical rotation to 80°',
        'Correct forward head posture by strengthening deep cervical flexors'
      ]
    },
    performedTherapies: [
      {
        id: 'proc-1',
        name: 'Trigger Point Dry Needling (DN)',
        type: 'Dry Needling' as const,
        targetArea: 'Bilateral Upper Trapezius, Levator Scapulae & Suboccipital Triangle',
        parameters: '0.25 x 40mm needles, 6 trigger points released, local twitch responses elicited bilaterally',
        durationMinutes: 15,
        patientTolerance: 'Well Tolerated' as const
      },
      {
        id: 'proc-3',
        name: 'Therapeutic Ultrasound Therapy (1 MHz Pulsed 1:4)',
        type: 'Electrotherapy & Modality' as const,
        targetArea: 'Upper Trapezius Muscle Belly',
        parameters: 'Pulsed 20% duty cycle, 1.0 W/cm², phonophoresis with diclofenac gel',
        durationMinutes: 8,
        patientTolerance: 'Well Tolerated' as const
      }
    ],
    prescribedExercises: [
      {
        id: 'ex-1',
        exerciseName: 'Isometric Cervical Neck Contractions (Flexion, Extension & Lateral)',
        targetArea: 'Spine & Neck' as const,
        sets: 3,
        reps: 10,
        holdSeconds: 5,
        frequency: '2x Daily' as const,
        resistanceBand: 'None' as const,
        instructions: 'Sit upright. Place hand on forehead/side of head. Push head gently into palm without moving neck. Hold for 5 seconds.',
        precautions: 'Do not hold breath. Stop if dizziness occurs.'
      },
      {
        id: 'ex-2',
        exerciseName: 'Chin Tucks (Deep Neck Flexor Activation)',
        targetArea: 'Spine & Neck' as const,
        sets: 3,
        reps: 12,
        holdSeconds: 5,
        frequency: '3x Daily' as const,
        resistanceBand: 'None' as const,
        instructions: 'Keep eyes facing straight ahead. Glide chin straight back making a subtle double chin. Hold 5 seconds and release.',
        precautions: 'Do not tilt head down. Movement should be horizontal retraction.'
      },
      {
        id: 'ex-10',
        exerciseName: 'Scapular Retraction / Wall Angels',
        targetArea: 'Shoulder & Arm' as const,
        sets: 3,
        reps: 12,
        holdSeconds: 3,
        frequency: '2x Daily' as const,
        resistanceBand: 'None' as const,
        instructions: 'Stand against wall with back, head, and elbows touching wall. Slide arms up and down keeping contact with wall.',
        precautions: 'Engage middle and lower trapezius; keep ribs down.'
      }
    ]
  },

  // General Medicine & Other Presets
  {
    id: 'preset-urti',
    specialty: 'General Medicine' as PolyclinicSpecialty,
    name: 'Acute Upper Respiratory Tract Infection (URTI)',
    diagnosis: 'Acute Viral Rhinitis & Pharyngitis',
    icd10: 'J06.9',
    medicines: [
      { id: 'm1', drugName: 'Paracetamol 650 mg (Dolo 650)', composition: 'Paracetamol 650mg', form: 'Tablet' as const, dosage: '650 mg', frequency: '1-0-1' as const, timing: 'After Food' as const, durationDays: 3, instructions: 'For fever/bodyache' },
      { id: 'm2', drugName: 'Montelukast + Levocetirizine (Montair-LC)', composition: 'Montelukast 10mg + Levocetirizine 5mg', form: 'Tablet' as const, dosage: '1 Tablet', frequency: '0-0-1' as const, timing: 'At Bedtime' as const, durationDays: 5, instructions: 'Night dose' },
      { id: 'm3', drugName: 'Pantoprazole 40 mg (Pan 40)', composition: 'Pantoprazole 40mg', form: 'Tablet' as const, dosage: '40 mg', frequency: '1-0-0' as const, timing: 'Before Food' as const, durationDays: 5, instructions: '30 mins before breakfast' }
    ],
    labTests: [],
    advice: [
      'Warm saline gargles 3 times a day',
      'Steam inhalation twice daily with tulsi / mint',
      'Plenty of warm fluids and adequate sleep',
      'Review immediately if high fever >102°F or breathlessness develops'
    ]
  },
  {
    id: 'preset-t2dm',
    specialty: 'General Medicine' as PolyclinicSpecialty,
    name: 'Type 2 Diabetes Mellitus (Routine Review)',
    diagnosis: 'Type 2 Diabetes Mellitus without acute complications',
    icd10: 'E11.9',
    medicines: [
      { id: 'm1', drugName: 'Metformin 500 mg SR (Glycomet 500 SR)', composition: 'Metformin 500mg SR', form: 'Tablet' as const, dosage: '500 mg', frequency: '1-0-1' as const, timing: 'After Food' as const, durationDays: 30, instructions: 'With meals' },
      { id: 'm2', drugName: 'Telmisartan 40 mg (Telma 40)', composition: 'Telmisartan 40mg', form: 'Tablet' as const, dosage: '40 mg', frequency: '1-0-0' as const, timing: 'After Food' as const, durationDays: 30, instructions: 'Morning dose' },
      { id: 'm3', drugName: 'Methylcobalamin + Alpha Lipoic Acid (Neurobion Forte)', composition: 'Mecobalamin 1500mcg', form: 'Tablet' as const, dosage: '1 Tablet', frequency: '0-0-1' as const, timing: 'After Food' as const, durationDays: 30, instructions: 'Bedtime' }
    ],
    labTests: [
      { id: 'lab-2', testName: 'HbA1c (Glycosylated Hemoglobin)', category: 'Biochemistry' as const, price: 450 },
      { id: 'lab-3', testName: 'Fasting & Post-Prandial Blood Sugar (FBS + PPBS)', category: 'Biochemistry' as const, price: 200 },
      { id: 'lab-6', testName: 'Kidney Function Test (KFT)', category: 'Biochemistry' as const, price: 700 }
    ],
    advice: [
      'Maintain low glycemic index diet (avoid refined sugar, sweets, white bread)',
      '30-45 minutes brisk walking daily 5 days a week',
      'Self-monitor fasting blood sugar weekly and record in log',
      'Daily foot inspection for any cuts, redness, or blisters'
    ]
  },
  {
    id: 'preset-cardio-htn',
    specialty: 'Cardiology' as PolyclinicSpecialty,
    name: 'Essential Hypertension & Stable CAD',
    diagnosis: 'Stage 2 Essential Hypertension with Coronary Artery Disease',
    icd10: 'I10',
    medicines: [
      { id: 'm1', drugName: 'Telmisartan + Amlodipine (Telma-AM)', composition: 'Telmisartan 40mg + Amlodipine 5mg', form: 'Tablet' as const, dosage: '1 Tablet', frequency: '1-0-0' as const, timing: 'After Food' as const, durationDays: 30, instructions: 'Morning after breakfast' },
      { id: 'm2', drugName: 'Metoprolol Succinate ER 25 mg (Betaloc 25)', composition: 'Metoprolol 25mg ER', form: 'Tablet' as const, dosage: '25 mg', frequency: '1-0-0' as const, timing: 'After Food' as const, durationDays: 30, instructions: 'Once daily' },
      { id: 'm3', drugName: 'Rosuvastatin 10 mg (Rosuvas 10)', composition: 'Rosuvastatin 10mg', form: 'Tablet' as const, dosage: '10 mg', frequency: '0-0-1' as const, timing: 'At Bedtime' as const, durationDays: 30, instructions: 'Night dose' }
    ],
    labTests: [
      { id: 'lab-10', testName: '12-Lead Electrocardiogram (ECG)', category: 'Radiology' as const, price: 250 },
      { id: 'lab-4', testName: 'Lipid Profile (Full)', category: 'Biochemistry' as const, price: 650 }
    ],
    advice: [
      'Strict low sodium diet: < 2 grams of salt per day (avoid papad, pickles, chips)',
      'Monitor blood pressure twice weekly at home and maintain BP diary',
      'Target Resting BP < 130/80 mmHg; Target Heart Rate 60-70 bpm',
      'Seek immediate emergency care if chest heaviness or left arm radiation occurs'
    ]
  },
  {
    id: 'preset-derma-acne',
    specialty: 'Dermatology' as PolyclinicSpecialty,
    name: 'Acne Vulgaris (Grade II Inflammatory) & Hyperpigmentation',
    diagnosis: 'Acne Vulgaris Grade II with Post-Inflammatory Erythema',
    icd10: 'L70.0',
    medicines: [
      { id: 'm1', drugName: 'Azithromycin 500 mg (Azee 500)', composition: 'Azithromycin 500mg', form: 'Tablet' as const, dosage: '500 mg', frequency: '1-0-0' as const, timing: 'Before Food' as const, durationDays: 3, instructions: '1 tablet before breakfast for 3 consecutive days each week' },
      { id: 'm2', drugName: 'Adapalene + Benzoyl Peroxide Gel (Epiduo / Deriva-BPO)', composition: 'Adapalene 0.1% + BPO 2.5%', form: 'Ointment' as const, dosage: 'Pea-sized amount', frequency: '0-0-1' as const, timing: 'At Bedtime' as const, durationDays: 30, instructions: 'Apply thin layer on clean dry face at bedtime' }
    ],
    labTests: [],
    advice: [
      'Apply Broad Spectrum Sunscreen SPF 50+ every morning and reapply every 3 hours outdoors',
      'Use gentle non-comedogenic foaming cleanser; do not pick, squeeze, or scrub active lesions',
      'Avoid heavy comedogenic hair oils, cosmetics, and excessive dairy/whey protein'
    ]
  },
  // Ophthalmology Preset
  {
    id: 'preset-ophthalmology-refractive',
    specialty: 'Ophthalmology' as PolyclinicSpecialty,
    name: 'Compound Myopic Astigmatism & Digital Eye Strain Protocol',
    diagnosis: 'Compound Myopic Astigmatism with Asthenopia (Computer Vision Strain)',
    icd10: 'H52.2',
    medicines: [
      { id: 'm1', drugName: 'Carboxymethylcellulose 0.5% Eye Drops (Refresh Tears)', composition: 'Carboxymethylcellulose Sodium 0.5% w/v', form: 'Drops' as const, dosage: '1 Drop', frequency: '1-1-1' as const, timing: 'With Food' as const, durationDays: 30, instructions: 'Instill 1 drop in both eyes 4 times daily, especially during screen work' },
      { id: 'm2', drugName: 'Sodium Hyaluronate 0.1% Eye Drops (Hillo-Comod)', composition: 'Sodium Hyaluronate 0.1%', form: 'Drops' as const, dosage: '1 Drop SOS', frequency: 'SOS' as const, timing: 'With Food' as const, durationDays: 30, instructions: 'Instill for ocular burning or dry gritty sensation' }
    ],
    labTests: [
      { id: 'lab-opt-1', testName: 'Automated Keratometry & Corneal Topography', category: 'Radiology' as const, price: 600 }
    ],
    advice: [
      'Follow 20-20-20 rule: Every 20 minutes, look at an object 20 feet away for 20 seconds',
      'Wear prescribed anti-reflective blue-cut prescription glasses during computer and smartphone usage',
      'Avoid air conditioning draft blowing directly into eyes; maintain 50cm monitor distance'
    ],
    ophthalmologyAssessment: {
      visualAcuityOD: '6/18 (Unaided) -> 6/6 (With Correction)',
      visualAcuityOS: '6/24 (Unaided) -> 6/6 (With Correction)',
      refractionOD: { sphere: '-1.75', cyl: '-0.75', axis: '90°', add: '+0.00' },
      refractionOS: { sphere: '-2.25', cyl: '-1.00', axis: '85°', add: '+0.00' },
      pupillaryDistanceMm: 63,
      iopOD: 15,
      iopOS: 16,
      anteriorSegment: 'Cornea clear, anterior chamber deep and quiet, iris normal, lens clear',
      fundusExam: {
        cupToDiscRatioOD: '0.3 (Normal physiological cup)',
        cupToDiscRatioOS: '0.3 (Normal physiological cup)',
        retinaFindings: 'Macula normal with positive foveal reflex; no peripheral lattice degeneration or hemorrhages'
      }
    }
  },
  // Dental Surgery Preset
  {
    id: 'preset-dental-endodontic',
    specialty: 'Dental Surgery' as PolyclinicSpecialty,
    name: 'Symptomatic Irreversible Pulpitis & Root Canal (RCT) Protocol',
    diagnosis: 'Symptomatic Irreversible Pulpitis - Tooth #36 (Lower Left First Molar)',
    icd10: 'K04.0',
    medicines: [
      { id: 'm1', drugName: 'Amoxicillin + Clavulanate 625 mg (Augmentin 625)', composition: 'Amoxicillin 500mg + Clavulanic Acid 125mg', form: 'Tablet' as const, dosage: '625 mg', frequency: '1-0-1' as const, timing: 'With Food' as const, durationDays: 5, instructions: 'Take strictly after meals for 5 days' },
      { id: 'm2', drugName: 'Aceclofenac + Serratiopeptidase (Zerodol-SP)', composition: 'Aceclofenac 100mg + Paracetamol 325mg + Serratiopeptidase 15mg', form: 'Tablet' as const, dosage: '1 Tablet', frequency: '1-0-1' as const, timing: 'After Food' as const, durationDays: 3, instructions: 'Anti-inflammatory for endodontic pain' },
      { id: 'm3', drugName: 'Chlorhexidine 0.2% Mouthwash (Hexidine / Clohex)', composition: 'Chlorhexidine Gluconate 0.2% w/v', form: 'Drops' as const, dosage: '10 ml', frequency: '1-0-1' as const, timing: 'After Food' as const, durationDays: 14, instructions: 'Rinse mouth for 1 minute twice daily after brushing' }
    ],
    labTests: [
      { id: 'lab-dent-1', testName: 'Intraoral Periapical Radiograph (IOPA) - Tooth #36', category: 'Radiology' as const, price: 150 },
      { id: 'lab-dent-2', testName: 'Orthopantomogram (OPG - Full Mouth Panoramic X-Ray)', category: 'Radiology' as const, price: 650 }
    ],
    advice: [
      'Do not chew hard, crunchy, or sticky foods from the left side until temporary restoration is replaced by crown',
      'Warm saline rinses 3 times daily starting tomorrow',
      'Report immediately if facial swelling, fever, or persistent throbbing pain occurs'
    ],
    dentalAssessment: {
      teethStatus: {
        36: { condition: 'Root Canal' as const, notes: 'Deep occlusal caries with pulpal involvement' },
        46: { condition: 'Restored' as const, notes: 'Composite restoration intact' },
        16: { condition: 'Caries' as const, notes: 'Incipient pit and fissure caries' },
        38: { condition: 'Extraction Needed' as const, notes: 'Mesioangularly impacted third molar' }
      },
      periodontalStatus: 'Gingivitis' as const,
      plaqueCalculusIndex: 'Moderate' as const,
      plannedProcedures: [
        { toothNumber: 36, procedure: 'Single-Visit Rotary Root Canal Treatment (RCT)', estimatedCost: 3500, status: 'Planned' as const },
        { toothNumber: 36, procedure: 'Zirconia / PFM Ceramic Crown', estimatedCost: 4500, status: 'Planned' as const },
        { procedure: 'Full Mouth Ultrasonic Scaling & Polishing', estimatedCost: 1200, status: 'Planned' as const }
      ]
    }
  },
  // Gynecology & Obstetrics Preset
  {
    id: 'preset-gynecology-antenatal',
    specialty: 'Gynecology' as PolyclinicSpecialty,
    name: 'Antenatal Care (Second Trimester - 24 Weeks Routine)',
    diagnosis: 'Intrauterine Single Live Pregnancy at 24 Weeks Gestation (Primi Gravida)',
    icd10: 'Z34.0',
    medicines: [
      { id: 'm1', drugName: 'Ferrous Ascorbate + Folic Acid (Orofer-XT)', composition: 'Elemental Iron 100mg + Folic Acid 1.5mg', form: 'Tablet' as const, dosage: '1 Tablet', frequency: '1-0-0' as const, timing: 'After Food' as const, durationDays: 30, instructions: 'Take with lemon water or orange juice; avoid taking with milk/tea' },
      { id: 'm2', drugName: 'Calcium + Vitamin D3 (Shelcal 500)', composition: 'Calcium Carbonate 500mg + Vitamin D3 250 IU', form: 'Tablet' as const, dosage: '500 mg', frequency: '0-0-1' as const, timing: 'After Food' as const, durationDays: 30, instructions: 'Take after dinner with water' }
    ],
    labTests: [
      { id: 'lab-obg-1', testName: 'Oral Glucose Tolerance Test (OGTT 75g DipSI)', category: 'Biochemistry' as const, price: 300 },
      { id: 'lab-obg-2', testName: 'Complete Blood Count (CBC with Ferritin)', category: 'Hematology' as const, price: 500 }
    ],
    advice: [
      'Maintain daily fetal kick count (DFKC): Ensure at least 10 active kicks/movements in a 2-hour relaxed window',
      'Sleep on left lateral decubitus position with pillow between knees for optimal uteroplacental perfusion',
      'Hydrate with at least 2.5 - 3 Litres of fluids daily; include coconut water and fresh seasonal fruits',
      'Warning signs to report immediately: Vaginal bleeding, watery discharge, severe headache/blurring of vision, or sudden reduction in fetal kicks'
    ],
    gynecologyAssessment: {
      lmpDate: '2026-03-17',
      calculatedEdd: '2026-12-22',
      gestationalAgeWeeks: 24,
      gestationalAgeDays: 0,
      trimester: '2nd Trimester' as const,
      gravidaPara: { g: 1, p: 0, l: 0, a: 0 },
      fundalHeightCm: 24,
      fetalHeartRateBpm: 144,
      presentation: 'Cephalic / Vertex' as const,
      quickeningPresent: true,
      highRiskFactors: ['None (Low Risk Antenatal)'],
      antenatalChecklist: [
        { item: 'First Trimester Dating Scan', completed: true },
        { item: 'Dual Marker / NIPT Screening', completed: true },
        { item: 'TIFFA Anomaly Scan (18-20 Weeks)', completed: true },
        { item: 'Tetanus Toxoid / Tdap Dose 1', completed: true },
        { item: 'Tetanus Toxoid / Tdap Dose 2', completed: false, dueDate: '2026-09-15' },
        { item: '75g Oral Glucose Tolerance Test (OGTT)', completed: false, dueDate: '2026-09-08' }
      ]
    }
  }
];

export const DEFAULT_DOCTORS: Doctor[] = [
  {
    id: 'doc-1',
    name: 'Dr. Vikram Malhotra',
    qualification: 'MBBS, MD (General Medicine), FICP',
    regNumber: 'MCI-2012-74892',
    specialty: 'General Medicine',
    experienceYears: 14,
    consultationFee: 600,
    opdRoom: 'OPD Room 102',
    availableDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    opdTiming: '09:00 AM - 02:00 PM',
    phone: '+91 98765 43210',
    email: 'dr.malhotra@lumera.health',
    active: true
  },
  {
    id: 'doc-6',
    name: 'Dr. Siddharth Varma (PT)',
    qualification: 'BPT, MPT (Musculoskeletal & Sports Physiotherapy), MIAP, CMP',
    regNumber: 'IAP-2014-9921',
    specialty: 'Physiotherapy & Rehabilitation',
    experienceYears: 12,
    consultationFee: 700,
    opdRoom: 'Physio & Rehab Suite 105',
    availableDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    opdTiming: '08:30 AM - 01:30 PM, 04:30 PM - 08:00 PM',
    phone: '+91 98312 77889',
    email: 'dr.siddharth@lumera.health',
    active: true
  },
  {
    id: 'doc-2',
    name: 'Dr. Ananya Sen',
    qualification: 'MBBS, MD (Pediatrics), DCH (London)',
    regNumber: 'WBMC-2016-39482',
    specialty: 'Pediatrics',
    experienceYears: 9,
    consultationFee: 700,
    opdRoom: 'OPD Room 104',
    availableDays: ['Mon', 'Wed', 'Fri', 'Sat'],
    opdTiming: '10:00 AM - 03:00 PM',
    phone: '+91 98112 34567',
    email: 'dr.ananya@lumera.health',
    active: true
  },
  {
    id: 'doc-3',
    name: 'Dr. Rajesh Sharma',
    qualification: 'MBBS, MD, DM (Cardiology), FACC',
    regNumber: 'DMC-2008-11928',
    specialty: 'Cardiology',
    experienceYears: 18,
    consultationFee: 1000,
    opdRoom: 'Cardiac OPD 201',
    availableDays: ['Tue', 'Thu', 'Sat'],
    opdTiming: '11:00 AM - 04:00 PM',
    phone: '+91 98223 99887',
    email: 'dr.rajesh@lumera.health',
    active: true
  },
  {
    id: 'doc-4',
    name: 'Dr. Meera Vasudevan',
    qualification: 'MBBS, MD (Dermatology, Venereology & Leprosy)',
    regNumber: 'KMC-2015-88392',
    specialty: 'Dermatology',
    experienceYears: 11,
    consultationFee: 750,
    opdRoom: 'Derma Suite 108',
    availableDays: ['Mon', 'Tue', 'Thu', 'Fri'],
    opdTiming: '02:00 PM - 07:00 PM',
    phone: '+91 97334 11223',
    email: 'dr.meera@lumera.health',
    active: true
  },
  {
    id: 'doc-5',
    name: 'Dr. Harshvardhan Patel',
    qualification: 'MBBS, MS (Orthopedics), M.Ch (Joint Replacement)',
    regNumber: 'GMC-2010-55421',
    specialty: 'Orthopedics',
    experienceYears: 15,
    consultationFee: 800,
    opdRoom: 'Ortho OPD 106',
    availableDays: ['Mon', 'Wed', 'Fri'],
    opdTiming: '09:30 AM - 01:30 PM',
    phone: '+91 99445 66778',
    email: 'dr.harsh@lumera.health',
    active: true
  },
  {
    id: 'doc-7',
    name: 'Dr. Shalini Mukhopadhyay',
    qualification: 'MBBS, MS (Obstetrics & Gynecology), DGO, FICOG',
    regNumber: 'WBMC-2011-44910',
    specialty: 'Gynecology',
    experienceYears: 15,
    consultationFee: 800,
    opdRoom: 'Women & Maternity Suite 203',
    availableDays: ['Mon', 'Tue', 'Thu', 'Sat'],
    opdTiming: '10:00 AM - 02:30 PM',
    phone: '+91 98319 88990',
    email: 'dr.shalini@lumera.health',
    active: true
  },
  {
    id: 'doc-8',
    name: 'Dr. Arunachalam Swamy',
    qualification: 'BDS, MDS (Conservative Dentistry & Endodontics), FIA',
    regNumber: 'DCI-2013-19920',
    specialty: 'Dental Surgery',
    experienceYears: 13,
    consultationFee: 650,
    opdRoom: 'Dental Operatory 109',
    availableDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    opdTiming: '09:00 AM - 01:00 PM, 05:00 PM - 08:30 PM',
    phone: '+91 98401 22334',
    email: 'dr.arun@lumera.health',
    active: true
  },
  {
    id: 'doc-9',
    name: 'Dr. Alok Nath Mukherjee',
    qualification: 'MBBS, MS (Ophthalmology), DNB, FICO (UK)',
    regNumber: 'DMC-2009-33211',
    specialty: 'Ophthalmology',
    experienceYears: 16,
    consultationFee: 750,
    opdRoom: 'Eye & Refraction Suite 205',
    availableDays: ['Mon', 'Wed', 'Fri', 'Sat'],
    opdTiming: '11:00 AM - 04:30 PM',
    phone: '+91 98109 44332',
    email: 'dr.alok@lumera.health',
    active: true
  }
];

export const DEFAULT_PATIENTS: Patient[] = [
  {
    id: 'pat-6',
    uhid: 'LUM-2026-0106',
    name: 'Rajiv Saxena',
    age: 44,
    gender: 'Male',
    phone: '+91 98234 55667',
    email: 'rajiv.saxena@gmail.com',
    bloodGroup: 'O+',
    allergies: ['None known'],
    chronicConditions: ['Lumbar Disc Herniation (L4-L5)', 'Sedentary IT Posture Strain'],
    emergencyContact: 'Meena Saxena (Wife) - +91 98234 99001',
    address: 'A-502, Orchid Woods, Whitefield, Bengaluru',
    lastVisit: '2026-08-30'
  },
  {
    id: 'pat-7',
    uhid: 'LUM-2026-0107',
    name: 'Priyanka Mukherjee',
    age: 52,
    gender: 'Female',
    phone: '+91 98311 44556',
    email: 'priyanka.m@gmail.com',
    bloodGroup: 'A+',
    allergies: ['Sulfa drugs'],
    chronicConditions: ['Adhesive Capsulitis (Left Shoulder)', 'Type 2 Diabetes'],
    emergencyContact: 'Debashis Mukherjee (Husband) - +91 98311 77889',
    address: '18/2, Gariahat Road, South Kolkata',
    lastVisit: '2026-08-29'
  },
  {
    id: 'pat-1',
    uhid: 'LUM-2026-0101',
    name: 'Sunita Roy',
    age: 48,
    gender: 'Female',
    phone: '+91 98301 23456',
    email: 'sunita.roy@gmail.com',
    bloodGroup: 'B+',
    allergies: ['Penicillin', 'Sulfa drugs'],
    chronicConditions: ['Type 2 Diabetes', 'Hypertension'],
    emergencyContact: 'Amit Roy (Husband) - +91 98301 99887',
    address: 'Flat 4B, Greenwood Heights, Salt Lake, Kolkata',
    lastVisit: '2026-08-20'
  },
  {
    id: 'pat-2',
    uhid: 'LUM-2026-0102',
    name: 'Rohan Deshmukh',
    age: 32,
    gender: 'Male',
    phone: '+91 98200 45678',
    email: 'rohan.deshmukh@outlook.com',
    bloodGroup: 'O+',
    allergies: ['None known'],
    chronicConditions: ['Allergic Rhinitis'],
    emergencyContact: 'Pooja Deshmukh (Wife) - +91 98200 88990',
    address: 'B-201, Shanti Park, Andheri East, Mumbai',
    lastVisit: '2026-08-28'
  },
  {
    id: 'pat-3',
    uhid: 'LUM-2026-0103',
    name: 'Aarav Gupta',
    age: 6,
    gender: 'Male',
    phone: '+91 97110 54321',
    bloodGroup: 'A+',
    allergies: ['Dust mites', 'Peanuts'],
    chronicConditions: ['Childhood Asthma'],
    emergencyContact: 'Neha Gupta (Mother) - +91 97110 54321',
    address: 'C-44, Sector 50, Noida, UP',
    lastVisit: '2026-08-25'
  },
  {
    id: 'pat-4',
    uhid: 'LUM-2026-0104',
    name: 'Mohammed Tariq',
    age: 58,
    gender: 'Male',
    phone: '+91 98450 78901',
    email: 'tariq.mohd@gmail.com',
    bloodGroup: 'AB+',
    allergies: ['Aspirin (Bronchospasm)'],
    chronicConditions: ['Ischemic Heart Disease (Post-PTCA 2024)', 'Dyslipidemia'],
    emergencyContact: 'Zaid Tariq (Son) - +91 98450 11223',
    address: '14, 8th Main, Indiranagar, Bengaluru',
    lastVisit: '2026-08-15'
  },
  {
    id: 'pat-5',
    uhid: 'LUM-2026-0105',
    name: 'Kavita Menon',
    age: 27,
    gender: 'Female',
    phone: '+91 98950 12399',
    bloodGroup: 'O-',
    allergies: ['None known'],
    chronicConditions: ['PCOS'],
    emergencyContact: 'Suresh Menon (Father) - +91 98950 44556',
    address: '32/145, Marine Drive, Kochi, Kerala',
    lastVisit: '2026-08-10'
  }
];

export const DEFAULT_APPOINTMENTS: Appointment[] = [
  {
    id: 'apt-physio-1',
    tokenNumber: 1,
    patientId: 'pat-6',
    patientName: 'Rajiv Saxena',
    patientPhone: '+91 98234 55667',
    uhid: 'LUM-2026-0106',
    doctorId: 'doc-6',
    doctorName: 'Dr. Siddharth Varma (PT)',
    specialty: 'Physiotherapy & Rehabilitation',
    date: '2026-09-01',
    timeSlot: '09:00 AM',
    type: 'New Consultation',
    status: 'In Consultation',
    source: 'WhatsApp Bot',
    consultationFee: 700,
    isPaid: true,
    vitals: {
      bloodPressureSystolic: 124,
      bloodPressureDiastolic: 80,
      heartRate: 72,
      temperature: 98.4,
      spO2: 99,
      weightKg: 78.0,
      heightCm: 176,
      bmi: 25.2,
      recordedAt: '08:50 AM',
      recordedBy: 'Nurse Rina'
    }
  },
  {
    id: 'apt-physio-2',
    tokenNumber: 2,
    patientId: 'pat-7',
    patientName: 'Priyanka Mukherjee',
    patientPhone: '+91 98311 44556',
    uhid: 'LUM-2026-0107',
    doctorId: 'doc-6',
    doctorName: 'Dr. Siddharth Varma (PT)',
    specialty: 'Physiotherapy & Rehabilitation',
    date: '2026-09-01',
    timeSlot: '09:45 AM',
    type: 'Follow-up',
    status: 'Waiting',
    source: 'Online Portal',
    consultationFee: 700,
    isPaid: true
  },
  {
    id: 'apt-1',
    tokenNumber: 3,
    patientId: 'pat-1',
    patientName: 'Sunita Roy',
    patientPhone: '+91 98301 23456',
    uhid: 'LUM-2026-0101',
    doctorId: 'doc-1',
    doctorName: 'Dr. Vikram Malhotra',
    specialty: 'General Medicine',
    date: '2026-09-01',
    timeSlot: '10:15 AM',
    type: 'Follow-up',
    status: 'Waiting',
    source: 'WhatsApp Bot',
    consultationFee: 600,
    isPaid: true,
    vitals: {
      bloodPressureSystolic: 132,
      bloodPressureDiastolic: 84,
      heartRate: 76,
      temperature: 98.4,
      spO2: 99,
      weightKg: 68.5,
      heightCm: 158,
      bmi: 27.4,
      bloodSugarRandom: 148,
      recordedAt: '09:15 AM',
      recordedBy: 'Nurse Rina'
    }
  },
  {
    id: 'apt-2',
    tokenNumber: 4,
    patientId: 'pat-2',
    patientName: 'Rohan Deshmukh',
    patientPhone: '+91 98200 45678',
    uhid: 'LUM-2026-0102',
    doctorId: 'doc-1',
    doctorName: 'Dr. Vikram Malhotra',
    specialty: 'General Medicine',
    date: '2026-09-01',
    timeSlot: '10:45 AM',
    type: 'New Consultation',
    status: 'Waiting',
    source: 'Walk-in',
    consultationFee: 600,
    isPaid: true,
    vitals: {
      bloodPressureSystolic: 118,
      bloodPressureDiastolic: 78,
      heartRate: 82,
      temperature: 100.2,
      spO2: 98,
      weightKg: 74.0,
      heightCm: 175,
      bmi: 24.2,
      recordedAt: '09:40 AM',
      recordedBy: 'Nurse Rina'
    }
  },
  {
    id: 'apt-3',
    tokenNumber: 5,
    patientId: 'pat-3',
    patientName: 'Aarav Gupta',
    patientPhone: '+91 97110 54321',
    uhid: 'LUM-2026-0103',
    doctorId: 'doc-2',
    doctorName: 'Dr. Ananya Sen',
    specialty: 'Pediatrics',
    date: '2026-09-01',
    timeSlot: '11:15 AM',
    type: 'New Consultation',
    status: 'Waiting',
    source: 'Online Portal',
    consultationFee: 700,
    isPaid: false
  },
  {
    id: 'apt-4',
    tokenNumber: 6,
    patientId: 'pat-4',
    patientName: 'Mohammed Tariq',
    patientPhone: '+91 98450 78901',
    uhid: 'LUM-2026-0104',
    doctorId: 'doc-3',
    doctorName: 'Dr. Rajesh Sharma',
    specialty: 'Cardiology',
    date: '2026-09-01',
    timeSlot: '11:45 AM',
    type: 'Follow-up',
    status: 'Waiting',
    source: 'WhatsApp Bot',
    consultationFee: 1000,
    isPaid: true
  },
  {
    id: 'apt-5',
    tokenNumber: 7,
    patientId: 'pat-5',
    patientName: 'Kavita Menon',
    patientPhone: '+91 98950 12399',
    uhid: 'LUM-2026-0105',
    doctorId: 'doc-4',
    doctorName: 'Dr. Meera Vasudevan',
    specialty: 'Dermatology',
    date: '2026-09-01',
    timeSlot: '02:30 PM',
    type: 'New Consultation',
    status: 'Waiting',
    source: 'Online Portal',
    consultationFee: 750,
    isPaid: false
  }
];

export const DEFAULT_CLINIC_SETTINGS: ClinicSettings = {
  name: 'Lumera Healthcare & Polyclinic Institute',
  tagline: 'Precision AI-Powered Multi-Specialty Clinical Center',
  address: 'Suite 401-405, Healthcare Towers, 14 Park Circus Avenue',
  city: 'Kolkata, West Bengal - 700017',
  phone: '+91 (033) 2289-9000 / +91 98000 12345',
  email: 'care@lumeraclinic.in',
  gstin: '19AABCL8899K1Z5',
  regId: 'WB-CLINIC-REG-2023/8892',
  upiId: 'lumerahealth@icici',
  whatsappNumber: '+91 98000 12345',
  headerBgColor: '#0f172a',
  accentColor: '#0d9488',
  showLogo: true,
  showQrCode: true,
  sealText: 'Authorized Medical Seal & Digital Signature Verified',
  footerDisclaimer: 'This prescription is digitally verified under National Health Authority (NHA) & Telemedicine Practice Guidelines. Please report any adverse drug reactions immediately.'
};

export const DEFAULT_WHATSAPP_TEMPLATES: WhatsAppTemplate[] = [
  {
    id: 'tmpl-1',
    name: 'appointment_confirmation_v2',
    category: 'APPOINTMENT_REMINDER',
    language: 'English (en_US)',
    headerText: '🏥 Lumera Polyclinic - Appointment Confirmed',
    bodyText: 'Hello {{1}},\n\nYour appointment with {{2}} ({{3}}) has been confirmed for *{{4}} at {{5}}*.\n\n📍 Token No: *{{6}}*\n🏥 Room: {{7}}\n\nPlease arrive 10 minutes prior for vitals check.',
    footerText: 'Reply CANCEL to cancel or RESCHEDULE to change time',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Confirm Arrival', payload: 'CONFIRM_ARRIVAL' },
      { type: 'QUICK_REPLY', text: 'Reschedule Slot', payload: 'RESCHEDULE' }
    ],
    status: 'APPROVED'
  },
  {
    id: 'tmpl-2',
    name: 'digital_prescription_ready',
    category: 'PRESCRIPTION_DELIVERY',
    language: 'English (en_US)',
    headerText: '📄 Digital Rx Ready - Lumera Health',
    bodyText: 'Dear {{1}},\n\nYour digital prescription from {{2}} has been generated successfully.\n\n📋 Rx No: *{{3}}*\n💊 Medications: {{4}} items\n🗓️ Follow-up: *{{5}}*\n\nTap the button below to view or print your digital prescription anytime.',
    footerText: 'Valid under NHA Telemedicine Guidelines',
    buttons: [
      { type: 'URL', text: 'View Digital Rx PDF', payload: 'https://lumera.health/rx/{{3}}' },
      { type: 'QUICK_REPLY', text: 'Order Medicines', payload: 'ORDER_MEDS' }
    ],
    status: 'APPROVED'
  },
  {
    id: 'tmpl-3',
    name: 'invoice_payment_link',
    category: 'INVOICE_PAY_LINK',
    language: 'English (en_US)',
    headerText: '💳 Bill & Payment Request',
    bodyText: 'Dear {{1}},\n\nInvoice *{{2}}* for {{3}} has been generated for total amount *₹{{4}}*.\n\nYou can pay securely via UPI, Cards, or NetBanking using the link below.',
    footerText: 'Instant GST Receipt provided on payment',
    buttons: [
      { type: 'URL', text: 'Pay ₹{{4}} via UPI/Card', payload: 'https://lumera.health/pay/{{2}}' }
    ],
    status: 'APPROVED'
  },
  {
    id: 'tmpl-4',
    name: 'medication_adherence_checkin',
    category: 'FOLLOWUP_CHECK',
    language: 'English (en_US)',
    headerText: '💊 Daily Medication Check-in',
    bodyText: 'Hi {{1}},\n\nThis is your automated health buddy from Lumera Clinic. Did you take your prescribed medicines today?\n\n1. Morning dose\n2. Afternoon dose\n3. Night dose',
    footerText: 'Lumera Patient Adherence Program',
    buttons: [
      { type: 'QUICK_REPLY', text: '✅ All Taken', payload: 'MEDS_TAKEN' },
      { type: 'QUICK_REPLY', text: '⚠️ Experiencing Side Effect', payload: 'SIDE_EFFECT' }
    ],
    status: 'APPROVED'
  }
];

export const MOCK_DOCTORS = DEFAULT_DOCTORS;
export const MOCK_PATIENTS = DEFAULT_PATIENTS;
export const MOCK_APPOINTMENTS = DEFAULT_APPOINTMENTS;

export const MOCK_LAB_REPORTS: LabReportRecord[] = [
  {
    id: 'lab-rep-101',
    patientId: 'pat-1',
    uhid: 'LUM-2026-0101',
    patientName: 'Sunita Roy',
    date: '2026-08-25',
    labName: 'Lumera Clinical Pathology & Biochemistry Lab',
    category: 'Metabolic & Diabetes',
    egfrMlMin: 54,
    renalDoseAlerts: [
      'eGFR = 54 mL/min (Mild-to-Moderate Renal Impairment Stage 3a)',
      'Metformin dose should not exceed 1000 mg/day; monitor Serum Creatinine every 3 months'
    ],
    doctorInterpretation: 'Suboptimal glycemic control (HbA1c 8.4%) with early diabetic nephropathy evidence. Serum Creatinine mildly elevated at 1.32 mg/dL. Microalbuminuria positive.',
    results: [
      { param: 'HbA1c (Glycosylated Hemoglobin)', value: 8.4, unit: '%', normalRange: '< 5.7', status: 'High', trendDelta: '+0.5% vs May 2026' },
      { param: 'Fasting Blood Sugar (FBS)', value: 162, unit: 'mg/dL', normalRange: '70 - 99', status: 'High', trendDelta: '+18 mg/dL' },
      { param: 'Post-Prandial Blood Sugar (PPBS)', value: 248, unit: 'mg/dL', normalRange: '< 140', status: 'Critical', trendDelta: '+34 mg/dL' },
      { param: 'Serum Creatinine', value: 1.32, unit: 'mg/dL', normalRange: '0.6 - 1.1', status: 'High', trendDelta: '+0.18 mg/dL' },
      { param: 'Estimated GFR (CKD-EPI)', value: 54, unit: 'mL/min/1.73m²', normalRange: '> 90', status: 'Low', trendDelta: '-8 mL/min' },
      { param: 'Blood Urea Nitrogen (BUN)', value: 24, unit: 'mg/dL', normalRange: '7 - 20', status: 'High', trendDelta: '+4 mg/dL' },
      { param: 'Total Cholesterol', value: 218, unit: 'mg/dL', normalRange: '< 200', status: 'High', trendDelta: '-12 mg/dL' },
      { param: 'LDL Cholesterol', value: 138, unit: 'mg/dL', normalRange: '< 100', status: 'High', trendDelta: '-8 mg/dL' },
      { param: 'HDL Cholesterol', value: 42, unit: 'mg/dL', normalRange: '> 50', status: 'Low', trendDelta: '+2 mg/dL' },
      { param: 'Triglycerides', value: 190, unit: 'mg/dL', normalRange: '< 150', status: 'High', trendDelta: '-20 mg/dL' }
    ]
  },
  {
    id: 'lab-rep-102',
    patientId: 'pat-6',
    uhid: 'LUM-2026-0106',
    patientName: 'Rajiv Saxena',
    date: '2026-08-28',
    labName: 'Lumera Clinical Pathology & Radiology Services',
    category: 'Renal & Electrolytes',
    egfrMlMin: 98,
    results: [
      { param: 'Serum Uric Acid', value: 7.8, unit: 'mg/dL', normalRange: '3.5 - 7.2', status: 'High', trendDelta: '+0.6 mg/dL' },
      { param: 'Serum 25-OH Vitamin D3', value: 14.2, unit: 'ng/mL', normalRange: '30 - 100', status: 'Low', trendDelta: '-2.1 ng/mL (Severe Deficiency)' },
      { param: 'Serum Vitamin B12', value: 180, unit: 'pg/mL', normalRange: '211 - 911', status: 'Low', trendDelta: '-35 pg/mL' },
      { param: 'C-Reactive Protein (High Sensitivity hs-CRP)', value: 4.8, unit: 'mg/L', normalRange: '< 1.0', status: 'High', trendDelta: 'Systemic low-grade spinal inflammation' },
      { param: 'Serum Calcium', value: 9.2, unit: 'mg/dL', normalRange: '8.8 - 10.2', status: 'Normal', trendDelta: 'Normal' },
      { param: 'Serum Creatinine', value: 0.92, unit: 'mg/dL', normalRange: '0.7 - 1.3', status: 'Normal', trendDelta: 'Stable' }
    ],
    doctorInterpretation: 'Severe Vitamin D3 & B12 deficiencies contributing to chronic radicular muscle fatigue and delayed nerve regeneration. Mild hyperuricemia.'
  },
  {
    id: 'lab-rep-103',
    patientId: 'pat-7',
    uhid: 'LUM-2026-0107',
    patientName: 'Priyanka Mukherjee',
    date: '2026-08-27',
    labName: 'Lumera Diagnostic Center',
    category: 'Complete Blood Count',
    egfrMlMin: 88,
    results: [
      { param: 'Hemoglobin (Hb)', value: 11.2, unit: 'g/dL', normalRange: '12.0 - 15.5', status: 'Low', trendDelta: '+0.4 g/dL' },
      { param: 'Erythrocyte Sedimentation Rate (ESR)', value: 38, unit: 'mm/1st hr', normalRange: '< 20', status: 'High', trendDelta: 'Active capsular inflammation' },
      { param: 'HbA1c', value: 7.2, unit: '%', normalRange: '< 5.7', status: 'High', trendDelta: 'Fair diabetic control' },
      { param: 'Total Leukocyte Count (TLC)', value: 7400, unit: '/cumm', normalRange: '4000 - 11000', status: 'Normal' },
      { param: 'Platelet Count', value: 2.8, unit: 'Lakhs/cumm', normalRange: '1.5 - 4.5', status: 'Normal' },
      { param: 'Thyroid Stimulating Hormone (TSH)', value: 2.84, unit: 'uIU/mL', normalRange: '0.4 - 4.5', status: 'Normal' }
    ],
    doctorInterpretation: 'Mild microcytic hypochromic anemia with elevated ESR consistent with inflammatory stage II adhesive capsulitis.'
  }
];

export const MOCK_THERAPY_PACKAGES: TherapyPackage[] = [
  {
    id: 'pkg-1',
    patientId: 'pat-6',
    uhid: 'LUM-2026-0106',
    patientName: 'Rajiv Saxena',
    packageName: '10-Session Lumbar Spine Decompression & Dry Needling Rehab Pack',
    department: 'Physiotherapy & Rehabilitation',
    totalSessions: 10,
    completedSessions: 4,
    cost: 6000,
    paidAmount: 6000,
    status: 'Active',
    startDate: '2026-08-20',
    sessionsLog: [
      {
        sessionNumber: 1,
        date: '2026-08-20',
        therapistName: 'Dr. Siddharth Varma (PT)',
        vasScore: 9,
        romDegreeSnapshot: 25,
        proceduresDone: ['Lumbar IFT 4-pole', 'Cold Laser', 'Initial McKenzie Extension'],
        notes: 'Severe antalgic list, SLR positive at 35°. Patient struggled to lie flat.'
      },
      {
        sessionNumber: 2,
        date: '2026-08-23',
        therapistName: 'Dr. Siddharth Varma (PT)',
        vasScore: 8,
        romDegreeSnapshot: 32,
        proceduresDone: ['Trigger Point Dry Needling (Piriformis)', 'IFT', 'Pelvic Neutral Activation'],
        notes: 'Piriformis twitch obtained. Post-session nerve pain reduced from foot to calf.'
      },
      {
        sessionNumber: 3,
        date: '2026-08-26',
        therapistName: 'Dr. Siddharth Varma (PT)',
        vasScore: 6,
        romDegreeSnapshot: 45,
        proceduresDone: ['Computerized Traction (22kg)', 'Multifidus Dry Needling', 'Core Bird-Dog'],
        notes: 'Significant centralization noted. Patient able to sit for 30 minutes without pain.'
      },
      {
        sessionNumber: 4,
        date: '2026-08-30',
        therapistName: 'Dr. Siddharth Varma (PT)',
        vasScore: 4,
        romDegreeSnapshot: 60,
        proceduresDone: ['Maitland Lumbar Mobilization Grade III', 'Class IV Laser', 'Theraband Core Bridge'],
        notes: 'SLR improved to 65°. Minimal tingling in foot remaining. Posture visibly upright.'
      }
    ]
  },
  {
    id: 'pkg-2',
    patientId: 'pat-7',
    uhid: 'LUM-2026-0107',
    patientName: 'Priyanka Mukherjee',
    packageName: '8-Session Shoulder Capsular Mobilization & Laser Therapy Protocol',
    department: 'Physiotherapy & Rehabilitation',
    totalSessions: 8,
    completedSessions: 3,
    cost: 5200,
    paidAmount: 5200,
    status: 'Active',
    startDate: '2026-08-22',
    sessionsLog: [
      {
        sessionNumber: 1,
        date: '2026-08-22',
        therapistName: 'Dr. Siddharth Varma (PT)',
        vasScore: 8,
        romDegreeSnapshot: 60,
        proceduresDone: ['Moist Heat Pack', 'Dry Needling (Trapezius)', 'Codman Pendulum'],
        notes: 'Severe nocturnal throbbing pain. Abduction limited to 60°.'
      },
      {
        sessionNumber: 2,
        date: '2026-08-25',
        therapistName: 'Dr. Siddharth Varma (PT)',
        vasScore: 6,
        romDegreeSnapshot: 75,
        proceduresDone: ['Class IV High Power Laser', 'Maitland Grade II Distraction Glide', 'Finger Ladder'],
        notes: 'Night awakenings decreased from 4 times to 1 time. Abduction improved to 75°.'
      },
      {
        sessionNumber: 3,
        date: '2026-08-29',
        therapistName: 'Dr. Siddharth Varma (PT)',
        vasScore: 5,
        romDegreeSnapshot: 95,
        proceduresDone: ['Maitland Grade III Posterior Glide', 'IASTM Scapular Release', 'Theraband ER'],
        notes: 'Abduction achieved 95°. Forward elevation reached 115°. Independent combing hair achieved.'
      }
    ]
  },
  {
    id: 'pkg-3',
    patientId: 'pat-5',
    uhid: 'LUM-2026-0105',
    patientName: 'Kavita Menon',
    packageName: '9-Month Complete Antenatal & High-Risk Obstetric Care Package',
    department: 'Gynecology',
    totalSessions: 9,
    completedSessions: 4,
    cost: 14000,
    paidAmount: 14000,
    status: 'Active',
    startDate: '2026-05-10',
    sessionsLog: [
      { sessionNumber: 1, date: '2026-05-10', therapistName: 'Dr. Shalini Mukhopadhyay', vasScore: 0, proceduresDone: ['Dating Ultrasound', 'Antenatal Blood Panel'], notes: 'Single viable IUP at 7 weeks. CRL 12mm.' },
      { sessionNumber: 2, date: '2026-06-18', therapistName: 'Dr. Shalini Mukhopadhyay', vasScore: 0, proceduresDone: ['NT Scan', 'Dual Marker Screen'], notes: 'NT 1.3mm, Low risk for Trisomy 21/18/13.' },
      { sessionNumber: 3, date: '2026-07-24', therapistName: 'Dr. Shalini Mukhopadhyay', vasScore: 0, proceduresDone: ['TIFFA Level II Scan', 'Tdap Dose 1'], notes: 'Detailed anomaly scan normal. Adequate liquor volume (AFI 14cm).' },
      { sessionNumber: 4, date: '2026-08-28', therapistName: 'Dr. Shalini Mukhopadhyay', vasScore: 0, proceduresDone: ['Growth Check', 'Hb & OGTT Test Ordered'], notes: 'Fundal height 24cm, FHR 144 bpm. Active fetal kicks reported.' }
    ]
  }
];

export const MOCK_PHARMACY_BATCHES: PharmacyBatchItem[] = [
  {
    id: 'batch-1',
    drugName: 'Paracetamol 650 mg (Dolo 650)',
    composition: 'Paracetamol 650mg',
    batchNumber: 'DL-2026-981',
    expiryDate: '2027-11',
    daysToExpiry: 445,
    currentStock: 480,
    reorderLevel: 100,
    unitPrice: 1.8,
    mrp: 32.0,
    status: 'Normal'
  },
  {
    id: 'batch-2',
    drugName: 'Aceclofenac + Serratiopeptidase (Zerodol-SP)',
    composition: 'Aceclofenac 100mg + Paracetamol 325mg + Serratiopeptidase 15mg',
    batchNumber: 'ZSP-26-441',
    expiryDate: '2026-09',
    daysToExpiry: 22,
    currentStock: 42,
    reorderLevel: 50,
    unitPrice: 8.5,
    mrp: 115.0,
    status: 'Near Expiry'
  },
  {
    id: 'batch-3',
    drugName: 'Amoxicillin + Clavulanate 625 mg (Augmentin 625)',
    composition: 'Amoxicillin 500mg + Clavulanic Acid 125mg',
    batchNumber: 'AUG-26-802',
    expiryDate: '2026-10',
    daysToExpiry: 48,
    currentStock: 18,
    reorderLevel: 40,
    unitPrice: 16.0,
    mrp: 204.0,
    status: 'Low Stock'
  },
  {
    id: 'batch-4',
    drugName: 'Carboxymethylcellulose 0.5% Eye Drops (Refresh Tears)',
    composition: 'Carboxymethylcellulose Sodium 0.5% w/v',
    batchNumber: 'RT-2026-119',
    expiryDate: '2027-08',
    daysToExpiry: 350,
    currentStock: 65,
    reorderLevel: 25,
    unitPrice: 110.0,
    mrp: 165.0,
    status: 'Normal'
  },
  {
    id: 'batch-5',
    drugName: 'Ferrous Ascorbate + Folic Acid (Orofer-XT)',
    composition: 'Elemental Iron 100mg + Folic Acid 1.5mg',
    batchNumber: 'OXT-25-990',
    expiryDate: '2026-08',
    daysToExpiry: -2,
    currentStock: 12,
    reorderLevel: 30,
    unitPrice: 9.2,
    mrp: 175.0,
    status: 'Expired'
  },
  {
    id: 'batch-6',
    drugName: 'Metformin 500 mg SR (Glycomet 500 SR)',
    composition: 'Metformin Hydrochloride 500mg SR',
    batchNumber: 'GLY-26-301',
    expiryDate: '2028-02',
    daysToExpiry: 535,
    currentStock: 350,
    reorderLevel: 80,
    unitPrice: 2.2,
    mrp: 45.0,
    status: 'Normal'
  }
];



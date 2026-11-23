import type { SqlDatabase } from "./sql-engine.ts";
import { clinicCalendarDate, shiftIsoDate } from "../src/lib/clinicDay.ts";
import { allocateTokenNumber } from "./queue-tokens.ts";
import { ensureImmunizationSchema } from "./immunization-schema.ts";

interface SeedPatientSpec {
  id: string;
  tenantId: string;
  uhid: string;
  name: string;
  age: number;
  dobOffsetDays?: number;
  dateOfBirth?: string;
  gender: "Female" | "Male" | "Other";
  phone: string;
  email: string;
  bloodGroup: string;
  allergies: string[];
  chronicConditions: string[];
  address: string;
  emergencyContact?: string;
}

interface SeedRxSpec {
  id: string;
  rxNumber: string;
  tenantId: string;
  patientId: string;
  doctorId: string;
  doctorName: string;
  doctorSpecialty: string;
  doctorRegNumber: string;
  diagnosis: string;
  icd10Code: string;
  chiefComplaints: string[];
  vitals: Record<string, unknown>;
  medicines: Array<Record<string, unknown>>;
  labTests?: Array<Record<string, unknown>>;
  advice: string[];
  specialtyType: string;
  modules: Record<string, unknown>;
}

interface SeedLabSpec {
  id: string;
  tenantId: string;
  patientId: string;
  uhid: string;
  patientName: string;
  labName: string;
  category: string;
  interpretation: string;
  results: Array<{
    param: string;
    value: number | string;
    unit: string;
    normalRange: string;
    status: "Normal" | "Low" | "High" | "Critical";
  }>;
}

function defaultVitals(overrides: Record<string, unknown> = {}, recordedAt = "2026-11-18T09:30:00.000Z") {
  return {
    bloodPressureSystolic: 122,
    bloodPressureDiastolic: 78,
    heartRate: 76,
    temperature: 98.4,
    spO2: 99,
    weightKg: 64,
    heightCm: 162,
    bmi: 24.4,
    recordedAt,
    recordedBy: "OPD Nurse Desk",
    ...overrides,
  };
}

function med(
  id: string,
  drugName: string,
  composition: string,
  dosage: string,
  frequency = "1-0-1",
  durationDays = 10,
  form = "Tablet",
  timing = "After Food",
  instructions = ""
) {
  return { id, drugName, composition, dosage, form, frequency, timing, durationDays, instructions };
}

function buildPolyclinicSpecialtyRoster(today: string): {
  patients: SeedPatientSpec[];
  visits: Array<{
    id: string;
    patientId: string;
    doctorId: string;
    doctorName: string;
    specialty: string;
    fee: number;
    dayOffset: number;
    slot: string;
    type: string;
    status: "Waiting" | "Confirmed" | "Completed";
    vitals: Record<string, unknown>;
  }>;
  prescriptions: SeedRxSpec[];
  labs: SeedLabSpec[];
} {
  const tenantId = "tenant-demo-polyclinic";
  const lmp26w = shiftIsoDate(today, -185);
  const edd26w = shiftIsoDate(lmp26w, 280);
  const lmp12w = shiftIsoDate(today, -88);
  const edd12w = shiftIsoDate(lmp12w, 280);
  const lmp35w = shiftIsoDate(today, -247);
  const edd35w = shiftIsoDate(lmp35w, 280);

  const patients: SeedPatientSpec[] = [
    // --- GYNAECOLOGY (7 patients for gynecology@lumera.me / doc-persona-gynae) ---
    {
      id: "poly-pat-nisha",
      tenantId,
      uhid: "LUM-POLY-2203",
      name: "Nisha Kulkarni",
      age: 34,
      dateOfBirth: "1992-04-14",
      gender: "Female",
      phone: "+91 98111 22003",
      email: "nisha.kulkarni@demo.lumera.in",
      bloodGroup: "B+",
      allergies: ["Sulfa Drugs"],
      chronicConditions: ["G2P1L1A0 — 26w ANC", "Gestational Diabetes (DIPSI 156)", "Previous LSCS (2022)"],
      address: "B-402 Indiranagar, Bengaluru 560038",
    },
    {
      id: "gynae-pat-kavya",
      tenantId,
      uhid: "LUM-GYN-2301",
      name: "Kavya Chatterjee",
      age: 24,
      dateOfBirth: "2002-07-19",
      gender: "Female",
      phone: "+91 98111 23001",
      email: "kavya.chatterjee@demo.lumera.in",
      bloodGroup: "O+",
      allergies: [],
      chronicConditions: ["PCOS (Rotterdam Phenotype A)", "Letrozole CD12 Follicular Study", "Insulin Resistance"],
      address: "Salt Lake Sector II, Kolkata 700091",
    },
    {
      id: "gynae-pat-rekha",
      tenantId,
      uhid: "LUM-GYN-2302",
      name: "Rekha Deshpande",
      age: 42,
      dateOfBirth: "1984-02-08",
      gender: "Female",
      phone: "+91 98111 23002",
      email: "rekha.deshpande@demo.lumera.in",
      bloodGroup: "A+",
      allergies: ["Ibuprofen"],
      chronicConditions: ["AUB-L (Submucosal Fibroid)", "Moderate Iron Deficiency Anemia (Hb 8.9)"],
      address: "Kothrud, Pune 411038",
    },
    {
      id: "gynae-pat-pooja",
      tenantId,
      uhid: "LUM-GYN-2303",
      name: "Pooja Agarwal",
      age: 28,
      dateOfBirth: "1998-09-25",
      gender: "Female",
      phone: "+91 98111 23003",
      email: "pooja.agarwal@demo.lumera.in",
      bloodGroup: "O-",
      allergies: [],
      chronicConditions: ["Primigravida G1P0 — 12w ANC", "Subclinical Hypothyroidism", "Rh Negative Mother"],
      address: "Malviya Nagar, Jaipur 302017",
    },
    {
      id: "gynae-pat-savita",
      tenantId,
      uhid: "LUM-GYN-2304",
      name: "Savita Joshi",
      age: 49,
      dateOfBirth: "1977-06-11",
      gender: "Female",
      phone: "+91 98111 23004",
      email: "savita.joshi@demo.lumera.in",
      bloodGroup: "AB+",
      allergies: [],
      chronicConditions: ["Perimenopausal Vasomotor Symptoms", "Osteopenia"],
      address: "Vashi Sector 17, Navi Mumbai 400703",
    },
    {
      id: "gynae-pat-anjali",
      tenantId,
      uhid: "LUM-GYN-2305",
      name: "Anjali Verma",
      age: 29,
      dateOfBirth: "1997-03-14",
      gender: "Female",
      phone: "+91 98111 23005",
      email: "anjali.verma@demo.lumera.in",
      bloodGroup: "B+",
      allergies: [],
      chronicConditions: ["Primigravida G1P0 — 35w ANC", "Mild Gestational Hypertension (PIH)", "NST Surveillance"],
      address: "powai Hiranandani Gardens, Mumbai 400076",
    },
    {
      id: "gynae-pat-sneha",
      tenantId,
      uhid: "LUM-GYN-2306",
      name: "Sneha Banerjee",
      age: 31,
      dateOfBirth: "1995-10-06",
      gender: "Female",
      phone: "+91 98111 23006",
      email: "sneha.banerjee@demo.lumera.in",
      bloodGroup: "O+",
      allergies: [],
      chronicConditions: ["Postnatal Day-10 Post-FTLSCS", "Lactation & Scar Care (42d PNC)"],
      address: "New Town Action Area I, Kolkata 700156",
    },

    // --- PEDIATRICS (5 patients for pediatrics@lumera.me / doc-persona-pedia) ---
    {
      id: "poly-pat-arjun",
      tenantId,
      uhid: "LUM-POLY-2204",
      name: "Arjun Bose",
      age: 8,
      dobOffsetDays: -2980,
      gender: "Male",
      phone: "+91 98111 22004",
      email: "parent.arjun@demo.lumera.in",
      bloodGroup: "B+",
      allergies: ["Dust Mites"],
      chronicConditions: ["Episodic Viral-Triggered Wheeze"],
      address: "Ballygunge Place, Kolkata 700019",
      emergencyContact: "Subhash Bose (Father) +91 98111 22004",
    },
    {
      id: "pedia-pat-aadhya",
      tenantId,
      uhid: "LUM-PED-2401",
      name: "Aadhya Sharma",
      age: 1,
      dobOffsetDays: -285,
      gender: "Female",
      phone: "+91 98111 24001",
      email: "parent.aadhya@demo.lumera.in",
      bloodGroup: "O+",
      allergies: [],
      chronicConditions: ["9-Month Well-Baby MMR-1 & IYCF Review"],
      address: "Koramangala 4th Block, Bengaluru 560034",
      emergencyContact: "Neha Sharma (Mother) +91 98111 24001",
    },
    {
      id: "pedia-pat-vihaan",
      tenantId,
      uhid: "LUM-PED-2402",
      name: "Vihaan Nair",
      age: 3,
      dobOffsetDays: -1140,
      gender: "Male",
      phone: "+91 98111 24002",
      email: "parent.vihaan@demo.lumera.in",
      bloodGroup: "A+",
      allergies: [],
      chronicConditions: ["Acute Viral Gastroenteritis — ORS + Zinc"],
      address: "Panampilly Nagar, Kochi 682036",
      emergencyContact: "Deepa Nair (Mother) +91 98111 24002",
    },
    {
      id: "pedia-pat-diya",
      tenantId,
      uhid: "LUM-PED-2403",
      name: "Diya Kulkarni",
      age: 5,
      dobOffsetDays: -1860,
      gender: "Female",
      phone: "+91 98111 24003",
      email: "parent.diya@demo.lumera.in",
      bloodGroup: "B+",
      allergies: [],
      chronicConditions: ["School-Entry DPT/MMR Booster & Mild Nutritional Anemia"],
      address: "Aundh, Pune 411007",
      emergencyContact: "Amit Kulkarni (Father) +91 98111 24003",
    },
    {
      id: "pedia-pat-reyansh",
      tenantId,
      uhid: "LUM-PED-2404",
      name: "Reyansh Gupta",
      age: 11,
      dobOffsetDays: -4050,
      gender: "Male",
      phone: "+91 98111 24004",
      email: "parent.reyansh@demo.lumera.in",
      bloodGroup: "AB+",
      allergies: ["Penicillin Rash"],
      chronicConditions: ["Recurrent Acute Tonsillopharyngitis"],
      address: "Gomti Nagar, Lucknow 226010",
      emergencyContact: "Sanjay Gupta (Father) +91 98111 24004",
    },

    // --- CARDIOLOGY (5 patients for cardiology@lumera.me / doc-persona-cardio) ---
    {
      id: "poly-pat-kavita",
      tenantId,
      uhid: "LUM-POLY-2201",
      name: "Kavita Rao",
      age: 46,
      dateOfBirth: "1980-03-18",
      gender: "Female",
      phone: "+91 98111 22001",
      email: "kavita.rao@demo.lumera.in",
      bloodGroup: "A+",
      allergies: [],
      chronicConditions: ["Stage II Hypertension", "Dyslipidemia"],
      address: "Jayanagar 7th Block, Bengaluru 560070",
    },
    {
      id: "cardio-pat-mahesh",
      tenantId,
      uhid: "LUM-CRD-2501",
      name: "Mahesh Venkataraman",
      age: 58,
      dateOfBirth: "1968-11-04",
      gender: "Male",
      phone: "+91 98111 25001",
      email: "mahesh.v@demo.lumera.in",
      bloodGroup: "O+",
      allergies: [],
      chronicConditions: ["Post-PTCA Proximal LAD DES (2025)", "Type 2 Diabetes", "On DAPT"],
      address: "Adyar, Chennai 600020",
    },
    {
      id: "cardio-pat-harbans",
      tenantId,
      uhid: "LUM-CRD-2502",
      name: "Harbans Singh Gill",
      age: 64,
      dateOfBirth: "1962-05-22",
      gender: "Male",
      phone: "+91 98111 25002",
      email: "harbans.gill@demo.lumera.in",
      bloodGroup: "B+",
      allergies: ["ACE Inhibitor Cough"],
      chronicConditions: ["Chronic HFrEF (LVEF 38%)", "NYHA Class II", "Ischemic Cardiomyopathy"],
      address: "Model Town, Ludhiana 141002",
    },
    {
      id: "cardio-pat-lalitha",
      tenantId,
      uhid: "LUM-CRD-2503",
      name: "Lalitha Subramanian",
      age: 67,
      dateOfBirth: "1959-08-30",
      gender: "Female",
      phone: "+91 98111 25003",
      email: "lalitha.s@demo.lumera.in",
      bloodGroup: "O+",
      allergies: [],
      chronicConditions: ["Paroxysmal Atrial Fibrillation", "CHA2DS2-VASc 4 — Apixaban"],
      address: "Mylapore, Chennai 600004",
    },
    {
      id: "cardio-pat-prakash",
      tenantId,
      uhid: "LUM-CRD-2504",
      name: "Prakash Mehta",
      age: 49,
      dateOfBirth: "1977-01-15",
      gender: "Male",
      phone: "+91 98111 25004",
      email: "prakash.mehta@demo.lumera.in",
      bloodGroup: "AB+",
      allergies: [],
      chronicConditions: ["Exertional Stable Angina", "Premature Family CAD History"],
      address: "Navrangpura, Ahmedabad 380009",
    },

    // --- DERMATOLOGY (5 patients for dermatology@lumera.me / doc-persona-derma) ---
    {
      id: "poly-pat-suresh",
      tenantId,
      uhid: "LUM-POLY-2202",
      name: "Suresh Iyer",
      age: 52,
      dateOfBirth: "1974-09-10",
      gender: "Male",
      phone: "+91 98111 22002",
      email: "suresh.iyer@demo.lumera.in",
      bloodGroup: "O+",
      allergies: [],
      chronicConditions: ["Chronic Plaque Psoriasis"],
      address: "Malleshwaram, Bengaluru 560003",
    },
    {
      id: "derma-pat-ritika",
      tenantId,
      uhid: "LUM-DRM-2601",
      name: "Ritika Malhotra",
      age: 22,
      dateOfBirth: "2004-03-27",
      gender: "Female",
      phone: "+91 98111 26001",
      email: "ritika.m@demo.lumera.in",
      bloodGroup: "B+",
      allergies: [],
      chronicConditions: ["Grade III Inflammatory Facial Acne", "Post-Acne Hyperpigmentation"],
      address: "Greater Kailash, New Delhi 110048",
    },
    {
      id: "derma-pat-ravi",
      tenantId,
      uhid: "LUM-DRM-2602",
      name: "Ravi Shankar Verma",
      age: 35,
      dateOfBirth: "1991-07-09",
      gender: "Male",
      phone: "+91 98111 26002",
      email: "ravi.verma@demo.lumera.in",
      bloodGroup: "A+",
      allergies: [],
      chronicConditions: ["Recalcitrant Tinea Cruris & Corporis", "Prior OTC Steroid Cream Misuse"],
      address: "Sigra, Varanasi 221010",
    },
    {
      id: "derma-pat-shabana",
      tenantId,
      uhid: "LUM-DRM-2603",
      name: "Shabana Begum",
      age: 37,
      dateOfBirth: "1989-12-12",
      gender: "Female",
      phone: "+91 98111 26003",
      email: "shabana.b@demo.lumera.in",
      bloodGroup: "O+",
      allergies: ["PPD Hair Dye"],
      chronicConditions: ["Centrofacial Melasma (Fitzpatrick IV)"],
      address: "Banjara Hills, Hyderabad 500034",
    },
    {
      id: "derma-pat-nikhil",
      tenantId,
      uhid: "LUM-DRM-2604",
      name: "Nikhil Hegde",
      age: 29,
      dateOfBirth: "1997-04-03",
      gender: "Male",
      phone: "+91 98111 26004",
      email: "nikhil.hegde@demo.lumera.in",
      bloodGroup: "B-",
      allergies: ["Shellfish"],
      chronicConditions: ["Chronic Spontaneous Urticaria", "Allergic Rhinitis Atopy"],
      address: "Whitefield, Bengaluru 560066",
    },

    // --- ORTHOPEDICS (5 patients for orthopedics@lumera.me / doc-persona-ortho) ---
    {
      id: "poly-pat-farah",
      tenantId,
      uhid: "LUM-POLY-2205",
      name: "Farah Khan",
      age: 61,
      dateOfBirth: "1965-02-19",
      gender: "Female",
      phone: "+91 98111 22005",
      email: "farah.khan@demo.lumera.in",
      bloodGroup: "A+",
      allergies: [],
      chronicConditions: ["Bilateral Knee Osteoarthritis (KL Grade III)", "Vitamin D Deficiency"],
      address: "Bandra West, Mumbai 400050",
    },
    {
      id: "ortho-pat-sandeep",
      tenantId,
      uhid: "LUM-ORT-2701",
      name: "Sandeep Chavan",
      age: 39,
      dateOfBirth: "1987-08-14",
      gender: "Male",
      phone: "+91 98111 27001",
      email: "sandeep.c@demo.lumera.in",
      bloodGroup: "O+",
      allergies: [],
      chronicConditions: ["L4-L5 Lumbar Disc Prolapse with Right Sciatica"],
      address: "Thane West, Maharashtra 400602",
    },
    {
      id: "ortho-pat-kamala",
      tenantId,
      uhid: "LUM-ORT-2702",
      name: "Kamala Devi Pillai",
      age: 66,
      dateOfBirth: "1960-10-05",
      gender: "Female",
      phone: "+91 98111 27002",
      email: "kamala.pillai@demo.lumera.in",
      bloodGroup: "B+",
      allergies: ["Tramadol Nausea"],
      chronicConditions: ["Left Distal Radius Colles Fracture (In Slab)", "Postmenopausal Osteoporosis"],
      address: "Kowdiar, Thiruvananthapuram 695003",
    },
    {
      id: "ortho-pat-varun",
      tenantId,
      uhid: "LUM-ORT-2703",
      name: "Varun Gill",
      age: 27,
      dateOfBirth: "1999-01-28",
      gender: "Male",
      phone: "+91 98111 27003",
      email: "varun.gill@demo.lumera.in",
      bloodGroup: "AB+",
      allergies: [],
      chronicConditions: ["RightLateral Ankle ATFL Grade II Sprain (Sports)"],
      address: "Sector 15, Chandigarh 160015",
    },
    {
      id: "ortho-pat-meenakshi",
      tenantId,
      uhid: "LUM-ORT-2704",
      name: "Meenakshi Sundaram",
      age: 54,
      dateOfBirth: "1972-06-21",
      gender: "Male",
      phone: "+91 98111 27004",
      email: "meenakshi.s@demo.lumera.in",
      bloodGroup: "O+",
      allergies: [],
      chronicConditions: ["Right Supraspinatus Tendinopathy & Periarthritis Shoulder", "Type 2 Diabetes"],
      address: "Anna Nagar, Madurai 625020",
    },

    // --- ENT (5 patients for ent@lumera.me / doc-persona-ent) ---
    {
      id: "ent-pat-deepak",
      tenantId,
      uhid: "LUM-ENT-2801",
      name: "Deepak Mishra",
      age: 31,
      dateOfBirth: "1995-05-12",
      gender: "Male",
      phone: "+91 98111 28001",
      email: "deepak.mishra@demo.lumera.in",
      bloodGroup: "B+",
      allergies: [],
      chronicConditions: ["Right Tubotympanic CSOM (Active Mucosal)"],
      address: "Hazratganj, Lucknow 226001",
    },
    {
      id: "ent-pat-shruti",
      tenantId,
      uhid: "LUM-ENT-2802",
      name: "Shruti Gokhale",
      age: 26,
      dateOfBirth: "2000-11-17",
      gender: "Female",
      phone: "+91 98111 28002",
      email: "shruti.g@demo.lumera.in",
      bloodGroup: "O+",
      allergies: ["Pollen", "House Dust"],
      chronicConditions: ["Persistent Allergic Rhinitis", "Deviated Nasal Septum (Left)"],
      address: "Shivajinagar, Pune 411005",
    },
    {
      id: "ent-pat-manoj",
      tenantId,
      uhid: "LUM-ENT-2803",
      name: "Manoj Tiwari",
      age: 43,
      dateOfBirth: "1983-03-08",
      gender: "Male",
      phone: "+91 98111 28003",
      email: "manoj.tiwari@demo.lumera.in",
      bloodGroup: "A+",
      allergies: [],
      chronicConditions: ["Grade II Oral Submucous Fibrosis (OSMF)", "Areca Nut Cessation"],
      address: "Civil Lines, Prayagraj 211001",
    },
    {
      id: "ent-pat-padma",
      tenantId,
      uhid: "LUM-ENT-2804",
      name: "Padma Narayanan",
      age: 57,
      dateOfBirth: "1969-07-24",
      gender: "Female",
      phone: "+91 98111 28004",
      email: "padma.n@demo.lumera.in",
      bloodGroup: "O+",
      allergies: [],
      chronicConditions: ["Right Posterior Canal BPPV (Positional Vertigo)"],
      address: "T. Nagar, Chennai 600017",
    },
    {
      id: "ent-pat-aarav",
      tenantId,
      uhid: "LUM-ENT-2805",
      name: "Aarav Sengupta",
      age: 14,
      dateOfBirth: "2012-09-02",
      gender: "Male",
      phone: "+91 98111 28005",
      email: "parent.aaravs@demo.lumera.in",
      bloodGroup: "B+",
      allergies: [],
      chronicConditions: ["Chronic Hypertrophic Adenotonsillitis (Grade III)"],
      address: "New Alipore, Kolkata 700053",
    },

    // --- OPHTHALMOLOGY (5 patients for ophthalmology@lumera.me / doc-persona-ophtho) ---
    {
      id: "ophtho-pat-ramesh",
      tenantId,
      uhid: "LUM-OPH-2901",
      name: "Rameshwar Prasad",
      age: 68,
      dateOfBirth: "1958-04-09",
      gender: "Male",
      phone: "+91 98111 29001",
      email: "rameshwar.p@demo.lumera.in",
      bloodGroup: "O+",
      allergies: [],
      chronicConditions: ["Right Eye Immature Senile Nuclear Cataract (NS II)", "Left Eye Pseudophakia (PCIOL)"],
      address: "Boring Road, Patna 800001",
    },
    {
      id: "ophtho-pat-ananya",
      tenantId,
      uhid: "LUM-OPH-2902",
      name: "Ananya Reddy",
      age: 21,
      dateOfBirth: "2005-08-15",
      gender: "Female",
      phone: "+91 98111 29002",
      email: "ananya.reddy@demo.lumera.in",
      bloodGroup: "A+",
      allergies: [],
      chronicConditions: ["Compound Myopic Astigmatism", "Digital Eye Strain"],
      address: "Jubilee Hills, Hyderabad 500033",
    },
    {
      id: "ophtho-pat-gopal",
      tenantId,
      uhid: "LUM-OPH-2903",
      name: "Gopalakrishnan Nair",
      age: 59,
      dateOfBirth: "1967-01-30",
      gender: "Male",
      phone: "+91 98111 29003",
      email: "gopal.nair@demo.lumera.in",
      bloodGroup: "B+",
      allergies: ["Sulfa Eye Drops"],
      chronicConditions: ["Mild Non-Proliferative Diabetic Retinopathy (NPDR)", "T2DM (12 yrs)"],
      address: "Edappally, Kochi 682024",
    },
    {
      id: "ophtho-pat-vasundhara",
      tenantId,
      uhid: "LUM-OPH-2904",
      name: "Vasundhara Devi",
      age: 62,
      dateOfBirth: "1964-11-21",
      gender: "Female",
      phone: "+91 98111 29004",
      email: "vasundhara.d@demo.lumera.in",
      bloodGroup: "AB+",
      allergies: [],
      chronicConditions: ["Primary Open-Angle Glaucoma (POAG — On Latanoprost)"],
      address: "Saraswathipuram, Mysuru 570009",
    },
    {
      id: "ophtho-pat-rohan",
      tenantId,
      uhid: "LUM-OPH-2905",
      name: "Rohan Kulkarni",
      age: 32,
      dateOfBirth: "1994-06-07",
      gender: "Male",
      phone: "+91 98111 29005",
      email: "rohan.k@demo.lumera.in",
      bloodGroup: "O+",
      allergies: [],
      chronicConditions: ["Evaporative Dry Eye Disease (MGD)"],
      address: "Hinjewadi Phase 2, Pune 411057",
    },
  ];

  const doctorMeta = [
    {
      doctorId: "doc-persona-gynae",
      doctorName: "Dr. Shalini Mukhopadhyay",
      regNumber: "WBMC-2011-44910",
      specialty: "Gynecology",
      fee: 800,
      patientIds: [
        "poly-pat-nisha",
        "gynae-pat-kavya",
        "gynae-pat-rekha",
        "gynae-pat-pooja",
        "gynae-pat-savita",
        "gynae-pat-anjali",
        "gynae-pat-sneha",
      ],
    },
    {
      doctorId: "doc-persona-pedia",
      doctorName: "Dr. Ananya Sen",
      regNumber: "WBMC-2016-39482",
      specialty: "Pediatrics",
      fee: 700,
      patientIds: ["poly-pat-arjun", "pedia-pat-aadhya", "pedia-pat-vihaan", "pedia-pat-diya", "pedia-pat-reyansh"],
    },
    {
      doctorId: "doc-persona-cardio",
      doctorName: "Dr. Rajesh Sharma",
      regNumber: "DMC-2008-11928",
      specialty: "Cardiology",
      fee: 1000,
      patientIds: ["poly-pat-kavita", "cardio-pat-mahesh", "cardio-pat-harbans", "cardio-pat-lalitha", "cardio-pat-prakash"],
    },
    {
      doctorId: "doc-persona-derma",
      doctorName: "Dr. Meera Vasudevan",
      regNumber: "KMC-2015-88392",
      specialty: "Dermatology",
      fee: 750,
      patientIds: ["poly-pat-suresh", "derma-pat-ritika", "derma-pat-ravi", "derma-pat-shabana", "derma-pat-nikhil"],
    },
    {
      doctorId: "doc-persona-ortho",
      doctorName: "Dr. Harshvardhan Patel",
      regNumber: "GMC-2010-55421",
      specialty: "Orthopedics",
      fee: 800,
      patientIds: ["poly-pat-farah", "ortho-pat-sandeep", "ortho-pat-kamala", "ortho-pat-varun", "ortho-pat-meenakshi"],
    },
    {
      doctorId: "doc-persona-ent",
      doctorName: "Dr. Naveen Iyer",
      regNumber: "MMC-2014-22011",
      specialty: "ENT",
      fee: 700,
      patientIds: ["ent-pat-deepak", "ent-pat-shruti", "ent-pat-manoj", "ent-pat-padma", "ent-pat-aarav"],
    },
    {
      doctorId: "doc-persona-ophtho",
      doctorName: "Dr. Alok Nath Mukherjee",
      regNumber: "DMC-2009-33211",
      specialty: "Ophthalmology",
      fee: 750,
      patientIds: ["ophtho-pat-ramesh", "ophtho-pat-ananya", "ophtho-pat-gopal", "ophtho-pat-vasundhara", "ophtho-pat-rohan"],
    },
  ];

  const slots = ["09:15 AM", "10:00 AM", "10:45 AM", "11:30 AM", "12:15 PM", "04:15 PM", "05:00 PM"];
  const visits: Array<{
    id: string;
    patientId: string;
    doctorId: string;
    doctorName: string;
    specialty: string;
    fee: number;
    dayOffset: number;
    slot: string;
    type: string;
    status: "Waiting" | "Confirmed" | "Completed";
    vitals: Record<string, unknown>;
  }> = [];

  for (const doc of doctorMeta) {
    doc.patientIds.forEach((pid, idx) => {
      let dayOffset = idx < 3 ? 0 : idx === 3 ? -2 : -5;
      let status: "Waiting" | "Confirmed" | "Completed" = idx < 2 ? "Waiting" : "Completed";
      let visitType = idx % 2 === 0 ? "New Consultation" : "Follow-up";
      if (doc.specialty === "Gynecology") {
        // 5 today's OPD visits across Waiting, Confirmed, and Completed + 2 recent historical visits
        const gynOffsets = [0, 0, -2, 0, -4, 0, 0];
        const gynStatuses: Array<"Waiting" | "Confirmed" | "Completed"> = [
          "Waiting",
          "Confirmed",
          "Completed",
          "Completed",
          "Completed",
          "Waiting",
          "Completed",
        ];
        const gynTypes = [
          "Follow-up",
          "Follow-up",
          "New Consultation",
          "New Consultation",
          "Follow-up",
          "Follow-up",
          "Follow-up",
        ];
        dayOffset = gynOffsets[idx] ?? 0;
        status = gynStatuses[idx] ?? "Waiting";
        visitType = gynTypes[idx] ?? "Follow-up";
      }
      visits.push({
        id: `spec-poly-apt-${doc.specialty.toLowerCase().slice(0, 4)}-${idx + 1}`,
        patientId: pid,
        doctorId: doc.doctorId,
        doctorName: doc.doctorName,
        specialty: doc.specialty,
        fee: doc.fee,
        dayOffset,
        slot: slots[idx % slots.length],
        type: visitType,
        status,
        vitals: defaultVitals(
          doc.specialty === "Pediatrics"
            ? { weightKg: [25, 8.6, 13.8, 17.5, 36][idx], heightCm: [126, 71, 95, 108, 143][idx], bloodPressureSystolic: undefined, bloodPressureDiastolic: undefined }
            : doc.specialty === "Cardiology"
              ? { bloodPressureSystolic: [148, 126, 114, 134, 138][idx], bloodPressureDiastolic: [92, 78, 72, 84, 86][idx], heartRate: [82, 66, 78, 88, 74][idx] }
              : doc.specialty === "Gynecology"
                ? {
                    bloodPressureSystolic: [118, 114, 110, 112, 128, 144, 116][idx],
                    bloodPressureDiastolic: [76, 74, 70, 72, 82, 92, 74][idx],
                    weightKg: [67, 68, 59, 56, 65, 71, 63][idx],
                  }
                : {}
        ),
      });
    });
  }

  const prescriptions: SeedRxSpec[] = [
    // --- 5 GYNAECOLOGY PRESCRIPTIONS ---
    {
      id: "spec-rx-gyn-1",
      rxNumber: "RX-GYN-2026-0101",
      tenantId,
      patientId: "poly-pat-nisha",
      doctorId: "doc-persona-gynae",
      doctorName: "Dr. Shalini Mukhopadhyay",
      doctorSpecialty: "Gynecology",
      doctorRegNumber: "WBMC-2011-44910",
      diagnosis: "G2P1L1A0 at 26w 3d Gestation with GDM (DIPSI 156 mg/dL), Mild Anemia & Previous LSCS",
      icd10Code: "O24.4",
      chiefComplaints: ["Antenatal follow-up at 26 weeks — review of DIPSI OGTT report", "Active fetal kicks perceived"],
      vitals: defaultVitals({ bloodPressureSystolic: 118, bloodPressureDiastolic: 76, weightKg: 67, heightCm: 158, bmi: 26.8, bloodSugarRandom: 138 }),
      medicines: [
        med("m-gyn-1a", "Metformin SR (Glycomet SR 500)", "Metformin 500mg", "500 mg", "0-0-1", 30, "Tablet", "After Food", "For GDM glycemic target (FBS <95, 2h PPBS <120 mg/dL)"),
        med("m-gyn-1b", "Ferrous Ascorbate + Folic Acid (Orofer-XT)", "Elemental Iron 100mg + Folate 1.5mg", "1 Tablet", "1-0-1", 30, "Tablet", "After Food", "Therapeutic BD dosing for Hb 10.6 g/dL; avoid tea/milk for 1 hr"),
        med("m-gyn-1c", "Calcium Carbonate + Vit D3 (Shelcal 500)", "Calcium 500mg + Vit D3 250 IU", "1 Tablet", "0-1-0", 30, "Tablet", "After Food", "Take after lunch (separate from iron by 4 hours)"),
      ],
      labTests: [
        { id: "lt-gyn-1", testName: "Fasting & 2-hr Post-Meal Blood Glucose (SMBG Chart)", category: "Biochemistry", price: 250 },
        { id: "lt-gyn-2", testName: "Growth Scan & Umbilical Artery Doppler (at 32 Weeks)", category: "Radiology", price: 1800 },
      ],
      advice: [
        "Medical Nutrition Therapy (MNT): split into 3 moderate low-GI meals + 3 protein snacks; 20-min post-meal walk",
        "Daily Fetal Kick Count (DFKC): >=10 kicks in 2 hours after meals; sleep in left lateral position",
        "Report immediately if scar tenderness, bleeding/leaking PV, headache, visual blurring, or reduced kicks",
      ],
      specialtyType: "Gynecology",
      modules: {
        historyOfPresentIllness: "34y G2P1L1A0 (prev lower-segment cesarean section in 2022 for fetal distress) at 26w3d gestation. 2-hour 75g DIPSI non-fasting glucose returned 156 mg/dL; Hb 10.6 g/dL. Perceiving good fetal movements; no leaking/bleeding PV or pre-eclamptic symptoms.",
        pastMedicalHistory: "Previous FTLSCS (2022, healthy 3.1 kg boy). No chronic pre-pregnancy hypertension.",
        reviewOfSystems: "No headache, epigastric pain, visual blurring, or dysuria.",
        physicalExamination: "Mild pallor +, no pedal edema. P/A: Uterus 26 wks size, relaxed, Pfannenstiel scar healthy & non-tender, cephalic presentation, FHR 146 bpm regular.",
        riskLevel: "High",
        specialtyHistory: {
          specialty: "Gynecology",
          symptomDuration: "Routine follow-up",
          onsetPattern: "Preventive / Scheduled",
          selectedSymptoms: ["Amenorrhea — Antenatal booking visit"],
          comorbidities: ["Iron Deficiency Anemia"],
          personalSocialHabits: ["Vegetarian Diet", "Non-Smoker & Teetotaller"],
          indiaClinicalFlags: ["Nutritional Iron-Deficiency Anemia screen", "DIPSI 75g GDM risk / Family Hx T2DM", "Prior LSCS scar tenderness check"],
          familyAndConsanguinityHistory: "Mother has Type 2 Diabetes; non-consanguineous marriage",
        },
        gynecologyAssessment: {
          clinicalMode: "Antenatal / Obstetric",
          lmpDate: lmp26w,
          calculatedEdd: edd26w,
          gestationalAgeWeeks: 26,
          gestationalAgeDays: 3,
          trimester: "2nd Trimester",
          gravidaPara: { g: 2, p: 1, l: 1, a: 0 },
          ectopicCount: 0,
          previousDeliveryMode: "Previous 1 LSCS",
          fundalHeightCm: 26,
          fetalHeartRateBpm: 146,
          presentation: "Cephalic / Vertex",
          liquorAdequacy: "Adequate",
          pedalEdema: "Absent",
          urineAlbuminSugar: "Albumin Nil / Sugar Trace",
          maternalHemoglobinGdl: 10.6,
          maternalBloodGroupRh: "B+",
          tshMiuL: 2.2,
          dipsiOgtt2HrMgDl: 156,
          tdVaccineStatus: "Tdap Given (27-36w)",
          ifaCalciumStarted: true,
          pcpndtFormFLogged: true,
          quickeningPresent: true,
          estimatedFetalWeightGrams: 940,
          cervicalLengthMm: 34,
          placentalLocalization: "Fundal / Posterior",
          nstBppStatus: "Not Done",
          highRiskFactors: ["Anemia in Pregnancy (Hb < 11 g/dL)", "Gestational Diabetes (DIPSI >= 140)", "Previous LSCS"],
          antenatalChecklist: [
            { item: "First Trimester Dating Scan (CRL)", completed: true },
            { item: "NT Scan + Dual Marker (11-13w)", completed: true },
            { item: "TIFFA Level II Anomaly Scan (19w)", completed: true },
            { item: "DIPSI 75g 2-hr Glucose Challenge", completed: true },
            { item: "Growth & Doppler Scan (32w)", completed: false },
          ],
        },
      },
    },
    {
      id: "spec-rx-gyn-2",
      rxNumber: "RX-GYN-2026-0102",
      tenantId,
      patientId: "gynae-pat-kavya",
      doctorId: "doc-persona-gynae",
      doctorName: "Dr. Shalini Mukhopadhyay",
      doctorSpecialty: "Gynecology",
      doctorRegNumber: "WBMC-2011-44910",
      diagnosis: "PCOS (Rotterdam Phenotype A) — Letrozole Ovulation Induction Cycle (CD12 Dominant Follicle)",
      icd10Code: "E28.2",
      chiefComplaints: ["Cycle Day 12 TVS follicular tracking on Letrozole 2.5 mg", "Oligomenorrhea & insulin resistance"],
      vitals: defaultVitals({ bloodPressureSystolic: 116, bloodPressureDiastolic: 74, weightKg: 68, heightCm: 157, bmi: 27.6 }),
      medicines: [
        med("m-gyn-2a", "Myo-Inositol + D-Chiro-Inositol (Normoz-DS)", "Myo-inositol 2g + DCI 50mg + Chromium + Folate", "1 Tablet", "1-0-1", 90, "Tablet", "After Food"),
        med("m-gyn-2b", "Metformin SR 500 mg", "Metformin Sustained Release", "500 mg", "0-0-1", 60, "Tablet", "After Food"),
        med("m-gyn-2c", "Recombinant hCG 250 mcg SC (Ovitrelle)", "Choriogonadotropin Alfa 250 mcg", "250 mcg SC", "Once Only", 1, "Injection", "At Bedtime", "Trigger tonight at 9 PM; timed intercourse at 36h"),
      ],
      advice: ["45 mins brisk walking + resistance training 5x/week", "Low-GI Indian home diet; report on CD14 for rupture confirmation TVS"],
      specialtyType: "Gynecology",
      modules: {
        historyOfPresentIllness: "24y married 18 months with PCOS Phenotype A on Letrozole 2.5 mg (CD2–CD6) + Myo-inositol + Metformin. CD12 TVS today shows 18.8 mm dominant follicle in right ovary and 8.6 mm trilaminar endometrium.",
        physicalExamination: "BMI 27.6 kg/m2 (Asian obese), mFG score 10, acanthosis nigricans +, thyroid not enlarged, galactorrhea absent.",
        gynecologyAssessment: {
          clinicalMode: "Fertility & PCOS",
          lmpDate: shiftIsoDate(today, -12),
          calculatedEdd: "",
          gestationalAgeWeeks: 0,
          gestationalAgeDays: 0,
          trimester: "1st Trimester",
          gravidaPara: { g: 0, p: 0, l: 0, a: 0 },
          menarcheAge: 12,
          cycleRegularity: "Oligomenorrhea (>35d)",
          menstrualFlowVolume: "Scanty (Hypomenorrhea)",
          dysmenorrheaSeverity: "Mild",
          contraceptionMethod: "None",
          fertilityCycleDay: 12,
          ovulationInductionProtocol: "Letrozole 2.5 mg (CD2-6)",
          rightOvaryFollicleMm: "18.8 x 18.2 mm Dominant Follicle",
          leftOvaryFollicleMm: "10 mm / PCOM",
          endometrialThicknessMm: 8.6,
          endometrialPattern: "Trilaminar (Grade A)",
          amhNgMl: 6.8,
          tubalPatencyStatus: "SIS: Bilateral free tubal spill",
          partnerSemenSummary: "WHO 6th Normozoospermia (48M/mL, motility 56%)",
          ovulationTriggerPlan: "Inj r-hCG 250 mcg SC tonight -> TI at 36h",
          pcosPhenotypeFlags: [
            "Oligo / Anovulation (>35d cycles)",
            "Clinical Hirsutism (mFG >= 8)",
            "Acanthosis Nigricans (Insulin Resistance)",
            "PCOM on Pelvic USG",
            "Central Truncal Obesity (BMI >= 23 Asian)",
          ],
          pelvicUsgSummary: "CD12 TVS: Right ovary 18.8 mm dominant follicle; Left ovary PCOM; ET 8.6 mm trilaminar",
          hpvVaccineStatus: "Completed (Cervavac / Gardasil)",
        },
      },
    },
    {
      id: "spec-rx-gyn-3",
      rxNumber: "RX-GYN-2026-0103",
      tenantId,
      patientId: "gynae-pat-rekha",
      doctorId: "doc-persona-gynae",
      doctorName: "Dr. Shalini Mukhopadhyay",
      doctorSpecialty: "Gynecology",
      doctorRegNumber: "WBMC-2011-44910",
      diagnosis: "Abnormal Uterine Bleeding (AUB-L: FIGO Type 2 Fibroid) with Moderate Iron Deficiency Anemia",
      icd10Code: "D25.0",
      chiefComplaints: ["Heavy menstrual bleeding with clots lasting 8–9 days (4 cycles)", "Exertional fatigue (Hb 8.9 g/dL)"],
      vitals: defaultVitals({ bloodPressureSystolic: 110, bloodPressureDiastolic: 70, heartRate: 88, weightKg: 59, heightCm: 155, bmi: 24.6 }),
      medicines: [
        med("m-gyn-3a", "Tranexamic Acid 500 mg (Trapic)", "Tranexamic Acid 500mg", "500 mg", "1-1-1", 5, "Tablet", "After Food", "During heavy menses Day 1–5"),
        med("m-gyn-3b", "Ferrous Ascorbate 100 mg (Orofer-XT)", "Elemental Iron 100mg + Folic Acid 1.5mg", "1 Tablet", "1-0-1", 60, "Tablet", "After Food"),
      ],
      advice: ["Counselled regarding LNG-IUS vs Hysteroscopic Myomectomy after anemia correction", "Iron-rich diet (leafy greens, dates, roasted gram)"],
      specialtyType: "Gynecology",
      modules: {
        historyOfPresentIllness: "42y P2L2 (tubal ligation done) with menorrhagia soaking 6–7 pads/day with clots for 4 months. No intermenstrual or postcoital bleeding.",
        physicalExamination: "Conjunctival pallor +. Chaperone present. P/S: Cervix healthy, Pap taken (NILM). P/V: Uterus bulky ~8–10 wks, firm, mobile, bilateral fornices free.",
        gynecologyAssessment: {
          clinicalMode: "Gynaecology & Menstrual",
          lmpDate: shiftIsoDate(today, -12),
          calculatedEdd: "",
          gestationalAgeWeeks: 0,
          gestationalAgeDays: 0,
          trimester: "1st Trimester",
          gravidaPara: { g: 2, p: 2, l: 2, a: 0 },
          menarcheAge: 13,
          cycleRegularity: "Irregular / AUB",
          menstrualFlowVolume: "Heavy (Menorrhagia / Clots)",
          dysmenorrheaSeverity: "Moderate",
          intermenstrualOrPostcoitalBleeding: "None",
          contraceptionMethod: "Tubal Ligation",
          aubPalmCoeinClass: "AUB-L (Leiomyoma / Fibroid)",
          vaginalDischargeSyndromic: "No mucopurulent discharge; cervical motion tenderness absent",
          maternalHemoglobinGdl: 8.9,
          cervicalScreeningPapVia: "LBC Pap Smear NILM & HPV 16/18 Negative (2026)",
          hpvVaccineStatus: "Unvaccinated",
          breastExamSummary: "Bilateral breasts soft, no palpable mass or axillary lymphadenopathy",
          pelvicSpeculumSummary: "P/S: Healthy multiparous cervix; P/V: Bulky 8–10w firm uterus, non-tender fornices",
          pelvicUsgSummary: "TVS: 2.6 x 2.3 cm posterior wall FIGO Type 2 submucosal fibroid indenting cavity; ET 9 mm",
          chaperonePresent: true,
        },
      },
    },
    {
      id: "spec-rx-gyn-4",
      rxNumber: "RX-GYN-2026-0104",
      tenantId,
      patientId: "gynae-pat-pooja",
      doctorId: "doc-persona-gynae",
      doctorName: "Dr. Shalini Mukhopadhyay",
      doctorSpecialty: "Gynecology",
      doctorRegNumber: "WBMC-2011-44910",
      diagnosis: "Primigravida (G1P0) at 12w 4d ANC Booking with Gestational Subclinical Hypothyroidism & Rh-Negative Status",
      icd10Code: "O99.2",
      chiefComplaints: ["1st trimester antenatal booking & NT scan review", "Mild morning nausea"],
      vitals: defaultVitals({ bloodPressureSystolic: 112, bloodPressureDiastolic: 72, weightKg: 56, heightCm: 160, bmi: 21.9 }),
      medicines: [
        med("m-gyn-4a", "Levothyroxine Sodium 25 mcg (Thyronorm)", "Levothyroxine 25mcg", "25 mcg", "1-0-0", 30, "Tablet", "Empty Stomach", "45 mins before morning tea/breakfast"),
        med("m-gyn-4b", "Folic Acid 5 mg (Folvite)", "Folic Acid 5mg", "5 mg", "1-0-0", 30, "Tablet", "After Food"),
        med("m-gyn-4c", "Doxylamine + Pyridoxine (Doxinate)", "Doxylamine 10mg + Vit B6 10mg", "2 Tablets", "0-0-1", 15, "Tablet", "At Bedtime"),
      ],
      labTests: [
        { id: "lt-gyn-4a", testName: "NT + Nasal Bone Scan & Dual Marker (11-13 Weeks)", category: "Radiology", price: 2200 },
      ],
      advice: ["Indirect Coombs Test (ICT) at 16w & 28w; Anti-D 300 mcg prophylaxis planned at 28 weeks", "Repeat TSH in 4 weeks (1st trimester target <2.5 mIU/L)"],
      specialtyType: "Gynecology",
      modules: {
        historyOfPresentIllness: "28y primigravida at 12w4d gestation. Booking bloods show O Rh-negative (husband B Rh-positive, ICT negative) and TSH 4.2 mIU/L. NT scan normal (NT 1.4 mm, nasal bone ossified).",
        gynecologyAssessment: {
          clinicalMode: "Antenatal / Obstetric",
          lmpDate: lmp12w,
          calculatedEdd: edd12w,
          correctedUsgEdd: shiftIsoDate(edd12w, 2),
          gestationalAgeWeeks: 12,
          gestationalAgeDays: 4,
          trimester: "1st Trimester",
          gravidaPara: { g: 1, p: 0, l: 0, a: 0 },
          previousDeliveryMode: "Nulliparous",
          fetalHeartRateBpm: 158,
          fundalHeightCm: 12,
          presentation: "Not Applicable (Early / Non-ANC)",
          maternalHemoglobinGdl: 12.1,
          maternalBloodGroupRh: "O- (Husband B+, ICT Negative)",
          tshMiuL: 4.2,
          cervicalLengthMm: 38,
          placentalLocalization: "Fundal / Anterior",
          nstBppStatus: "Not Done",
          tdVaccineStatus: "Td-1 Given",
          ifaCalciumStarted: false,
          pcpndtFormFLogged: true,
          highRiskFactors: ["Hypothyroidism in Pregnancy", "Rh Negative Mother"],
          antenatalChecklist: [
            { item: "First Trimester Dating Scan (CRL)", completed: true },
            { item: "NT Scan + Dual Marker (11-13w)", completed: true },
            { item: "Indirect Coombs Test & Anti-D Plan (28w)", completed: false },
            { item: "TIFFA Anomaly Scan (18-20w)", completed: false },
          ],
        },
      },
    },
    {
      id: "spec-rx-gyn-5",
      rxNumber: "RX-GYN-2026-0105",
      tenantId,
      patientId: "gynae-pat-savita",
      doctorId: "doc-persona-gynae",
      doctorName: "Dr. Shalini Mukhopadhyay",
      doctorSpecialty: "Gynecology",
      doctorRegNumber: "WBMC-2011-44910",
      diagnosis: "Perimenopausal Vasomotor Syndrome with Osteopenia — Preventive Oncology Screen Normal",
      icd10Code: "N95.1",
      chiefComplaints: ["Nocturnal hot flushes & sleep fragmentation (5 months)", "Preventive cervical & breast checkup"],
      vitals: defaultVitals({ bloodPressureSystolic: 126, bloodPressureDiastolic: 80, weightKg: 65, heightCm: 156, bmi: 26.7 }),
      medicines: [
        med("m-gyn-5a", "Calcium Citrate Malate + Calcitriol + Vit K2-7", "CCM 500mg + Vit D3 1000 IU", "1 Tablet", "0-0-1", 60, "Tablet", "After Food"),
        med("m-gyn-5b", "Soy Isoflavones + Evening Primrose + Magnesium", "Phytoestrogen Nutraceutical", "1 Capsule", "0-0-1", 45, "Capsule", "After Food"),
      ],
      advice: ["Bilateral screening mammography & DEXA lumbar/hip follow-up", "Layered cotton clothing, evening yoga/pranayama, weight-bearing walk"],
      specialtyType: "Gynecology",
      modules: {
        historyOfPresentIllness: "49y P2L2 with irregular cycles every 2–3 months and hot flushes. No postmenopausal or intermenstrual spotting.",
        gynecologyAssessment: {
          clinicalMode: "Postnatal / Menopause",
          postnatalOrMenopauseFocus: "Perimenopause / Menopause",
          vasomotorSeverity: "Moderate",
          dexaTScoreSummary: "Lumbar L1-L4 DEXA T-score -1.7 (Osteopenia); Screening Mammogram BIRADS-1",
          lmpDate: shiftIsoDate(today, -68),
          calculatedEdd: "",
          gestationalAgeWeeks: 0,
          gestationalAgeDays: 0,
          trimester: "Postpartum",
          gravidaPara: { g: 2, p: 2, l: 2, a: 0 },
          cycleRegularity: "Oligomenorrhea (>35d)",
          cervicalScreeningPapVia: "VIA Negative & LBC NILM",
          hpvVaccineStatus: "Unvaccinated",
          breastExamSummary: "Bilateral breasts soft, no mass/skin dimpling/nipple discharge, axillae normal",
          pelvicUsgSummary: "TVS: Thin homogeneous endometrium 4.1 mm; bilateral ovaries small quiescent",
          chaperonePresent: true,
        },
      },
    },
    {
      id: "spec-rx-gyn-6",
      rxNumber: "RX-GYN-2026-0106",
      tenantId,
      patientId: "gynae-pat-anjali",
      doctorId: "doc-persona-gynae",
      doctorName: "Dr. Shalini Mukhopadhyay",
      doctorSpecialty: "Gynecology",
      doctorRegNumber: "WBMC-2011-44910",
      diagnosis: "Primigravida (G1P0) at 35w 2d Gestation with Mild Gestational Hypertension (PIH) — Reactive NST",
      icd10Code: "O13.3",
      chiefComplaints: ["35-week high-risk ANC & BP surveillance (144/92 mmHg)", "Mild bilateral ankle puffiness"],
      vitals: defaultVitals({ bloodPressureSystolic: 144, bloodPressureDiastolic: 92, heartRate: 84, weightKg: 71, heightCm: 161, bmi: 27.4 }),
      medicines: [
        med("m-gyn-6a", "Labetalol 100 mg (Lobet 100)", "Labetalol Hydrochloride 100mg", "100 mg", "1-0-1", 14, "Tablet", "After Food", "Target pregnancy BP <135/85 mmHg; monitor home BP twice daily"),
        med("m-gyn-6b", "Ferrous Ascorbate + Folic Acid (Orofer-XT)", "Elemental Iron 100mg + Folate 1.5mg", "1 Tablet", "1-0-0", 30, "Tablet", "After Food"),
        med("m-gyn-6c", "Calcium Carbonate + Vit D3 (Shelcal 500)", "Calcium 500mg + Vit D3 250 IU", "1 Tablet", "0-1-1", 30, "Tablet", "After Food"),
      ],
      labTests: [
        { id: "lt-gyn-6a", testName: "Weekly Non-Stress Test (NST) & Umbilical Artery S/D Doppler", category: "Radiology", price: 1600 },
        { id: "lt-gyn-6b", testName: "PIH Panel (CBC, Platelets, SGOT/SGPT, Uric Acid, Spot Urine PCR)", category: "Biochemistry", price: 1250 },
      ],
      advice: [
        "Home BP chart morning & evening; left lateral rest and daily fetal kick count (>=10 kicks/2h)",
        "PIH Danger Signs — report to labour room immediately if severe frontal headache, blurring/scotomata, epigastric/RUQ pain, or reduced urine/fetal movements",
      ],
      specialtyType: "Gynecology",
      modules: {
        historyOfPresentIllness: "29y primigravida at 35w2d with new-onset BP 144/92 mmHg since 34 weeks without severe pre-eclamptic features. NST today reactive (2 accelerations >15 bpm x 15s in 20 mins); umbilical Doppler S/D normal.",
        riskLevel: "High",
        gynecologyAssessment: {
          clinicalMode: "Antenatal / Obstetric",
          lmpDate: lmp35w,
          calculatedEdd: edd35w,
          gestationalAgeWeeks: 35,
          gestationalAgeDays: 2,
          trimester: "3rd Trimester",
          gravidaPara: { g: 1, p: 0, l: 0, a: 0 },
          previousDeliveryMode: "Nulliparous",
          fundalHeightCm: 34,
          fetalHeartRateBpm: 142,
          presentation: "Cephalic / Vertex",
          liquorAdequacy: "Adequate",
          pedalEdema: "Mild (+)",
          urineAlbuminSugar: "Albumin Trace / Sugar Nil",
          maternalHemoglobinGdl: 11.6,
          maternalBloodGroupRh: "B+",
          estimatedFetalWeightGrams: 2480,
          cervicalLengthMm: 31,
          placentalLocalization: "Fundal / Anterior",
          nstBppStatus: "Reactive NST",
          tdVaccineStatus: "Tdap Given (27-36w)",
          ifaCalciumStarted: true,
          pcpndtFormFLogged: true,
          quickeningPresent: true,
          highRiskFactors: ["PIH / Pre-eclampsia"],
          antenatalChecklist: [
            { item: "First Trimester Dating & NT Scan", completed: true },
            { item: "TIFFA Anomaly Scan (19w)", completed: true },
            { item: "DIPSI 75g OGTT (118 mg/dL Normal)", completed: true },
            { item: "35w Fetal Growth, Doppler & NST", completed: true },
            { item: "37w Term Delivery Plan Review", completed: false },
          ],
        },
      },
    },
    {
      id: "spec-rx-gyn-7",
      rxNumber: "RX-GYN-2026-0107",
      tenantId,
      patientId: "gynae-pat-sneha",
      doctorId: "doc-persona-gynae",
      doctorName: "Dr. Shalini Mukhopadhyay",
      doctorSpecialty: "Gynecology",
      doctorRegNumber: "WBMC-2011-44910",
      diagnosis: "Postnatal Day-10 Follow-Up Post-FTLSCS — Clean Pfannenstiel Scar & Exclusive Lactation Support",
      icd10Code: "Z39.2",
      chiefComplaints: ["Postnatal Day-10 LSCS dressing check", "Latch positioning check for exclusive breastfeeding"],
      vitals: defaultVitals({ bloodPressureSystolic: 116, bloodPressureDiastolic: 74, heartRate: 78, weightKg: 63, heightCm: 159, bmi: 24.9 }),
      medicines: [
        med("m-gyn-7a", "Ferrous Ascorbate + Folic Acid (Orofer-XT)", "Elemental Iron 100mg + Folic Acid 1.5mg", "1 Tablet", "1-0-0", 90, "Tablet", "After Food", "Postnatal 180-day iron replenishment"),
        med("m-gyn-7b", "Calcium Carbonate + Vitamin D3 (Shelcal-HD)", "Calcium 500mg + Vit D3 500 IU", "1 Tablet", "1-0-1", 90, "Tablet", "After Food"),
        med("m-gyn-7c", "Purified Lanolin Nipple Cream (Nipcare)", "Modified Lanolin USP", "Thin layer", "1-1-1", 14, "Ointment", "After Food", "Apply post-feed for nipple comfort"),
      ],
      advice: [
        "Exclusive demand breastfeeding every 2–3 hours; demonstrated cradle & football hold to avoid scar pressure",
        "Schedule Day-42 (6-week) postnatal pelvic involution check and Chhaya / Cu-IUCD spacing initiation",
      ],
      specialtyType: "Gynecology",
      modules: {
        historyOfPresentIllness: "31y P1L1 on Postpartum Day 10 following emergency lower-segment cesarean section (healthy 3.2 kg female neonate, birth vaccines given). Afebrile, voiding & bowel normal, mild left nipple soreness.",
        gynecologyAssessment: {
          clinicalMode: "Postnatal / Menopause",
          postnatalOrMenopauseFocus: "Postnatal / Lactation (42d)",
          lmpDate: "",
          calculatedEdd: "",
          gestationalAgeWeeks: 0,
          gestationalAgeDays: 0,
          trimester: "Postpartum",
          gravidaPara: { g: 1, p: 1, l: 1, a: 0 },
          previousDeliveryMode: "Previous 1 LSCS",
          postpartumDays: 10,
          lochiaAndScarStatus: "Lochia serosa minimal, non-foul; Pfannenstiel LSCS scar clean, dry & well-approximated",
          lactationLatchStatus: "Latch Support Needed",
          epdsPostnatalMood: "Normal (EPDS <10)",
          contraceptionMethod: "Chhaya (Centchroman)",
          breastExamSummary: "Bilateral breasts lactating, soft post-feed, no engorgement/mastitis; deep latch demonstrated",
          chaperonePresent: true,
        },
      },
    },

    // --- 5 PEDIATRICS PRESCRIPTIONS ---
    {
      id: "spec-rx-ped-1",
      rxNumber: "RX-PED-2026-0201",
      tenantId,
      patientId: "poly-pat-arjun",
      doctorId: "doc-persona-pedia",
      doctorName: "Dr. Ananya Sen",
      doctorSpecialty: "Pediatrics",
      doctorRegNumber: "WBMC-2016-39482",
      diagnosis: "Episodic Viral-Triggered Wheeze (Mild) — Controlled on MDI + Spacer",
      icd10Code: "J45.20",
      chiefComplaints: ["Nocturnal dry cough & mild wheeze after weather change (3 days)"],
      vitals: defaultVitals({ heartRate: 96, spO2: 98, temperature: 98.8, weightKg: 25, heightCm: 126 }),
      medicines: [
        med("m-ped-1a", "Levosalbutamol MDI 50 mcg via Valved Spacer", "Levosalbutamol", "2 Puffs", "SOS", 5, "Inhaler", "After Food", "Every 6 hrs via spacer for 3 days"),
        med("m-ped-1b", "Montelukast Chewable 5 mg", "Montelukast Sodium", "5 mg", "0-0-1", 14, "Tablet", "At Bedtime"),
      ],
      advice: ["Demonstrated spacer technique to father; rinse mouth after puffs", "Avoid cold aerated drinks, incense smoke, and dust exposure"],
      specialtyType: "Pediatrics",
      modules: {
        historyOfPresentIllness: "8y boy (BW 3.0 kg Term NVD) with viral coryza followed by nocturnal wheeze. Playful, speaking full sentences, SpO2 98% on room air.",
        pediatricAssessment: {
          childWeightKg: 25,
          childHeightCm: 126,
          developmentalMilestones: "Age Appropriate",
          informant: "Father",
          birthMode: "Term NVD",
          birthWeightKg: 3.0,
          feedingPattern: "Family Pot Balanced Diet",
          imnciDangerSigns: ["No General Danger Signs"],
          immunizationsDue: ["Annual Quadrivalent Influenza"],
        },
      },
    },
    {
      id: "spec-rx-ped-2",
      rxNumber: "RX-PED-2026-0202",
      tenantId,
      patientId: "pedia-pat-aadhya",
      doctorId: "doc-persona-pedia",
      doctorName: "Dr. Ananya Sen",
      doctorSpecialty: "Pediatrics",
      doctorRegNumber: "WBMC-2016-39482",
      diagnosis: "9-Month Well-Baby Anthropometry, IYCF Complementary Feeding & MMR-1 Review",
      icd10Code: "Z00.129",
      chiefComplaints: ["Routine 9-month immunization & growth check"],
      vitals: defaultVitals({ heartRate: 116, temperature: 98.4, weightKg: 8.6, heightCm: 71 }),
      medicines: [
        med("m-ped-2a", "Cholecalciferol Pediatric Drops 400 IU/ml", "Vitamin D3", "1 ml (400 IU)", "1-0-0", 60, "Drops", "With Food"),
        med("m-ped-2b", "Colloidal Iron + Folic Acid Pediatric Drops", "Elemental Iron 20mg/ml", "0.5 ml", "1-0-0", 60, "Drops", "After Food"),
      ],
      advice: ["Continue breastfeeding + 3 mashed complementary home meals (ragi porridge, khichdi with ghee, mashed banana)", "No salt/sugar/honey or cow milk before 1 year"],
      specialtyType: "Pediatrics",
      modules: {
        pediatricAssessment: {
          childWeightKg: 8.6,
          childHeightCm: 71,
          headCircumferenceCm: 44.2,
          muacCm: 13.8,
          developmentalMilestones: "Age Appropriate",
          informant: "Mother",
          birthMode: "Term NVD",
          birthWeightKg: 2.9,
          neonatalHistory: "Immediate cry at birth, birth BCG/OPV-0/HepB given before discharge",
          feedingPattern: "Breastfeeding + Complementary (IYCF)",
          imnciDangerSigns: ["No General Danger Signs"],
          immunizationsDue: ["MMR Dose 1", "Meningococcal Conjugate (Counselled)"],
        },
      },
    },
    {
      id: "spec-rx-ped-3",
      rxNumber: "RX-PED-2026-0203",
      tenantId,
      patientId: "pedia-pat-vihaan",
      doctorId: "doc-persona-pedia",
      doctorName: "Dr. Ananya Sen",
      doctorSpecialty: "Pediatrics",
      doctorRegNumber: "WBMC-2016-39482",
      diagnosis: "Acute Viral Gastroenteritis with No Dehydration (IAP ORS + Zinc Protocol)",
      icd10Code: "A09",
      chiefComplaints: ["5 episodes watery non-bloody stools since yesterday", "1 episode vomiting"],
      vitals: defaultVitals({ heartRate: 108, temperature: 99.1, weightKg: 13.8, heightCm: 95 }),
      medicines: [
        med("m-ped-3a", "WHO Low-Osmolarity ORS (Electral)", "ORS", "140 ml", "SOS", 5, "Syrup", "After Food", "After each loose stool"),
        med("m-ped-3b", "Zinc Gluconate Syrup 20mg/5ml", "Elemental Zinc 20mg", "5 ml", "1-0-0", 14, "Syrup", "After Food", "Complete full 14-day IAP course"),
      ],
      advice: ["Home fluids: curd rice, dal water, tender coconut water; avoid fruit juices and OTC antibiotics", "Watch urine output and activity"],
      specialtyType: "Pediatrics",
      modules: {
        pediatricAssessment: {
          childWeightKg: 13.8,
          childHeightCm: 95,
          muacCm: 14.4,
          developmentalMilestones: "Age Appropriate",
          informant: "Mother",
          birthMode: "Term LSCS",
          birthWeightKg: 3.1,
          feedingPattern: "Family Pot Balanced Diet",
          imnciDangerSigns: ["No General Danger Signs"],
          calculatedDosageBasis: "ORS 140 ml/stool + Zinc 20 mg OD x 14d",
        },
      },
    },
    {
      id: "spec-rx-ped-4",
      rxNumber: "RX-PED-2026-0204",
      tenantId,
      patientId: "pedia-pat-diya",
      doctorId: "doc-persona-pedia",
      doctorName: "Dr. Ananya Sen",
      doctorSpecialty: "Pediatrics",
      doctorRegNumber: "WBMC-2016-39482",
      diagnosis: "5-Year School-Entry Booster Check & Mild Nutritional Iron Deficiency (Hb 10.4 g/dL)",
      icd10Code: "D50.9",
      chiefComplaints: ["5-year booster immunization check", "Picky eating & mild pallor"],
      vitals: defaultVitals({ heartRate: 98, weightKg: 17.5, heightCm: 108 }),
      medicines: [
        med("m-ped-4a", "Ferrous Ascorbate Pediatric Syrup (Orofer-XT)", "Elemental Iron 30mg/5ml", "7.5 ml", "1-0-0", 60, "Syrup", "After Food"),
        med("m-ped-4b", "Albendazole Oral Suspension 400 mg", "Albendazole", "10 ml", "0-0-1", 1, "Syrup", "At Bedtime", "Single STAT deworming dose"),
      ],
      advice: ["Include jaggery-groundnut chikki, sprouts, green leafy parathas, and lemon squeeze"],
      specialtyType: "Pediatrics",
      modules: {
        pediatricAssessment: {
          childWeightKg: 17.5,
          childHeightCm: 108,
          muacCm: 13.4,
          developmentalMilestones: "Age Appropriate",
          informant: "Both Parents",
          feedingPattern: "Picky / Inadequate Intake",
          immunizationsDue: ["DTwP/DTaP Booster 2", "IPV Booster", "MMR Dose 2"],
        },
      },
    },
    {
      id: "spec-rx-ped-5",
      rxNumber: "RX-PED-2026-0205",
      tenantId,
      patientId: "pedia-pat-reyansh",
      doctorId: "doc-persona-pedia",
      doctorName: "Dr. Ananya Sen",
      doctorSpecialty: "Pediatrics",
      doctorRegNumber: "WBMC-2016-39482",
      diagnosis: "Acute Exudative Tonsillopharyngitis (Penicillin Allergy — Macrolide Regimen)",
      icd10Code: "J03.90",
      chiefComplaints: ["High-grade fever 102°F & painful swallowing (3 days)"],
      vitals: defaultVitals({ heartRate: 104, temperature: 101.6, weightKg: 36, heightCm: 143 }),
      medicines: [
        med("m-ped-5a", "Azithromycin Oral Suspension 200mg/5ml", "Azithromycin (Penicillin-safe)", "9 ml (360 mg)", "1-0-0", 5, "Syrup", "After Food", "10 mg/kg OD x 5 days"),
        med("m-ped-5b", "Paracetamol Suspension 250mg/5ml", "Paracetamol", "10 ml (500 mg)", "SOS", 3, "Syrup", "After Food", "Every 6 hrs for fever >100°F"),
      ],
      advice: ["Warm saline gargles 3x/day; soft warm diet; Penicillin allergy flagged on UHID card"],
      specialtyType: "Pediatrics",
      modules: {
        pediatricAssessment: {
          childWeightKg: 36,
          childHeightCm: 143,
          developmentalMilestones: "Age Appropriate",
          informant: "Father",
          calculatedDosageBasis: "Azithromycin 10 mg/kg = 360 mg OD (Penicillin allergy)",
        },
      },
    },

    // --- 5 CARDIOLOGY PRESCRIPTIONS ---
    {
      id: "spec-rx-crd-1",
      rxNumber: "RX-CRD-2026-0301",
      tenantId,
      patientId: "poly-pat-kavita",
      doctorId: "doc-persona-cardio",
      doctorName: "Dr. Rajesh Sharma",
      doctorSpecialty: "Cardiology",
      doctorRegNumber: "DMC-2008-11928",
      diagnosis: "Essential Hypertension (Stage II) with Mixed Dyslipidemia",
      icd10Code: "I10",
      chiefComplaints: ["Occipital morning heaviness & home BP 148/94 mmHg (2 weeks)"],
      vitals: defaultVitals({ bloodPressureSystolic: 148, bloodPressureDiastolic: 92, heartRate: 82 }),
      medicines: [
        med("m-crd-1a", "Telmisartan + Amlodipine (Telma-AM 40/5)", "Telmisartan 40mg + Amlodipine 5mg", "1 Tablet", "1-0-0", 30),
        med("m-crd-1b", "Rosuvastatin 10 mg (Rosuvas 10)", "Rosuvastatin", "10 mg", "0-0-1", 30, "Tablet", "At Bedtime"),
      ],
      advice: ["DASH Indian diet: <4g salt/day, avoid pickles, papads, and salted namkeen; 30-min morning walk"],
      specialtyType: "Cardiology",
      modules: {
        cardiologyAssessment: {
          nyhaFunctionalClass: "Class I",
          targetBloodPressure: "< 130/80 mmHg",
          targetRestingHeartRate: "65 - 75 bpm",
          ecgSummary: "Normal sinus rhythm, early LV strain voltage criteria",
          echoFindings: "LVEF 60%, Concentric LVH, Grade I Diastolic Dysfunction",
          dailySodiumLimitGrams: 2,
          cadRiskFactors: ["Hypertension", "Dyslipidemia (High Lp(a)/TG)"],
        },
      },
    },
    {
      id: "spec-rx-crd-2",
      rxNumber: "RX-CRD-2026-0302",
      tenantId,
      patientId: "cardio-pat-mahesh",
      doctorId: "doc-persona-cardio",
      doctorName: "Dr. Rajesh Sharma",
      doctorSpecialty: "Cardiology",
      doctorRegNumber: "DMC-2008-11928",
      diagnosis: "Post-PTCA to Proximal LAD (DES) with Type 2 Diabetes — Stable Secondary Prevention",
      icd10Code: "I25.2",
      chiefComplaints: ["6-month post-angioplasty review — asymptomatic on brisk walk"],
      vitals: defaultVitals({ bloodPressureSystolic: 124, bloodPressureDiastolic: 76, heartRate: 64 }),
      medicines: [
        med("m-crd-2a", "Aspirin + Ticagrelor (Axcer 90 + Ecosprin 75)", "DAPT Regimen", "1 Set", "1-0-1", 30),
        med("m-crd-2b", "Atorvastatin 40 mg (Lipitor / Atorva 40)", "High-Intensity Statin", "40 mg", "0-0-1", 30),
        med("m-crd-2c", "Metoprolol Succinate XL 50 mg", "Beta Blocker", "50 mg", "1-0-0", 30),
        med("m-crd-2d", "Empagliflozin 10 mg (Jardiance)", "SGLT2i Cardioprotection", "10 mg", "1-0-0", 30),
      ],
      advice: ["NEVER stop DAPT (Aspirin/Ticagrelor) without cardiologist clearance", "LDL-C target <55 mg/dL"],
      specialtyType: "Cardiology",
      modules: {
        cardiologyAssessment: {
          nyhaFunctionalClass: "Class I",
          targetBloodPressure: "< 125/75 mmHg",
          targetRestingHeartRate: "55 - 65 bpm",
          ecgSummary: "Sinus bradycardia 64 bpm, resolved anterior T-inversions",
          echoFindings: "LVEF 52%, mild hypokinesia distal septum, no MR",
          dailySodiumLimitGrams: 2,
          cadRiskFactors: ["Type 2 Diabetes", "Hypertension", "Dyslipidemia (High Lp(a)/TG)"],
          pastCardiacInterventions: "DES to proximal LAD (May 2025)",
          antithromboticRegimen: "DAPT (Aspirin 75mg OD + Ticagrelor 90mg BD)",
        },
      },
    },
    {
      id: "spec-rx-crd-3",
      rxNumber: "RX-CRD-2026-0303",
      tenantId,
      patientId: "cardio-pat-harbans",
      doctorId: "doc-persona-cardio",
      doctorName: "Dr. Rajesh Sharma",
      doctorSpecialty: "Cardiology",
      doctorRegNumber: "DMC-2008-11928",
      diagnosis: "Chronic Heart Failure with Reduced Ejection Fraction (HFrEF, LVEF 38%, NYHA II) — GDMT",
      icd10Code: "I50.22",
      chiefComplaints: ["Mild exertional dyspnea on uphill walk; ankle edema subsided"],
      vitals: defaultVitals({ bloodPressureSystolic: 114, bloodPressureDiastolic: 72, heartRate: 70, weightKg: 74 }),
      medicines: [
        med("m-crd-3a", "Sacubitril + Valsartan 50 mg (Vymada 50)", "ARNI", "50 mg", "1-0-1", 30),
        med("m-crd-3b", "Carvedilol 6.25 mg", "Beta Blocker", "6.25 mg", "1-0-1", 30),
        med("m-crd-3c", "Dapagliflozin 10 mg", "SGLT2 Inhibitor", "10 mg", "1-0-0", 30),
        med("m-crd-3d", "Eplerenone 25 mg", "MRA", "25 mg", "1-0-0", 30),
      ],
      advice: ["Daily morning dry-weight log; report if weight rises >2 kg in 3 days", "Strict 1.5 L/day fluid restriction"],
      specialtyType: "Cardiology",
      modules: {
        cardiologyAssessment: {
          nyhaFunctionalClass: "Class II",
          targetBloodPressure: "105 - 125 / 70 mmHg",
          targetRestingHeartRate: "60 - 70 bpm",
          echoFindings: "Global LV hypokinesia, LVEF 38%, mild functional MR, IVC normal",
          dailySodiumLimitGrams: 1.5,
          dailyFluidLimitMl: 1500,
        },
      },
    },
    {
      id: "spec-rx-crd-4",
      rxNumber: "RX-CRD-2026-0304",
      tenantId,
      patientId: "cardio-pat-lalitha",
      doctorId: "doc-persona-cardio",
      doctorName: "Dr. Rajesh Sharma",
      doctorSpecialty: "Cardiology",
      doctorRegNumber: "DMC-2008-11928",
      diagnosis: "Non-Valvular Paroxysmal Atrial Fibrillation (CHA2DS2-VASc 4) on NOAC",
      icd10Code: "I48.0",
      chiefComplaints: ["Occasional brief palpitations; renal function review for NOAC"],
      vitals: defaultVitals({ bloodPressureSystolic: 132, bloodPressureDiastolic: 82, heartRate: 78 }),
      medicines: [
        med("m-crd-4a", "Apixaban 5 mg (Eliquis)", "Direct Factor Xa Inhibitor", "5 mg", "1-0-1", 30),
        med("m-crd-4b", "Bisoprolol 2.5 mg (Concor 2.5)", "Cardioselective Beta Blocker", "2.5 mg", "1-0-0", 30),
      ],
      advice: ["Check eGFR/creatinine every 6 months; report gum bleed or melena"],
      specialtyType: "Cardiology",
      modules: {
        cardiologyAssessment: {
          nyhaFunctionalClass: "Class I",
          targetBloodPressure: "< 130/80 mmHg",
          targetRestingHeartRate: "60 - 80 bpm",
          dailySodiumLimitGrams: 2,
          antithromboticRegimen: "Apixaban 5 mg BD",
        },
      },
    },
    {
      id: "spec-rx-crd-5",
      rxNumber: "RX-CRD-2026-0305",
      tenantId,
      patientId: "cardio-pat-prakash",
      doctorId: "doc-persona-cardio",
      doctorName: "Dr. Rajesh Sharma",
      doctorSpecialty: "Cardiology",
      doctorRegNumber: "DMC-2008-11928",
      diagnosis: "Chronic Stable Effort Angina — Positive Family Hx Premature Indian CAD",
      icd10Code: "I20.8",
      chiefComplaints: ["Central chest tightness on brisk uphill walk relieved by rest in 3 mins"],
      vitals: defaultVitals({ bloodPressureSystolic: 136, bloodPressureDiastolic: 86, heartRate: 76 }),
      medicines: [
        med("m-crd-5a", "Aspirin 75 mg + Rosuvastatin 20 mg", "Antiplatelet + Statin", "1 Capsule", "0-0-1", 30),
        med("m-crd-5b", "Metoprolol XL 25 mg", "Beta Blocker", "25 mg", "1-0-0", 30),
        med("m-crd-5c", "Nitroglycerin Sublingual 0.5 mg (Sorbitrate)", "Nitrate", "0.5 mg", "SOS", 15, "Tablet", "With Food", "Sublingual SOS for acute chest heaviness"),
      ],
      advice: ["Scheduled CT Coronary Angiography / Stress Echo this week"],
      specialtyType: "Cardiology",
      modules: {
        cardiologyAssessment: {
          nyhaFunctionalClass: "Class II",
          targetBloodPressure: "< 130/80 mmHg",
          targetRestingHeartRate: "55 - 65 bpm",
          dailySodiumLimitGrams: 2,
          cadRiskFactors: ["Dyslipidemia (High Lp(a)/TG)", "Premature Family CAD (<55M/<65F)"],
        },
      },
    },

    // --- 5 DERMATOLOGY PRESCRIPTIONS ---
    {
      id: "spec-rx-drm-1",
      rxNumber: "RX-DRM-2026-0401",
      tenantId,
      patientId: "poly-pat-suresh",
      doctorId: "doc-persona-derma",
      doctorName: "Dr. Meera Vasudevan",
      doctorSpecialty: "Dermatology",
      doctorRegNumber: "KMC-2015-88392",
      diagnosis: "Chronic Plaque Psoriasis (Elbows & Extensor Knees)",
      icd10Code: "L40.0",
      chiefComplaints: ["Well-demarcated erythematous plaques with silvery scale over elbows (2 months)"],
      vitals: defaultVitals(),
      medicines: [
        med("m-drm-1a", "Calcipotriol + Clobetasol Ointment", "Topical Vitamin D Analogue + Steroid", "Thin layer", "0-0-1", 21, "Ointment", "At Bedtime"),
        med("m-drm-1b", "Liquid Paraffin + White Soft Paraffin Emollient", "Barrier Emollient", "Liberal", "1-1-1", 30, "Ointment", "After Food", "Apply within 3 mins of bath"),
      ],
      advice: ["Avoid scrubbing scales (Koebner phenomenon); screen fasting sugar & lipids"],
      specialtyType: "Dermatology",
      modules: {
        dermatologyAssessment: {
          fitzpatrickSkinType: "Type IV",
          lesionType: ["Annular Plaques", "Scaling"],
          distribution: "Bilateral extensor elbows and knees, Auspitz sign positive",
          sunProtectionAdvice: "Morning natural sunlight 10 mins; broad-spectrum moisturizer",
          itchSeverityNrs: 5,
        },
      },
    },
    {
      id: "spec-rx-drm-2",
      rxNumber: "RX-DRM-2026-0402",
      tenantId,
      patientId: "derma-pat-ritika",
      doctorId: "doc-persona-derma",
      doctorName: "Dr. Meera Vasudevan",
      doctorSpecialty: "Dermatology",
      doctorRegNumber: "KMC-2015-88392",
      diagnosis: "Acne Vulgaris Grade III with Post-Inflammatory Hyperpigmentation",
      icd10Code: "L70.0",
      chiefComplaints: ["Inflammatory papulopustular acne on cheeks & jawline (3 months)"],
      vitals: defaultVitals(),
      medicines: [
        med("m-drm-2a", "Adapalene 0.1% + Clindamycin 1% Gel", "Topical Retinoid + Antibiotic", "Pea-sized", "0-0-1", 45, "Ointment", "At Bedtime"),
        med("m-drm-2b", "Doxycycline 100 mg", "Tetracycline", "100 mg", "0-0-1", 30, "Capsule", "After Food", "Take with full glass of water upright"),
      ],
      advice: ["Matte gel SPF 50+ PA++++ every 3 hours; do not squeeze comedones"],
      specialtyType: "Dermatology",
      modules: {
        dermatologyAssessment: {
          fitzpatrickSkinType: "Type IV",
          lesionType: ["Papules", "Comedones", "Hyperpigmentation"],
          distribution: "Bilateral malar cheeks, chin, and forehead",
          sunProtectionAdvice: "Non-comedogenic SPF 50+ Gel every morning",
          itchSeverityNrs: 2,
        },
      },
    },
    {
      id: "spec-rx-drm-3",
      rxNumber: "RX-DRM-2026-0403",
      tenantId,
      patientId: "derma-pat-ravi",
      doctorId: "doc-persona-derma",
      doctorName: "Dr. Meera Vasudevan",
      doctorSpecialty: "Dermatology",
      doctorRegNumber: "KMC-2015-88392",
      diagnosis: "Tinea Cruris et Corporis Modified by OTC Topical Steroid Misuse (Tinea Incognito)",
      icd10Code: "B35.6",
      chiefComplaints: ["Intensely itchy expanding groin & waist rings after using OTC steroid tube (6 weeks)"],
      vitals: defaultVitals(),
      medicines: [
        med("m-drm-3a", "Itraconazole 100 mg (Canditral 100)", "Systemic Triazole Antifungal", "100 mg", "1-0-1", 21, "Capsule", "After Food"),
        med("m-drm-3b", "Luliconazole 1% Cream", "Topical Imidazole", "Apply 2cm beyond margin", "0-0-1", 28, "Ointment", "At Bedtime"),
        med("m-drm-3c", "Levocetirizine 5 mg", "Antihistamine", "5 mg", "0-0-1", 10, "Tablet", "At Bedtime"),
      ],
      advice: [
        "STOP all OTC Clobetasol/Betamethasone combination tubes immediately",
        "Wear loose washed ironed cotton innerwear; wash towels separately in hot water",
      ],
      specialtyType: "Dermatology",
      modules: {
        dermatologyAssessment: {
          fitzpatrickSkinType: "Type V",
          lesionType: ["Annular Plaques", "Scaling"],
          distribution: "Bilateral inguinal folds extending to lower abdomen with striae rubrae",
          sunProtectionAdvice: "Keep intertriginous folds dry and aerated",
          itchSeverityNrs: 8,
          topicalSteroidMisuseHistory: true,
          priorTopicalsUsed: "OTC Clobetasol + Gentamicin + Miconazole tube for 5 weeks",
        },
      },
    },
    {
      id: "spec-rx-drm-4",
      rxNumber: "RX-DRM-2026-0404",
      tenantId,
      patientId: "derma-pat-shabana",
      doctorId: "doc-persona-derma",
      doctorName: "Dr. Meera Vasudevan",
      doctorSpecialty: "Dermatology",
      doctorRegNumber: "KMC-2015-88392",
      diagnosis: "Centrofacial Epidermal-Mixed Melasma (Fitzpatrick IV)",
      icd10Code: "L81.1",
      chiefComplaints: ["Symmetric brownish patches over cheeks & bridge of nose (1 year)"],
      vitals: defaultVitals(),
      medicines: [
        med("m-drm-4a", "Kojic Acid 2% + Azelaic Acid 10% + Niacinamide Serum", "Non-Hydroquinone Depigmenting", "Thin layer", "0-0-1", 60, "Ointment", "At Bedtime"),
        med("m-drm-4b", "Tinted Iron-Oxide Sunscreen SPF 50+", "Broad UV + Visible Light Block", "2-finger rule", "1-1-0", 60, "Ointment", "Before Food"),
      ],
      advice: ["Strict visible-light + UV photoprotection; avoid scented PPD hair dyes"],
      specialtyType: "Dermatology",
      modules: {
        dermatologyAssessment: {
          fitzpatrickSkinType: "Type IV",
          lesionType: ["Hyperpigmentation"],
          distribution: "Symmetric malar and nasal bridge patches",
          sunProtectionAdvice: "Tinted Iron-Oxide SPF 50+ at 8 AM and 12 PM indoors & outdoors",
          itchSeverityNrs: 0,
        },
      },
    },
    {
      id: "spec-rx-drm-5",
      rxNumber: "RX-DRM-2026-0405",
      tenantId,
      patientId: "derma-pat-nikhil",
      doctorId: "doc-persona-derma",
      doctorName: "Dr. Meera Vasudevan",
      doctorSpecialty: "Dermatology",
      doctorRegNumber: "KMC-2015-88392",
      diagnosis: "Chronic Spontaneous Urticaria",
      icd10Code: "L50.1",
      chiefComplaints: ["Evanescent itchy wheals lasting <24 hrs almost daily (7 weeks)"],
      vitals: defaultVitals(),
      medicines: [
        med("m-drm-5a", "Bilastine 20 mg", "2nd-Gen Non-Sedating Antihistamine", "20 mg", "1-0-1", 28, "Tablet", "Empty Stomach"),
      ],
      advice: ["Avoid NSAID painkillers and shellfish triggers; maintain UAS7 diary"],
      specialtyType: "Dermatology",
      modules: {
        dermatologyAssessment: {
          fitzpatrickSkinType: "Type IV",
          lesionType: ["Wheals"],
          distribution: "Trunk and proximal extremities, dermatographism positive",
          sunProtectionAdvice: "Lukewarm baths + soothing calamine/ceramide lotion",
          itchSeverityNrs: 7,
        },
      },
    },

    // --- 5 ORTHOPEDICS PRESCRIPTIONS ---
    {
      id: "spec-rx-ort-1",
      rxNumber: "RX-ORT-2026-0501",
      tenantId,
      patientId: "poly-pat-farah",
      doctorId: "doc-persona-ortho",
      doctorName: "Dr. Harshvardhan Patel",
      doctorSpecialty: "Orthopedics",
      doctorRegNumber: "GMC-2010-55421",
      diagnosis: "Bilateral Medial Compartment Knee Osteoarthritis (Kellgren-Lawrence Grade III) with Vit D Deficiency",
      icd10Code: "M17.0",
      chiefComplaints: ["Bilateral knee pain on stairs & inability to squat/sit cross-legged (6 months)"],
      vitals: defaultVitals({ weightKg: 74, heightCm: 156, bmi: 30.4 }),
      medicines: [
        med("m-ort-1a", "Etoricoxib 60 mg (Nucoxia 60)", "COX-2 Selective NSAID", "60 mg", "1-0-0", 7),
        med("m-ort-1b", "Undenatured Collagen Type II + Rosehip + Boswellia", "Chondroprotective", "1 Capsule", "0-0-1", 60),
        med("m-ort-1c", "Cholecalciferol 60,000 IU", "Vitamin D3", "1 Sachet", "Once a week", 56, "Capsule", "With Food"),
      ],
      advice: ["Use Western commode; avoid squatting and floor sitting; isometric quadriceps strengthening"],
      specialtyType: "Orthopedics",
      modules: {
        orthopedicAssessment: {
          affectedJointLimb: "Bilateral Knees (Right > Left)",
          weightBearingStatus: "Full Weight Bearing (FWB)",
          splintOrBraceApplied: "Neoprene Hinged Knee Cap during walking",
          xrayFindingsSummary: "Standing AP/Lat Knees: Medial joint space narrowing, osteophytes, KL Grade III",
          mechanismOfOnset: "Degenerative / Age-related",
          distalNeurovascularStatus: "Intact — DP/PT pulses 2+, sensation normal",
          indianAdlSquatCrossLeg: "Unable to Squat / Sit Cross-Legged",
        },
      },
    },
    {
      id: "spec-rx-ort-2",
      rxNumber: "RX-ORT-2026-0502",
      tenantId,
      patientId: "ortho-pat-sandeep",
      doctorId: "doc-persona-ortho",
      doctorName: "Dr. Harshvardhan Patel",
      doctorSpecialty: "Orthopedics",
      doctorRegNumber: "GMC-2010-55421",
      diagnosis: "Acute L4-L5 Posterolateral Disc Prolapse with Right L5 Radiculopathy",
      icd10Code: "M51.16",
      chiefComplaints: ["Low back pain radiating down right lateral calf after lifting cylinder (5 days)"],
      vitals: defaultVitals(),
      medicines: [
        med("m-ort-2a", "Aceclofenac + Thiocolchicoside (Zerodol-TH 4)", "NSAID + Muscle Relaxant", "1 Tablet", "1-0-1", 5),
        med("m-ort-2b", "Pregabalin 75 mg + Nortriptyline 10 mg", "Neuropathic Modulator", "1 Tablet", "0-0-1", 21, "Tablet", "At Bedtime"),
      ],
      advice: ["Avoid forward bending, lifting weights, and bumpy two-wheeler commute; cauda equina red flags explained"],
      specialtyType: "Orthopedics",
      modules: {
        orthopedicAssessment: {
          affectedJointLimb: "Lumbosacral Spine (Right L5 Root)",
          weightBearingStatus: "Full Weight Bearing (FWB)",
          splintOrBraceApplied: "Contoured Lumbosacral Corset during travel",
          xrayFindingsSummary: "SLR positive at 45° right; EHL power 5/5; bladder/bowel intact",
          mechanismOfOnset: "Postural / Ergonomic",
          distalNeurovascularStatus: "EHL/FHL 5/5, mild L5 dermatomal paresthesia, pulses intact",
          indianAdlSquatCrossLeg: "Painful Squatting / Indian Toilet",
        },
      },
    },
    {
      id: "spec-rx-ort-3",
      rxNumber: "RX-ORT-2026-0503",
      tenantId,
      patientId: "ortho-pat-kamala",
      doctorId: "doc-persona-ortho",
      doctorName: "Dr. Harshvardhan Patel",
      doctorSpecialty: "Orthopedics",
      doctorRegNumber: "GMC-2010-55421",
      diagnosis: "Closed Undisplaced Left Distal Radius Fracture (Colles) in Below-Elbow POP Slab",
      icd10Code: "S52.532A",
      chiefComplaints: ["2-week check X-ray & slab review following slip in bathroom"],
      vitals: defaultVitals(),
      medicines: [
        med("m-ort-3a", "Calcium Carbonate 500mg + Calcitriol 0.25mcg", "Bone Healing Support", "1 Tablet", "1-0-1", 45),
        med("m-ort-3b", "Paracetamol 650 mg", "Analgesic", "650 mg", "SOS", 5),
      ],
      advice: ["Active finger, thumb, and shoulder mobilization hourly; keep limb elevated; watch for tight cast swelling"],
      specialtyType: "Orthopedics",
      modules: {
        orthopedicAssessment: {
          affectedJointLimb: "Left Wrist / Distal Radius",
          weightBearingStatus: "Non-Weight Bearing (NWB)",
          splintOrBraceApplied: "Dorsal Below-Elbow POP Slab Converted to Cast",
          xrayFindingsSummary: "Check X-ray Left Wrist AP/Lat: Radial length & volar tilt maintained, early callus",
          mechanismOfOnset: "Fall at Home",
          distalNeurovascularStatus: "Radial pulse +, capillary refill <2s, median/ulnar/radial nerves intact",
          indianAdlSquatCrossLeg: "Unrestricted",
        },
      },
    },
    {
      id: "spec-rx-ort-4",
      rxNumber: "RX-ORT-2026-0504",
      tenantId,
      patientId: "ortho-pat-varun",
      doctorId: "doc-persona-ortho",
      doctorName: "Dr. Harshvardhan Patel",
      doctorSpecialty: "Orthopedics",
      doctorRegNumber: "GMC-2010-55421",
      diagnosis: "Right Anterior Talofibular Ligament (ATFL) Grade II Inversion Sprain",
      icd10Code: "S93.491A",
      chiefComplaints: ["Right lateral ankle swelling & pain after badminton landing (3 days)"],
      vitals: defaultVitals(),
      medicines: [
        med("m-ort-4a", "Trypsin-Chymotrypsin + Aceclofenac (Chymoral Forte + Zerodol)", "Anti-edema + Analgesic", "1 Tablet", "1-0-1", 5),
      ],
      advice: ["PRICE protocol (Protection, Rest, Ice 15m q4h, Compression, Elevation); ankle stirrup brace"],
      specialtyType: "Orthopedics",
      modules: {
        orthopedicAssessment: {
          affectedJointLimb: "Right Ankle Lateral Ligament Complex",
          weightBearingStatus: "Partial Weight Bearing (PWB)",
          splintOrBraceApplied: "Semi-Rigid Aircast Ankle Stirrup Brace",
          xrayFindingsSummary: "Ottawa Ankle X-ray negative for malleolar/5th metatarsal fracture",
          mechanismOfOnset: "Sports / Gym Injury",
          distalNeurovascularStatus: "Intact",
        },
      },
    },
    {
      id: "spec-rx-ort-5",
      rxNumber: "RX-ORT-2026-0505",
      tenantId,
      patientId: "ortho-pat-meenakshi",
      doctorId: "doc-persona-ortho",
      doctorName: "Dr. Harshvardhan Patel",
      doctorSpecialty: "Orthopedics",
      doctorRegNumber: "GMC-2010-55421",
      diagnosis: "Right Adhesive Capsulitis (Periarthritis Shoulder) Associated with Diabetes",
      icd10Code: "M75.01",
      chiefComplaints: ["Painful restriction of right shoulder abduction & external rotation + night pain (6 weeks)"],
      vitals: defaultVitals({ bloodSugarRandom: 164 }),
      medicines: [
        med("m-ort-5a", "Etoricoxib 60 mg", "NSAID", "60 mg", "0-0-1", 7),
        med("m-ort-5b", "Diclofenac Diethylamine Topical Gel", "Topical NSAID", "Local application", "1-0-1", 14, "Ointment"),
      ],
      advice: ["Codman pendulum & wall-ladder exercises after warm fomentation; optimize HbA1c"],
      specialtyType: "Orthopedics",
      modules: {
        orthopedicAssessment: {
          affectedJointLimb: "Right Glenohumeral Joint",
          weightBearingStatus: "Full Weight Bearing (FWB)",
          xrayFindingsSummary: "Abduction 85°, External rotation 20°; X-ray right shoulder glenohumeral space preserved",
          mechanismOfOnset: "Degenerative / Age-related",
          distalNeurovascularStatus: "Axillary & radial nerve intact",
        },
      },
    },

    // --- 5 ENT PRESCRIPTIONS ---
    {
      id: "spec-rx-ent-1",
      rxNumber: "RX-ENT-2026-0601",
      tenantId,
      patientId: "ent-pat-deepak",
      doctorId: "doc-persona-ent",
      doctorName: "Dr. Naveen Iyer",
      doctorSpecialty: "ENT",
      doctorRegNumber: "MMC-2014-22011",
      diagnosis: "Right Chronic Suppurative Otitis Media (Tubotympanic Active Mucosal)",
      icd10Code: "H66.1",
      chiefComplaints: ["Mucopurulent non-foul right ear discharge (6 days)", "Mild reduced hearing"],
      vitals: defaultVitals(),
      medicines: [
        med("m-ent-1a", "Ciprofloxacin 0.3% Sterile Ear Drops", "Topical Fluoroquinolone Otic", "3 Drops", "1-1-1", 7, "Drops"),
        med("m-ent-1b", "Levocetirizine 5 mg + Montelukast 10 mg", "Decongestant/Antiallergic", "1 Tablet", "0-0-1", 10, "Tablet", "At Bedtime"),
      ],
      advice: ["Strict dry-ear precautions; vaseline-cotton plug during bath; no ear buds"],
      specialtyType: "ENT",
      modules: {
        entAssessment: {
          primarySite: "Ear / Otology",
          otoscopyRight: "Medium central perforation in anteroinferior pars tensa with mucoid discharge",
          otoscopyLeft: "Intact pearly grey tympanic membrane",
          tuningForkRinneWeber: "Rinne negative right (BC > AC), positive left; Weber lateralized right",
          oropharynxTonsilGrade: "Grade I",
          oralMucosaSubmucousCheck: "Healthy mucosa, mouth opening 44 mm",
          audiometryOrEndoscopyNotes: "PTA: 30 dB conductive gap right ear",
        },
      },
    },
    {
      id: "spec-rx-ent-2",
      rxNumber: "RX-ENT-2026-0602",
      tenantId,
      patientId: "ent-pat-shruti",
      doctorId: "doc-persona-ent",
      doctorName: "Dr. Naveen Iyer",
      doctorSpecialty: "ENT",
      doctorRegNumber: "MMC-2014-22011",
      diagnosis: "Moderate-Severe Persistent Allergic Rhinitis with Left DNS",
      icd10Code: "J30.9",
      chiefComplaints: ["Morning sneezing paroxysms, watery rhinorrhea & nasal block (2 months)"],
      vitals: defaultVitals(),
      medicines: [
        med("m-ent-2a", "Fluticasone Furoate Nasal Spray 27.5 mcg", "Intranasal Corticosteroid", "2 Sprays each nostril", "1-0-0", 30, "Drops"),
        med("m-ent-2b", "Fexofenadine 120 mg (Allegra 120)", "Non-sedating Antihistamine", "120 mg", "0-0-1", 14),
      ],
      advice: ["Isotonic saline nasal douching; dust-mite pillow covers"],
      specialtyType: "ENT",
      modules: {
        entAssessment: {
          primarySite: "Nose & PNS",
          otoscopyRight: "TM intact",
          otoscopyLeft: "TM intact, mild retraction",
          anteriorRhinoscopyDns: "DNS to left without spur; bilateral pale boggy inferior turbinates",
          oropharynxTonsilGrade: "Grade I",
        },
      },
    },
    {
      id: "spec-rx-ent-3",
      rxNumber: "RX-ENT-2026-0603",
      tenantId,
      patientId: "ent-pat-manoj",
      doctorId: "doc-persona-ent",
      doctorName: "Dr. Naveen Iyer",
      doctorSpecialty: "ENT",
      doctorRegNumber: "MMC-2014-22011",
      diagnosis: "Oral Submucous Fibrosis (OSMF Clinical Grade II) — Areca Nut / Gutkha Induced",
      icd10Code: "K13.5",
      chiefComplaints: ["Intense oral burning to spicy food & progressive stiffness opening mouth (4 months)"],
      vitals: defaultVitals(),
      medicines: [
        med("m-ent-3a", "Lycopene + Beta-Carotene + Selenium + Zinc (SM Fibro)", "Antioxidant Therapy", "1 Capsule", "1-0-1", 60, "Capsule"),
        med("m-ent-3b", "Triamcinolone Acetonide 0.1% Buccal Paste (Kenacort)", "Topical Mucosal Steroid", "Apply locally", "1-0-1", 21, "Ointment"),
      ],
      advice: ["COMPLETE CESSATION of gutkha, supari, pan masala, and tobacco; ice-cream stick jaw-stretching physiotherapy 5x/day"],
      specialtyType: "ENT",
      modules: {
        entAssessment: {
          primarySite: "Throat & Larynx",
          otoscopyRight: "Normal",
          otoscopyLeft: "Normal",
          oropharynxTonsilGrade: "Grade I",
          oralMucosaSubmucousCheck: "Blanched marble-like buccal mucosa, palpable vertical fibrous bands, inter-incisal opening 26 mm, no erythroplakia/ulcer",
        },
      },
    },
    {
      id: "spec-rx-ent-4",
      rxNumber: "RX-ENT-2026-0604",
      tenantId,
      patientId: "ent-pat-padma",
      doctorId: "doc-persona-ent",
      doctorName: "Dr. Naveen Iyer",
      doctorSpecialty: "ENT",
      doctorRegNumber: "MMC-2014-22011",
      diagnosis: "Right Posterior Semicircular Canal BPPV — Epley Canalith Repositioning Done",
      icd10Code: "H81.11",
      chiefComplaints: ["Brief 20-sec spinning vertigo on rolling to right side in bed (4 days)"],
      vitals: defaultVitals(),
      medicines: [
        med("m-ent-4a", "Betahistine 16 mg (Vertin 16)", "Vestibular Modulator", "16 mg", "1-0-1", 7),
      ],
      advice: ["Epley maneuver performed in OPD; sleep slightly propped at 30° tonight; Brandt-Daroff exercises if residual"],
      specialtyType: "ENT",
      modules: {
        entAssessment: {
          primarySite: "Head, Neck & Vertigo",
          otoscopyRight: "TM intact",
          otoscopyLeft: "TM intact",
          vertigoDixHallpike: "Right Dix-Hallpike positive: torsional upbeating geotropic nystagmus with 4s latency, fatigable; Epley maneuver completed",
        },
      },
    },
    {
      id: "spec-rx-ent-5",
      rxNumber: "RX-ENT-2026-0605",
      tenantId,
      patientId: "ent-pat-aarav",
      doctorId: "doc-persona-ent",
      doctorName: "Dr. Naveen Iyer",
      doctorSpecialty: "ENT",
      doctorRegNumber: "MMC-2014-22011",
      diagnosis: "Chronic Hypertrophic Adenotonsillitis (Brodsky Grade III) with Mouth Breathing",
      icd10Code: "J35.3",
      chiefComplaints: ["Snoring, mouth breathing & 5 episodes throat infection this year"],
      vitals: defaultVitals({ weightKg: 44, heightCm: 156 }),
      medicines: [
        med("m-ent-5a", "Mometasone Aqueous Nasal Spray 50 mcg", "Adenoid Shrinkage Regimen", "1 Spray each nostril", "0-0-1", 42, "Drops"),
        med("m-ent-5b", "Povidone-Iodine 2% Germicidal Gargle", "Antiseptic Gargle", "10 ml diluted", "1-0-1", 7, "Syrup"),
      ],
      advice: ["X-ray soft tissue nasopharynx lateral view; review in 6 weeks for coblation adenotonsillectomy evaluation"],
      specialtyType: "ENT",
      modules: {
        entAssessment: {
          primarySite: "Throat & Larynx",
          otoscopyRight: "Dull TM, Type C Eustachian dysfunction",
          otoscopyLeft: "Dull TM",
          oropharynxTonsilGrade: "Grade III",
        },
      },
    },

    // --- 5 OPHTHALMOLOGY PRESCRIPTIONS ---
    {
      id: "spec-rx-oph-1",
      rxNumber: "RX-OPH-2026-0701",
      tenantId,
      patientId: "ophtho-pat-ramesh",
      doctorId: "doc-persona-ophtho",
      doctorName: "Dr. Alok Nath Mukherjee",
      doctorSpecialty: "Ophthalmology",
      doctorRegNumber: "DMC-2009-33211",
      diagnosis: "OD Immature Senile Nuclear Cataract (NS Grade II); OS Pseudophakia",
      icd10Code: "H25.11",
      chiefComplaints: ["Progressive misty vision & night headlight glare in right eye (6 months)"],
      vitals: defaultVitals({ bloodPressureSystolic: 130, bloodPressureDiastolic: 80, bloodSugarRandom: 124 }),
      medicines: [
        med("m-oph-1a", "Carboxymethylcellulose 0.5% Preservative-Free Drops", "Tear Substitute", "1 Drop OU", "1-1-1", 30, "Drops"),
      ],
      advice: ["Fit for right eye phacoemulsification + foldable hydrophobic PCIOL; optical biometry (IOLMaster) advised"],
      specialtyType: "Ophthalmology",
      modules: {
        ophthalmologyAssessment: {
          visualAcuityOD: "6/36 -> 6/18",
          visualAcuityOS: "6/6 (PCIOL)",
          refractionOD: { sphere: "-1.50", cyl: "-0.75", axis: "90°", add: "+2.50" },
          refractionOS: { sphere: "Plano", cyl: "-0.50", axis: "180°", add: "+2.50" },
          pupillaryDistanceMm: 64,
          iopOD: 15,
          iopOS: 14,
          anteriorSegment: "OD: Nuclear sclerosis Grade II+, AC deep; OS: Well-centered in-the-bag PCIOL",
          fundusExam: { cupToDiscRatioOD: "0.3", cupToDiscRatioOS: "0.3", retinaFindings: "Healthy macula & disc OU" },
        },
      },
    },
    {
      id: "spec-rx-oph-2",
      rxNumber: "RX-OPH-2026-0702",
      tenantId,
      patientId: "ophtho-pat-ananya",
      doctorId: "doc-persona-ophtho",
      doctorName: "Dr. Alok Nath Mukherjee",
      doctorSpecialty: "Ophthalmology",
      doctorRegNumber: "DMC-2009-33211",
      diagnosis: "Compound Myopic Astigmatism with Computer Vision Syndrome",
      icd10Code: "H52.223",
      chiefComplaints: ["Blurred blackboard distance vision & evening eye fatigue"],
      vitals: defaultVitals(),
      medicines: [
        med("m-oph-2a", "Sodium Hyaluronate 0.1% Lubricating Eye Drops", "Ocular Lubricant", "1 Drop OU", "1-1-1", 30, "Drops"),
      ],
      advice: ["Follow 20-20-20 screen rule; anti-reflective spectacle prescription dispensed"],
      specialtyType: "Ophthalmology",
      modules: {
        ophthalmologyAssessment: {
          visualAcuityOD: "6/24 -> 6/6",
          visualAcuityOS: "6/18 -> 6/6",
          refractionOD: { sphere: "-2.00", cyl: "-0.75", axis: "180°", add: "+0.00" },
          refractionOS: { sphere: "-1.75", cyl: "-0.50", axis: "175°", add: "+0.00" },
          pupillaryDistanceMm: 61,
          iopOD: 14,
          iopOS: 14,
          anteriorSegment: "Clear cornea, quiet AC, clear lens OU",
          fundusExam: { cupToDiscRatioOD: "0.3", cupToDiscRatioOS: "0.3", retinaFindings: "Normal myopic tessellation, periphery flat" },
        },
      },
    },
    {
      id: "spec-rx-oph-3",
      rxNumber: "RX-OPH-2026-0703",
      tenantId,
      patientId: "ophtho-pat-gopal",
      doctorId: "doc-persona-ophtho",
      doctorName: "Dr. Alok Nath Mukherjee",
      doctorSpecialty: "Ophthalmology",
      doctorRegNumber: "DMC-2009-33211",
      diagnosis: "Bilateral Mild Non-Proliferative Diabetic Retinopathy (NPDR) without DME",
      icd10Code: "E11.3293",
      chiefComplaints: ["Annual dilated diabetic fundus screening (T2DM x 12 years)"],
      vitals: defaultVitals({ bloodSugarRandom: 168 }),
      medicines: [
        med("m-oph-3a", "Antioxidant Lutein + Zeaxanthin + Omega-3 Capsule", "Retinal Nutraceutical", "1 Capsule", "0-1-0", 60, "Capsule"),
      ],
      advice: ["Maintain HbA1c <7.0% and BP <130/80 mmHg; repeat dilated fundus + OCT macula in 6 months"],
      specialtyType: "Ophthalmology",
      modules: {
        ophthalmologyAssessment: {
          visualAcuityOD: "6/9 -> 6/6",
          visualAcuityOS: "6/9 -> 6/6",
          refractionOD: { sphere: "+0.75", cyl: "-0.50", axis: "90°", add: "+2.25" },
          refractionOS: { sphere: "+1.00", cyl: "-0.50", axis: "85°", add: "+2.25" },
          pupillaryDistanceMm: 65,
          iopOD: 16,
          iopOS: 17,
          anteriorSegment: "Early cortical spokes OU",
          fundusExam: { cupToDiscRatioOD: "0.4", cupToDiscRatioOS: "0.4", retinaFindings: "Few scattered microaneurysms temporal to macula OU; foveal contour normal on OCT" },
        },
      },
    },
    {
      id: "spec-rx-oph-4",
      rxNumber: "RX-OPH-2026-0704",
      tenantId,
      patientId: "ophtho-pat-vasundhara",
      doctorId: "doc-persona-ophtho",
      doctorName: "Dr. Alok Nath Mukherjee",
      doctorSpecialty: "Ophthalmology",
      doctorRegNumber: "DMC-2009-33211",
      diagnosis: "Primary Open-Angle Glaucoma (OU) — Target IOP Achieved",
      icd10Code: "H40.1132",
      chiefComplaints: ["3-monthly IOP & Humphrey visual field follow-up"],
      vitals: defaultVitals(),
      medicines: [
        med("m-oph-4a", "Latanoprost 0.005% Eye Drops", "Prostaglandin Analogue", "1 Drop OU", "0-0-1", 30, "Drops", "At Bedtime", "Punctal occlusion for 1 min after instillation"),
      ],
      advice: ["Lifelong nightly drop adherence; screen first-degree siblings/children after age 40"],
      specialtyType: "Ophthalmology",
      modules: {
        ophthalmologyAssessment: {
          visualAcuityOD: "6/6",
          visualAcuityOS: "6/9",
          refractionOD: { sphere: "+1.25", cyl: "0.00", axis: "0°", add: "+2.50" },
          refractionOS: { sphere: "+1.50", cyl: "-0.50", axis: "90°", add: "+2.50" },
          pupillaryDistanceMm: 62,
          iopOD: 14,
          iopOS: 15,
          anteriorSegment: "Open angles Grade IV on gonioscopy OU",
          fundusExam: { cupToDiscRatioOD: "0.65", cupToDiscRatioOS: "0.7", retinaFindings: "Inferior neuroretinal rim thinning stable; HVF 24-2 early nasal step stable" },
        },
      },
    },
    {
      id: "spec-rx-oph-5",
      rxNumber: "RX-OPH-2026-0705",
      tenantId,
      patientId: "ophtho-pat-rohan",
      doctorId: "doc-persona-ophtho",
      doctorName: "Dr. Alok Nath Mukherjee",
      doctorSpecialty: "Ophthalmology",
      doctorRegNumber: "DMC-2009-33211",
      diagnosis: "Meibomian Gland Dysfunction with Evaporative Dry Eye",
      icd10Code: "H04.123",
      chiefComplaints: ["Foreign-body grittiness & burning after 9-hour laptop work"],
      vitals: defaultVitals(),
      medicines: [
        med("m-oph-5a", "Polyethylene Glycol + Propylene Glycol Eye Drops (Systane Ultra)", "Lipid-Aqueous Lubricant", "1 Drop OU", "1-1-1", 30, "Drops"),
      ],
      advice: ["Warm eyelid compress 5 mins nightly + gentle lid-margin hygiene; conscious blinking"],
      specialtyType: "Ophthalmology",
      modules: {
        ophthalmologyAssessment: {
          visualAcuityOD: "6/6",
          visualAcuityOS: "6/6",
          refractionOD: { sphere: "Plano", cyl: "0.00", axis: "0°", add: "+0.00" },
          refractionOS: { sphere: "Plano", cyl: "0.00", axis: "0°", add: "+0.00" },
          pupillaryDistanceMm: 63,
          iopOD: 13,
          iopOS: 14,
          anteriorSegment: "Capped meibomian orifices, TBUT 6 seconds OU, cornea fluorescein negative",
          fundusExam: { cupToDiscRatioOD: "0.3", cupToDiscRatioOS: "0.3", retinaFindings: "Normal posterior pole OU" },
        },
      },
    },
  ];

  const labs: SeedLabSpec[] = [
    {
      id: "spec-lab-gyn-pooja",
      tenantId,
      patientId: "gynae-pat-pooja",
      uhid: "LUM-GYN-2303",
      patientName: "Pooja Agarwal",
      labName: "Iyer Polyclinic Maternal-Fetal Lab",
      category: "ANC Booking + Double Marker",
      interpretation: "1st trimester Dual Marker low risk for Trisomy 21/18/13; Indirect Coombs negative in O Rh-negative primigravida; mild gestational TSH elevation (4.2 mIU/L) on Thyronorm 25 mcg.",
      results: [
        { param: "Hemoglobin (Booking)", value: 12.1, unit: "g/dL", normalRange: "11.0 - 14.5", status: "Normal" },
        { param: "TSH (1st Trimester)", value: 4.2, unit: "mIU/L", normalRange: "0.1 - 2.5", status: "High" },
        { param: "Indirect Coombs Test (ICT)", value: "Negative", unit: "titer", normalRange: "Negative", status: "Normal" },
        { param: "Dual Marker Combined T21 Risk", value: "1:4800", unit: "ratio", normalRange: "Low Risk (< 1:250)", status: "Normal" },
      ],
    },
    {
      id: "spec-lab-gyn-nisha",
      tenantId,
      patientId: "poly-pat-nisha",
      uhid: "LUM-POLY-2203",
      patientName: "Nisha Kulkarni",
      labName: "Iyer Polyclinic Women's Diagnostics",
      category: "DIPSI 75g OGTT",
      interpretation: "2-hr 75g DIPSI Glucose elevated (156 mg/dL — GDM threshold >=140) with mild maternal anemia (Hb 10.6 g/dL). Initiated MNT + Metformin SR 500 + BD Iron.",
      results: [
        { param: "DIPSI 75g 2-Hr Plasma Glucose", value: 156, unit: "mg/dL", normalRange: "< 140 (Pregnancy)", status: "High" },
        { param: "Hemoglobin (Maternal)", value: 10.6, unit: "g/dL", normalRange: "11.0 - 14.5", status: "Low" },
        { param: "TSH (2nd Trimester)", value: 2.2, unit: "mIU/L", normalRange: "0.3 - 3.0", status: "Normal" },
      ],
    },
    {
      id: "spec-lab-gyn-kavya",
      tenantId,
      patientId: "gynae-pat-kavya",
      uhid: "LUM-GYN-2301",
      patientName: "Kavya Chatterjee",
      labName: "Iyer Polyclinic Endocrine Lab",
      category: "PCOS AMH & Hormone Panel",
      interpretation: "Elevated AMH (6.8 ng/mL) and fasting insulin (21.4 uIU/mL) consistent with Rotterdam Phenotype A PCOS; undergoing Letrozole ovulation induction.",
      results: [
        { param: "Fasting Serum Insulin", value: 21.4, unit: "uIU/mL", normalRange: "2.6 - 15.0", status: "High" },
        { param: "AMH (Anti-Mullerian Hormone)", value: 6.8, unit: "ng/mL", normalRange: "1.5 - 4.0", status: "High" },
        { param: "TSH", value: 2.4, unit: "mIU/L", normalRange: "0.4 - 4.2", status: "Normal" },
      ],
    },
    {
      id: "spec-lab-gyn-rekha",
      tenantId,
      patientId: "gynae-pat-rekha",
      uhid: "LUM-GYN-2302",
      patientName: "Rekha Deshpande",
      labName: "Iyer Polyclinic Cytopathology & Hematology",
      category: "LBC Pap + HPV Co-Test",
      interpretation: "Liquid-based cervical cytology NILM and High-Risk HPV 16/18 negative; microcytic hypochromic anemia (Hb 8.9 g/dL, Ferritin 7.4 ng/mL) secondary to AUB-L fibroid.",
      results: [
        { param: "LBC Cervical Cytology (Bethesda)", value: "NILM", unit: "grade", normalRange: "NILM", status: "Normal" },
        { param: "High-Risk HPV 16/18 DNA PCR", value: "Not Detected", unit: "qualitative", normalRange: "Not Detected", status: "Normal" },
        { param: "Hemoglobin", value: 8.9, unit: "g/dL", normalRange: "12.0 - 15.5", status: "Low" },
        { param: "Serum Ferritin", value: 7.4, unit: "ng/mL", normalRange: "15 - 150", status: "Low" },
      ],
    },
    {
      id: "spec-lab-gyn-anjali",
      tenantId,
      patientId: "gynae-pat-anjali",
      uhid: "LUM-GYN-2305",
      patientName: "Anjali Verma",
      labName: "Iyer Polyclinic High-Risk Obstetric Lab",
      category: "PIH Preeclampsia Panel",
      interpretation: "Borderline spot urine protein:creatinine ratio (0.24) and mild gestational hyperuricemia (5.9 mg/dL); platelets and transaminases normal (no HELLP features).",
      results: [
        { param: "Spot Urine Protein:Creatinine Ratio", value: 0.24, unit: "mg/mg", normalRange: "< 0.20", status: "High" },
        { param: "Serum Uric Acid (3rd Trimester)", value: 5.9, unit: "mg/dL", normalRange: "3.1 - 5.5", status: "High" },
        { param: "Platelet Count", value: 198, unit: "x10^3/uL", normalRange: "150 - 410", status: "Normal" },
        { param: "SGOT / AST", value: 26, unit: "U/L", normalRange: "< 35", status: "Normal" },
      ],
    },
    {
      id: "spec-lab-ped-diya",
      tenantId,
      patientId: "pedia-pat-diya",
      uhid: "LUM-PED-2403",
      patientName: "Diya Kulkarni",
      labName: "Iyer Polyclinic Pediatric Lab",
      category: "Complete Blood Count",
      interpretation: "Mild nutritional iron-deficiency anemia; started weight-based oral iron.",
      results: [
        { param: "Hemoglobin", value: 10.4, unit: "g/dL", normalRange: "11.5 - 14.5", status: "Low" },
        { param: "MCV", value: 72, unit: "fL", normalRange: "75 - 87", status: "Low" },
      ],
    },
    {
      id: "spec-lab-crd-mahesh",
      tenantId,
      patientId: "cardio-pat-mahesh",
      uhid: "LUM-CRD-2501",
      patientName: "Mahesh Venkataraman",
      labName: "Iyer Polyclinic Cardiac Diagnostics",
      category: "Lipid Profile",
      interpretation: "Secondary prevention post-LAD stent: LDL-C well controlled at 51 mg/dL; HbA1c 6.9%.",
      results: [
        { param: "LDL Cholesterol", value: 51, unit: "mg/dL", normalRange: "< 55 (Post-ACS)", status: "Normal" },
        { param: "HbA1c", value: 6.9, unit: "%", normalRange: "< 7.0", status: "Normal" },
      ],
    },
    {
      id: "spec-lab-ort-farah",
      tenantId,
      patientId: "poly-pat-farah",
      uhid: "LUM-POLY-2205",
      patientName: "Farah Khan",
      labName: "Iyer Polyclinic Biochemistry",
      category: "Metabolic & Diabetes",
      interpretation: "Marked 25-OH Vitamin D deficiency (11.2 ng/mL); weekly 60K cholecalciferol started.",
      results: [
        { param: "25-OH Vitamin D Total", value: 11.2, unit: "ng/mL", normalRange: "30 - 100", status: "Low" },
        { param: "Serum Calcium", value: 8.8, unit: "mg/dL", normalRange: "8.6 - 10.2", status: "Normal" },
      ],
    },
    {
      id: "spec-lab-oph-gopal",
      tenantId,
      patientId: "ophtho-pat-gopal",
      uhid: "LUM-OPH-2903",
      patientName: "Gopalakrishnan Nair",
      labName: "Iyer Polyclinic Metabolic Lab",
      category: "Metabolic & Diabetes",
      interpretation: "Suboptimal HbA1c 7.8% correlating with mild NPDR; physician glycemic intensification advised.",
      results: [
        { param: "HbA1c", value: 7.8, unit: "%", normalRange: "< 7.0", status: "High" },
        { param: "Fasting Plasma Glucose", value: 146, unit: "mg/dL", normalRange: "70 - 100", status: "High" },
      ],
    },
  ];

  return { patients, visits, prescriptions, labs };
}

interface StandaloneWorkspaceSeed {
  tenantId: string;
  doctorId: string;
  doctorName: string;
  regNumber: string;
  specialty: string;
  sessionType: string;
  fee: number;
  withMedicalRx: boolean;
  patients: Array<{
    id: string;
    uhid: string;
    name: string;
    age: number;
    gender: "Female" | "Male";
    phone: string;
    bloodGroup: string;
    conditions: string[];
    address: string;
    diagnosis: string;
    icd10: string;
    complaint: string;
    meds: Array<Record<string, unknown>>;
    advice: string[];
    modules?: Record<string, unknown>;
  }>;
}

const STANDALONE_DEMO_WORKSPACES: StandaloneWorkspaceSeed[] = [
  {
    tenantId: "tenant-demo-dentist",
    doctorId: "doc-persona-dentist",
    doctorName: "Dr. Arunachalam Swamy",
    regNumber: "DCI-2013-19920",
    specialty: "Dental Surgery",
    sessionType: "Dental examination",
    fee: 650,
    withMedicalRx: true,
    patients: [
      {
        id: "dent-pat-1",
        uhid: "LUM-DNT-4101",
        name: "Karthikeyan Natarajan",
        age: 34,
        gender: "Male",
        phone: "+91 98111 41001",
        bloodGroup: "O+",
        conditions: ["Acute Irreversible Pulpitis #36 — Planned Rotary RCT"],
        address: "Velachery, Chennai 600042",
        diagnosis: "Symptomatic Irreversible Pulpitis Tooth #36 with Apical Periodontitis",
        icd10: "K04.02",
        complaint: "Throbbing night toothache in lower left molar #36 (4 days)",
        meds: [
          med("m-dnt-1", "Amoxicillin + Clavulanate 625 mg (Augmentin)", "Amox-Clav 625", "1 Tablet", "1-0-1", 5),
          med("m-dnt-2", "Ketorolac DT 10 mg (Ketorol-DT)", "Analgesic", "10 mg", "SOS", 3),
        ],
        advice: ["Avoid biting hard food on left side until zirconia crown cementation", "Warm saline mouth rinses"],
        modules: {
          dentalAssessment: {
            teethStatus: { 36: { condition: "Root Canal", notes: "Access opening & biomechanical preparation done" }, 46: { condition: "Caries", notes: "Class I pit caries" } },
            periodontalStatus: "Gingivitis",
            plaqueCalculusIndex: "Moderate",
            oralTobaccoHabit: "None",
            mouthOpeningMm: 44,
            plannedProcedures: [
              { toothNumber: 36, procedure: "Single-Sitting Rotary RCT", estimatedCost: 4500, status: "In Progress" },
              { toothNumber: 36, procedure: "Monolithic Zirconia Crown", estimatedCost: 6500, status: "Planned" },
            ],
          },
        },
      },
      {
        id: "dent-pat-2",
        uhid: "LUM-DNT-4102",
        name: "Sneha Raghavan",
        age: 26,
        gender: "Female",
        phone: "+91 98111 41002",
        bloodGroup: "B+",
        conditions: ["Pericoronitis Mesioangular Impacted #48"],
        address: "Besant Nagar, Chennai 600090",
        diagnosis: "Acute Pericoronitis of Mesioangular Impacted Mandibular Third Molar (#48)",
        icd10: "K05.22",
        complaint: "Painful gum flap swelling behind lower right wisdom tooth & mild trismus (3 days)",
        meds: [
          med("m-dnt-3", "Metronidazole 400 mg (Flagyl)", "Anaerobic Coverage", "400 mg", "1-1-1", 5),
          med("m-dnt-4", "Chlorhexidine Gluconate 0.2% Mouthwash", "Antiseptic Rinse", "10 ml", "1-0-1", 7, "Syrup"),
        ],
        advice: ["OPG X-ray taken; surgical disimpaction of #48 scheduled once acute trismus settles"],
        modules: {
          dentalAssessment: {
            teethStatus: { 48: { condition: "Extraction Needed", notes: "Mesioangular impaction with inflamed operculum" } },
            periodontalStatus: "Gingivitis",
            oralTobaccoHabit: "None",
            mouthOpeningMm: 34,
            plannedProcedures: [{ toothNumber: 48, procedure: "Surgical Third Molar Disimpaction", estimatedCost: 5500, status: "Planned" }],
          },
        },
      },
      {
        id: "dent-pat-3",
        uhid: "LUM-DNT-4103",
        name: "Brijesh Solanki",
        age: 47,
        gender: "Male",
        phone: "+91 98111 41003",
        bloodGroup: "A+",
        conditions: ["Chronic Generalized Periodontitis", "Gutkha Habit — Early OSMF"],
        address: "Alkapuri, Vadodara 390007",
        diagnosis: "Chronic Generalized Moderate Periodontitis with Tobacco Pouch Keratosis",
        icd10: "K05.31",
        complaint: "Bleeding gums on brushing, halitosis & staining (6 months)",
        meds: [med("m-dnt-5", "Coenzyme Q10 + Lycopene Gum Paint & Capsule", "Antioxidant", "1 Capsule", "1-0-1", 30, "Capsule")],
        advice: ["Full-mouth ultrasonic scaling & polishing completed; stop gutkha/supari immediately"],
        modules: {
          dentalAssessment: {
            teethStatus: { 31: { condition: "Healthy", notes: "Grade I mobility, subgingival calculus" } },
            periodontalStatus: "Moderate Periodontitis",
            plaqueCalculusIndex: "Heavy",
            oralTobaccoHabit: "Gutkha / Khaini / Pan Masala",
            mouthOpeningMm: 31,
            plannedProcedures: [{ procedure: "Full-Mouth Ultrasonic Scaling & Root Planing", estimatedCost: 2200, status: "Completed" }],
          },
        },
      },
      {
        id: "dent-pat-4",
        uhid: "LUM-DNT-4104",
        name: "LakshmiVenkatesh",
        age: 58,
        gender: "Female",
        phone: "+91 98111 41004",
        bloodGroup: "O+",
        conditions: ["Missing #36 & #37 — Implant Prosthetic Plan", "Controlled T2DM"],
        address: "Malleswaram, Bengaluru 560003",
        diagnosis: "Partial Edentulism Mandibular Left Posterior Arch (#36, #37)",
        icd10: "K08.1",
        complaint: "Difficulty chewing on left side due to old extracted molars",
        meds: [med("m-dnt-6", "Fluoride Desensitizing Toothpaste", "Topical Fluoride", "Pea size", "1-0-1", 30, "Ointment")],
        advice: ["CBCT mandible ordered for bone width evaluation; HbA1c 6.7% cleared for implant"],
        modules: {
          dentalAssessment: {
            teethStatus: { 36: { condition: "Missing" }, 37: { condition: "Missing" } },
            periodontalStatus: "Healthy",
            medicalDentalPrecautions: ["Diabetes"],
            plannedProcedures: [{ toothNumber: 36, procedure: "CBCT-Guided Osseointegrated Dental Implant", estimatedCost: 28000, status: "Planned" }],
          },
        },
      },
      {
        id: "dent-pat-5",
        uhid: "LUM-DNT-4105",
        name: "Tanvi Kulkarni",
        age: 19,
        gender: "Female",
        phone: "+91 98111 41005",
        bloodGroup: "AB+",
        conditions: ["Ellis Class II Enamel-Dentin Fracture #11"],
        address: "Kalyani Nagar, Pune 411006",
        diagnosis: "Crown Fracture Involving Enamel & Dentin without Pulp Exposure (#11)",
        icd10: "S02.5XXA",
        complaint: "Chipped upper right central incisor after sports fall with cold sensitivity",
        meds: [med("m-dnt-7", "Paracetamol 500 mg", "Analgesic", "500 mg", "SOS", 3)],
        advice: ["Vitality test positive; aesthetic nano-hybrid composite build-up done; review vitality at 6 weeks"],
        modules: {
          dentalAssessment: {
            teethStatus: { 11: { condition: "Restored", notes: "Layered aesthetic composite restoration" } },
            periodontalStatus: "Healthy",
            plannedProcedures: [{ toothNumber: 11, procedure: "Direct Aesthetic Composite Build-Up", estimatedCost: 2500, status: "Completed" }],
          },
        },
      },
    ],
  },
  {
    tenantId: "tenant-demo-therapist",
    doctorId: "doc-persona-therapist",
    doctorName: "Anika Bose, MPhil (Clinical Psychology)",
    regNumber: "RCI-2017-4410",
    specialty: "Psychiatry & Mental Health",
    sessionType: "Counseling session",
    fee: 1800,
    withMedicalRx: false,
    patients: [
      { id: "ther-pat-1", uhid: "LUM-THR-4201", name: "Siddharth Sengupta", age: 29, gender: "Male", phone: "+91 98111 42001", bloodGroup: "B+", conditions: ["Occupational Burnout & Generalized Anxiety — CBT Session 4", "GAD-7: 11 -> 6"], address: "HSR Layout, Bengaluru 560102", diagnosis: "Generalized Anxiety", icd10: "F41.1", complaint: "Work anxiety & sleep onset delay", meds: [], advice: [] },
      { id: "ther-pat-2", uhid: "LUM-THR-4202", name: "Nandita Chatterjee", age: 33, gender: "Female", phone: "+91 98111 42002", bloodGroup: "O+", conditions: ["Postpartum Adjustment & Maternal Stress Support", "EPDS: 9 (Monitor)"], address: "Jodhpur Park, Kolkata 700068", diagnosis: "Adjustment Reaction", icd10: "F43.2", complaint: "Postpartum overwhelm", meds: [], advice: [] },
      { id: "ther-pat-3", uhid: "LUM-THR-4203", name: "Raghavendra Rao", age: 41, gender: "Male", phone: "+91 98111 42003", bloodGroup: "A+", conditions: ["Panic Episodes in Traffic — Interoceptive Exposure CBT"], address: "Madhapur, Hyderabad 500081", diagnosis: "Panic Disorder", icd10: "F41.0", complaint: "Anticipatory panic", meds: [], advice: [] },
      { id: "ther-pat-4", uhid: "LUM-THR-4204", name: "Aditi & Kunal Deshmukh", age: 35, gender: "Female", phone: "+91 98111 42004", bloodGroup: "B+", conditions: ["Couple Communication & Boundary Therapy (Gottman Modality)"], address: "Baner, Pune 411045", diagnosis: "Relationship Counseling", icd10: "Z63.0", complaint: "Couple communication check-in", meds: [], advice: [] },
      { id: "ther-pat-5", uhid: "LUM-THR-4205", name: "Ishaan Malhotra", age: 21, gender: "Male", phone: "+91 98111 42005", bloodGroup: "O+", conditions: ["Exam Performance Anxiety & Structured Study Behavioral Activation"], address: "Vasant Kunj, New Delhi 110070", diagnosis: "Performance Anxiety", icd10: "F41.8", complaint: "Academic stress", meds: [], advice: [] },
    ],
  },
  {
    tenantId: "tenant-demo-wellness",
    doctorId: "doc-persona-wellness",
    doctorName: "Kavya Menon",
    regNumber: "SPA-DEMO-1001",
    specialty: "Wellness & Spas",
    sessionType: "Spa service",
    fee: 2500,
    withMedicalRx: false,
    patients: [
      { id: "well-pat-1", uhid: "LUM-SPA-4301", name: " Radhika Nair", age: 31, gender: "Female", phone: "+91 98111 43001", bloodGroup: "O+", conditions: ["Glow 4-Session Bridal Package (2/4 Done)", "Sensitive Skin — Fragrance-Free"], address: "Indiranagar, Bengaluru 560038", diagnosis: "Wellness", icd10: "Z00", complaint: "Hydra-glow facial", meds: [], advice: [] },
      { id: "well-pat-2", uhid: "LUM-SPA-4302", name: "Vikramaditya Singh", age: 38, gender: "Male", phone: "+91 98111 43002", bloodGroup: "B+", conditions: ["Relax 6-Session Deep Tissue & Sports Recovery Membership"], address: "Golf Course Road, Gurugram 122002", diagnosis: "Wellness", icd10: "Z00", complaint: "Deep tissue recovery", meds: [], advice: [] },
      { id: "well-pat-3", uhid: "LUM-SPA-4303", name: " Pallavi Joshi", age: 44, gender: "Female", phone: "+91 98111 43003", bloodGroup: "A+", conditions: ["Keratin Repair Hair Spa & Scalp Detox", "Avoid Nut Oils"], address: "Powai, Mumbai 400076", diagnosis: "Wellness", icd10: "Z00", complaint: "Hair spa", meds: [], advice: [] },
      { id: "well-pat-4", uhid: "LUM-SPA-4304", name: "Simran Kaur", age: 27, gender: "Female", phone: "+91 98111 43004", bloodGroup: "O+", conditions: ["Salon Annual Membership — Cut, Style & Gel Manicure"], address: "Sector 9, Chandigarh 160009", diagnosis: "Wellness", icd10: "Z00", complaint: "Salon membership", meds: [], advice: [] },
      { id: "well-pat-5", uhid: "LUM-SPA-4305", name: "Nikhil Bhatia", age: 46, gender: "Male", phone: "+91 98111 43005", bloodGroup: "AB+", conditions: ["Ayurvedic Abhyanga Warm Herbal Oil Stress Relief"], address: "Koregaon Park, Pune 411001", diagnosis: "Wellness", icd10: "Z00", complaint: "Abhyanga session", meds: [], advice: [] },
    ],
  },
  {
    tenantId: "tenant-demo-consultant",
    doctorId: "doc-persona-consultant",
    doctorName: "Aarav Mehta",
    regNumber: "CONSULT-DEMO-12",
    specialty: "Consulting",
    sessionType: "Advisory meeting",
    fee: 5000,
    withMedicalRx: false,
    patients: [
      { id: "cons-pat-1", uhid: "LUM-CNS-4401", name: "Anirudh Krishnan (Kaveri Diagnostics)", age: 42, gender: "Male", phone: "+91 98111 44001", bloodGroup: "O+", conditions: ["Monthly Retainer — Multi-Center Lab Operations Turnaround"], address: "Guindy, Chennai 600032", diagnosis: "Advisory", icd10: "Z00", complaint: "Ops audit", meds: [], advice: [] },
      { id: "cons-pat-2", uhid: "LUM-CNS-4402", name: "Divya Parekh (Lotus Daycare Clinics)", age: 36, gender: "Female", phone: "+91 98111 44002", bloodGroup: "B+", conditions: ["Series A Financial Model & Unit Economics Review"], address: "Lower Parel, Mumbai 400013", diagnosis: "Advisory", icd10: "Z00", complaint: "Pricing & unit economics", meds: [], advice: [] },
      { id: "cons-pat-3", uhid: "LUM-CNS-4403", name: "Saurabh Agarwal (MedSupply India)", age: 45, gender: "Male", phone: "+91 98111 44003", bloodGroup: "A+", conditions: ["Cold-Chain Vendor Contract & SLA Negotiation"], address: "Noida Sector 62, UP 201309", diagnosis: "Advisory", icd10: "Z00", complaint: "Contract review", meds: [], advice: [] },
      { id: "cons-pat-4", uhid: "LUM-CNS-4404", name: "Meghna Reddy (Prana Rehab)", age: 34, gender: "Female", phone: "+91 98111 44004", bloodGroup: "O+", conditions: ["Bengaluru & Hyderabad Clinic Expansion Playbook"], address: "Gachibowli, Hyderabad 500032", diagnosis: "Advisory", icd10: "Z00", complaint: "Expansion roadmap", meds: [], advice: [] },
      { id: "cons-pat-5", uhid: "LUM-CNS-4405", name: "Harish Nambiar (Arogya Optical)", age: 51, gender: "Male", phone: "+91 98111 44005", bloodGroup: "B+", conditions: ["Quarterly Board Deck & Store KPI Audit"], address: "MG Road, Kochi 682016", diagnosis: "Advisory", icd10: "Z00", complaint: "Quarterly KPI review", meds: [], advice: [] },
    ],
  },
  {
    tenantId: "tenant-demo-gpdoctor",
    doctorId: "doc-user-demo-gp",
    doctorName: "Dr. Demo GP",
    regNumber: "MCI-DEMO-5601",
    specialty: "General Medicine",
    sessionType: "New Consultation",
    fee: 600,
    withMedicalRx: true,
    patients: [
      { id: "gp56-pat-1", uhid: "LUM-GP56-5101", name: "Raghavendra Kulkarni", age: 53, gender: "Male", phone: "+91 98111 51001", bloodGroup: "B+", conditions: ["Type 2 Diabetes", "Essential Hypertension"], address: "Jayanagar, Bengaluru 560041", diagnosis: "Type 2 Diabetes Mellitus with Essential Hypertension", icd10: "E11.9", complaint: "Fasting sugar 148 mg/dL & routine BP refill", meds: [med("m-gp56-1", "Metformin SR 500mg + Glimepiride 1mg", "OHA", "1 Tablet", "1-0-1", 30, "Tablet", "Before Food"), med("m-gp56-2", "Telmisartan 40 mg", "ARB", "40 mg", "1-0-0", 30)], advice: ["40 mins daily walk; repeat HbA1c in 3 months"] },
      { id: "gp56-pat-2", uhid: "LUM-GP56-5102", name: "Shalini Tiwari", age: 29, gender: "Female", phone: "+91 98111 51002", bloodGroup: "O+", conditions: ["Acute Viral Febrile Illness — Dengue NS1 Screen"], address: "Aliganj, Lucknow 226024", diagnosis: "Acute Undifferentiated Febrile Illness", icd10: "R50.9", complaint: "High fever & body ache for 3 days", meds: [med("m-gp56-3", "Paracetamol 650 mg (Dolo 650)", "Antipyretic", "650 mg", "1-1-1", 5), med("m-gp56-4", "ORS (Electral)", "Hydration", "200 ml", "1-1-1", 5, "Syrup")], advice: ["Avoid NSAIDs; repeat CBC & platelet count tomorrow"] },
      { id: "gp56-pat-3", uhid: "LUM-GP56-5103", name: "Murlidhar Iyer", age: 62, gender: "Male", phone: "+91 98111 51003", bloodGroup: "A+", conditions: ["Acid Peptic Disease (GERD)", "Dyslipidemia"], address: "Mylapore, Chennai 600004", diagnosis: "Gastro-Esophageal Reflux Disease", icd10: "K21.9", complaint: "Post-meal retrosternal heartburn & sour eructation (2 weeks)", meds: [med("m-gp56-5", "Pantoprazole 40mg + Domperidone 30mg SR", "PPI + Prokinetic", "1 Capsule", "1-0-0", 21, "Capsule", "Empty Stomach")], advice: ["Early light dinner 2.5 hrs before sleep; elevate head-end"] },
      { id: "gp56-pat-4", uhid: "LUM-GP56-5104", name: "Preeti Chawla", age: 36, gender: "Female", phone: "+91 98111 51004", bloodGroup: "AB+", conditions: ["Primary Hypothyroidism", "Vitamin B12 Deficiency"], address: "Rajouri Garden, New Delhi 110027", diagnosis: "Primary Hypothyroidism with Nutritional B12 Deficiency", icd10: "E03.9", complaint: "Fatigue, hair fall & tingling in fingers", meds: [med("m-gp56-6", "Levothyroxine 50 mcg", "Thyroid Hormone", "50 mcg", "1-0-0", 60, "Tablet", "Empty Stomach"), med("m-gp56-7", "Methylcobalamin 1500 mcg", "Vitamin B12", "1 Tablet", "0-0-1", 45)], advice: ["Repeat TSH in 8 weeks"] },
      { id: "gp56-pat-5", uhid: "LUM-GP56-5105", name: "Imtiyaz Shaikh", age: 44, gender: "Male", phone: "+91 98111 51005", bloodGroup: "O+", conditions: ["Acute Uncomplicated Lower UTI"], address: "Camp, Pune 411001", diagnosis: "Acute Cystitis / Lower Urinary Tract Infection", icd10: "N30.00", complaint: "Burning micturition & frequency (3 days)", meds: [med("m-gp56-8", "Nitrofurantoin SR 100 mg (Niftas)", "Urinary Antiseptic", "100 mg", "1-0-1", 5), med("m-gp56-9", "Disodium Hydrogen Citrate Syrup", "Urinary Alkalinizer", "10 ml in water", "1-1-1", 5, "Syrup")], advice: ["3 litres oral fluids daily; send midstream urine C/S before first dose"] },
    ],
  },
  {
    tenantId: "tenant-demo-physiodoctor",
    doctorId: "doc-user-demo-physio",
    doctorName: "Dr. Demo Physio",
    regNumber: "IAP-DEMO-5602",
    specialty: "Physiotherapy & Rehabilitation",
    sessionType: "Rehab session",
    fee: 700,
    withMedicalRx: true,
    patients: [
      { id: "phy56-pat-1", uhid: "LUM-PH56-5201", name: "Gaurav Deshmukh", age: 35, gender: "Male", phone: "+91 98111 52001", bloodGroup: "O+", conditions: ["Mechanical Low Back Pain — Core Stabilization Pack"], address: "Wakad, Pune 411057", diagnosis: "Lumbar Myofascial Strain with Postural Dysfunction", icd10: "M54.5", complaint: "Lower back stiffness after 10-hr IT desk shift (VAS 5/10)", meds: [], advice: ["McKenzie prone extensions + ergonomic lumbar roll every hour"], modules: { physiotherapyAssessment: { vasPainScore: 5, painType: "Aching", jointRomFindings: [{ joint: "Lumbar Spine", movement: "Flexion", degrees: "65° (Mildly Restricted)", endFeel: "Capsular / Firm" }], muscleStrengthMmt: [{ muscleGroup: "Transversus Abdominis & Gluteus Medius", grade: "4/5 (Good)" }], gaitAndPosture: "Loss of lumbar lordosis on sitting", specialOrthopedicTests: [{ testName: "Straight Leg Raise (SLR)", result: "Negative (-)" }], functionalGoals: ["Pain-free 60-min sitting"] } } },
      { id: "phy56-pat-2", uhid: "LUM-PH56-5202", name: "Sudha Murthy Rao", age: 56, gender: "Female", phone: "+91 98111 52002", bloodGroup: "B+", conditions: ["Left Frozen Shoulder Stage II Rehab"], address: "Basavanagudi, Bengaluru 560004", diagnosis: "Adhesive Capsulitis Left Shoulder", icd10: "M75.02", complaint: "Difficulty reaching behind back & combing hair (VAS 6/10)", meds: [], advice: ["Moist heat 15 mins before Codman pendulum & wand exercises"], modules: { physiotherapyAssessment: { vasPainScore: 6, painType: "Aching", jointRomFindings: [{ joint: "Left Shoulder", movement: "Abduction", degrees: "95° (Capsular)", endFeel: "Capsular / Firm" }], muscleStrengthMmt: [{ muscleGroup: "Rotator Cuff", grade: "4/5 (Good)" }], gaitAndPosture: "Scapular hiking on elevation", specialOrthopedicTests: [{ testName: "Hawkins-Kennedy", result: "Equivocal" }], functionalGoals: ["Overhead reach >150°"] } } },
      { id: "phy56-pat-3", uhid: "LUM-PH56-5203", name: "Arjun Nair", age: 24, gender: "Male", phone: "+91 98111 52003", bloodGroup: "A+", conditions: ["Post-ACL Reconstruction Week 6 Rehab"], address: "Kakkanad, Kochi 682030", diagnosis: "Post-Arthroscopic Right ACL Reconstruction — Phase II Rehab", icd10: "Z96.651", complaint: "Quadriceps activation & closed-chain knee flexion progression", meds: [], advice: ["Closed-kinetic-chain mini squats 0–45° & stationary cycling"], modules: { physiotherapyAssessment: { vasPainScore: 2, painType: "Dull / Throbbing", jointRomFindings: [{ joint: "Right Knee", movement: "Flexion", degrees: "0° - 115°", endFeel: "Capsular / Firm" }], muscleStrengthMmt: [{ muscleGroup: "Right Quadriceps (VMO)", grade: "4/5 (Good)" }], gaitAndPosture: "Independent FWB without crutches", specialOrthopedicTests: [{ testName: "Lachman Graft Firm End-Point", result: "Negative (-)" }], functionalGoals: ["Full 135° flexion by Week 8"] } } },
      { id: "phy56-pat-4", uhid: "LUM-PH56-5204", name: "Bhavana Shah", age: 42, gender: "Female", phone: "+91 98111 52004", bloodGroup: "O+", conditions: ["Right Lateral Epicondylitis (Tennis Elbow)"], address: "Satellite, Ahmedabad 380015", diagnosis: "Right Lateral Epicondylitis", icd10: "M77.11", complaint: "Lateral elbow pain while wringing cloth & lifting pan (VAS 5/10)", meds: [], advice: ["Counterforce forearm strap + eccentric wrist extensor loading"], modules: { physiotherapyAssessment: { vasPainScore: 5, painType: "Sharp / Shooting", jointRomFindings: [{ joint: "Right Wrist", movement: "Extension", degrees: "60° (Painful Resisted)", endFeel: "Normal" }], muscleStrengthMmt: [{ muscleGroup: "ECRB / Wrist Extensors", grade: "4/5 (Good)" }], gaitAndPosture: "Normal", specialOrthopedicTests: [{ testName: "Cozen's Test", result: "Positive (+)" }], functionalGoals: ["Pain-free grip strength"] } } },
      { id: "phy56-pat-5", uhid: "LUM-PH56-5205", name: "Natarajan Sundar", age: 63, gender: "Male", phone: "+91 98111 52005", bloodGroup: "AB+", conditions: ["Cervical Spondylosis with Upper Trapezius Trigger Points"], address: "Adyar, Chennai 600020", diagnosis: "Cervical Spondylosis without Myelopathy", icd10: "M47.812", complaint: "Neck stiffness on turning head while driving (VAS 4/10)", meds: [], advice: ["Deep cervical flexor chin-tucks 3x10 daily; thin contour pillow"], modules: { physiotherapyAssessment: { vasPainScore: 4, painType: "Aching", jointRomFindings: [{ joint: "Cervical Spine", movement: "Right Rotation", degrees: "55°", endFeel: "Capsular / Firm" }], muscleStrengthMmt: [{ muscleGroup: "Deep Neck Flexors", grade: "3/5 (Fair - Anti-gravity)" }], gaitAndPosture: "Forward head posture", specialOrthopedicTests: [{ testName: "Spurling's Test", result: "Negative (-)" }], functionalGoals: ["Symmetric 75° cervical rotation"] } } },
    ],
  },
  {
    tenantId: "tenant-demo-dentistdoctor",
    doctorId: "doc-user-demo-dentist",
    doctorName: "Dr. Demo Dentist",
    regNumber: "DCI-DEMO-5603",
    specialty: "Dental Surgery",
    sessionType: "Dental examination",
    fee: 650,
    withMedicalRx: true,
    patients: [
      { id: "dnt56-pat-1", uhid: "LUM-DN56-5301", name: "Vivek Oberoi Nair", age: 31, gender: "Male", phone: "+91 98111 53001", bloodGroup: "O+", conditions: ["Deep Occlusal Caries #46 — Composite Restoration"], address: "Indiranagar, Bengaluru 560038", diagnosis: "Reversible Pulpitis Secondary to Dentinal Caries (#46)", icd10: "K02.52", complaint: "Transient sensitivity to sweet & cold in lower right molar", meds: [med("m-dn56-1", "Potassium Nitrate Medicated Toothpaste", "Desensitizer", "Brush BD", "1-0-1", 30, "Ointment")], advice: ["Avoid sticky sweets; 6-month recall"], modules: { dentalAssessment: { teethStatus: { 46: { condition: "Restored", notes: "GIC base + composite restoration" } }, periodontalStatus: "Healthy", plannedProcedures: [{ toothNumber: 46, procedure: "Class I Composite Restoration", estimatedCost: 1500, status: "Completed" }] } } },
      { id: "dnt56-pat-2", uhid: "LUM-DN56-5302", name: "Anjali Kulkarni", age: 28, gender: "Female", phone: "+91 98111 53002", bloodGroup: "B+", conditions: ["RCT Completed #26 — Crown Impression"], address: "Kothrud, Pune 411038", diagnosis: "Pulpless Tooth #26 Post-Endodontic Obturation", icd10: "K04.1", complaint: "Crown preparation visit for RCT-treated upper molar #26", meds: [med("m-dn56-2", "Ibuprofen 400 mg", "Analgesic", "400 mg", "SOS", 2)], advice: ["Temporary crown placed; avoid chewing sticky foods"], modules: { dentalAssessment: { teethStatus: { 26: { condition: "Crown", notes: "PFM / Zirconia crown prep done" } }, periodontalStatus: "Healthy", plannedProcedures: [{ toothNumber: 26, procedure: "CAD-CAM Zirconia Crown", estimatedCost: 6500, status: "In Progress" }] } } },
      { id: "dnt56-pat-3", uhid: "LUM-DN56-5303", name: "Ramesh Babu", age: 50, gender: "Male", phone: "+91 98111 53003", bloodGroup: "A+", conditions: ["Chronic Gingivitis & Ultrasonic Scaling"], address: "Secunderabad, Telangana 500003", diagnosis: "Plaque-Induced Chronic Generalized Gingivitis", icd10: "K05.10", complaint: "Gum bleeding & tea stains", meds: [med("m-dn56-3", "Chlorhexidine 0.12% Mouthwash", "Antiseptic", "10 ml", "1-0-1", 10, "Syrup")], advice: ["Modified Bass brushing technique + interdental brush"], modules: { dentalAssessment: { teethStatus: {}, periodontalStatus: "Gingivitis", plaqueCalculusIndex: "Moderate", plannedProcedures: [{ procedure: "Ultrasonic Scaling & Polishing", estimatedCost: 1500, status: "Completed" }] } } },
      { id: "dnt56-pat-4", uhid: "LUM-DN56-5304", name: "Zoya Merchant", age: 23, gender: "Female", phone: "+91 98111 53004", bloodGroup: "O+", conditions: ["Orthodontic Clear Aligner Review"], address: "Colaba, Mumbai 400005", diagnosis: "Mild Anterior Crowding", icd10: "M26.31", complaint: "Aligner Tray #6 fit check", meds: [], advice: ["Wear aligners 22 hrs/day"], modules: { dentalAssessment: { teethStatus: {}, periodontalStatus: "Healthy", plannedProcedures: [{ procedure: "Aligner Refinement Check", estimatedCost: 2000, status: "In Progress" }] } } },
      { id: "dnt56-pat-5", uhid: "LUM-DN56-5305", name: "Harगोविंद Joshi", age: 64, gender: "Male", phone: "+91 98111 53005", bloodGroup: "B+", conditions: ["Mobility Grade III #41 — Atraumatic Extraction (On Aspirin)"], address: "C-Scheme, Jaipur 302001", diagnosis: "Localized Severe Chronic Periodontitis (#41)", icd10: "K05.32", complaint: "Loose lower front tooth hurting on biting", meds: [med("m-dn56-4", "Amoxicillin 500 mg", "Antibiotic", "500 mg", "1-1-1", 5), med("m-dn56-5", "Paracetamol 650 mg", "Analgesic", "650 mg", "1-0-1", 3)], advice: ["Local hemostatic gel + suture placed; bite gauze 45 mins; soft cold diet today"], modules: { dentalAssessment: { teethStatus: { 41: { condition: "Extraction Needed", notes: "Grade III mobile" } }, periodontalStatus: "Severe Bone Loss", medicalDentalPrecautions: ["Antiplatelets", "Hypertension"], plannedProcedures: [{ toothNumber: 41, procedure: "Atraumatic Extraction with Hemostasis", estimatedCost: 1200, status: "Completed" }] } } },
    ],
  },
  {
    tenantId: "tenant-demo-spadoctor",
    doctorId: "doc-user-demo-spa",
    doctorName: "Dr. Demo Spa",
    regNumber: "SPA-DEMO-5604",
    specialty: "Wellness & Spas",
    sessionType: "Spa service",
    fee: 2200,
    withMedicalRx: false,
    patients: [
      { id: "spa56-pat-1", uhid: "LUM-SP56-5401", name: "Niharika Sen", age: 29, gender: "Female", phone: "+91 98111 54001", bloodGroup: "O+", conditions: ["Glow 4-Session Facial Membership (3/4)"], address: "Park Street, Kolkata 700016", diagnosis: "Wellness", icd10: "Z00", complaint: "Brightening facial", meds: [], advice: [] },
      { id: "spa56-pat-2", uhid: "LUM-SP56-5402", name: "Karanvir Malhotra", age: 37, gender: "Male", phone: "+91 98111 54002", bloodGroup: "B+", conditions: ["Relax 6-Session Deep Tissue Package"], address: "Defence Colony, New Delhi 110024", diagnosis: "Wellness", icd10: "Z00", complaint: "Back & shoulder massage", meds: [], advice: [] },
      { id: "spa56-pat-3", uhid: "LUM-SP56-5403", name: "Aishwarya Menon", age: 33, gender: "Female", phone: "+91 98111 54003", bloodGroup: "A+", conditions: ["Moroccan Argan Hair Spa — Henna Free"], address: "Indiranagar, Bengaluru 560038", diagnosis: "Wellness", icd10: "Z00", complaint: "Hair spa", meds: [], advice: [] },
      { id: "spa56-pat-4", uhid: "LUM-SP56-5404", name: "Rituja Deshpande", age: 41, gender: "Female", phone: "+91 98111 54004", bloodGroup: "AB+", conditions: ["Classic Manicure & Pedicure Membership"], address: "Aundh, Pune 411007", diagnosis: "Wellness", icd10: "Z00", complaint: "Manicure / pedicure", meds: [], advice: [] },
      { id: "spa56-pat-5", uhid: "LUM-SP56-5405", name: "Devansh Patel", age: 30, gender: "Male", phone: "+91 98111 54005", bloodGroup: "O+", conditions: ["Cut, Beard Grooming & Detan Ritual"], address: "Bodakdev, Ahmedabad 380054", diagnosis: "Wellness", icd10: "Z00", complaint: "Cut & style", meds: [], advice: [] },
    ],
  },
];

export function seedAllDemoSpecialtyClinicalData(database: SqlDatabase, nowDate = new Date()): void {
  const now = nowDate.toISOString();
  const today = clinicCalendarDate(nowDate);
  const followUp14 = shiftIsoDate(today, 14);
  ensureImmunizationSchema(database);

  // Clean up any legacy hyphenated pack-alias demo rows from older local DBs
  for (const staleTenant of [
    "tenant-demo-gp-doctor",
    "tenant-demo-physio-doctor",
    "tenant-demo-dentist-doctor",
    "tenant-demo-spa-doctor",
  ]) {
    database.prepare("DELETE FROM prescriptions WHERE tenant_id = ?").run(staleTenant);
    database.prepare("DELETE FROM appointments WHERE tenant_id = ?").run(staleTenant);
    database.prepare("DELETE FROM patients WHERE tenant_id = ?").run(staleTenant);
  }

  const insertPatient = database.prepare(
    `INSERT INTO patients (
       id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions,
       emergency_contact, address, last_visit, created_at, date_of_birth
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM patients WHERE id = ? OR uhid = ?)`
  );

  const enrichPatient = database.prepare(
    `UPDATE patients
     SET date_of_birth = CASE WHEN COALESCE(date_of_birth, '') = '' THEN ? ELSE date_of_birth END,
         blood_group = ?,
         allergies = CASE WHEN COALESCE(allergies, '[]') = '[]' THEN ? ELSE allergies END,
         chronic_conditions = CASE WHEN COALESCE(chronic_conditions, '[]') = '[]' THEN ? ELSE chronic_conditions END,
         address = CASE WHEN COALESCE(address, '') = '' THEN ? ELSE address END,
         email = CASE WHEN COALESCE(email, '') = '' THEN ? ELSE email END,
         emergency_contact = CASE WHEN COALESCE(emergency_contact, '') = '' THEN ? ELSE emergency_contact END
     WHERE id = ? AND tenant_id = ?`
  );

  const upsertPatientSpec = (p: SeedPatientSpec) => {
    const dob = p.dateOfBirth || (typeof p.dobOffsetDays === "number" ? shiftIsoDate(today, p.dobOffsetDays) : "");
    const allergiesJson = JSON.stringify(p.allergies);
    const chronicJson = JSON.stringify(p.chronicConditions);
    const emergency = p.emergencyContact || p.phone;
    insertPatient.run(
      p.id,
      p.tenantId,
      p.uhid,
      p.name,
      p.age,
      p.gender,
      p.phone,
      p.email,
      p.bloodGroup,
      allergiesJson,
      chronicJson,
      emergency,
      p.address,
      today,
      now,
      dob,
      p.id,
      p.uhid
    );
    enrichPatient.run(dob, p.bloodGroup, allergiesJson, chronicJson, p.address, p.email, emergency, p.id, p.tenantId);
  };

  const insertRxStmt = database.prepare(
    `INSERT INTO prescriptions (
       id, tenant_id, rx_number, patient_id, patient_name, patient_phone, patient_uhid,
       patient_age, patient_gender, doctor_id, doctor_name, doctor_specialty, doctor_reg_number,
       date, diagnosis, icd10_code, chief_complaints, medicines, lab_tests, advice,
       diet_instructions, follow_up_date, pdf_url, created_at, vitals, clinic_name,
       specialty_type, specialty_modules
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM prescriptions WHERE id = ? OR rx_number = ?)`
  );
  const insertRx = {
    run: (...args: unknown[]) => {
      const rxNumber = args[2];
      return insertRxStmt.run(...(args as Array<string | number | null>), String(rxNumber));
    },
  };

  const insertLab = database.prepare(
    `INSERT INTO lab_reports (
       id, tenant_id, patient_id, patient_uhid, patient_name, date, lab_name,
       category, doctor_interpretation, results, created_at
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM lab_reports WHERE id = ?)`
  );

  const insertSeedVisit = database.prepare(
    `INSERT INTO appointments (
       id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid,
       doctor_id, doctor_name, specialty, date, time_slot, type, status, source,
       consultation_fee, is_paid, vitals, created_at
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Walk-in', ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM appointments WHERE id = ?)`
  );

  const refreshPolyclinicVisitDate = database.prepare(
    `UPDATE appointments SET date = ?, token_number = ? WHERE id = ? AND tenant_id = ? AND date != ?`
  );

  // 1. Enrich Individual Practice (doctor@lumera.me, reception@, receptionist@, patient@) — 5 patients + 5 Rx + 3 Labs
  database
    .prepare("UPDATE users SET patient_id = 'ind-pat-rajiv' WHERE lower(email) = 'patient@lumera.me' AND COALESCE(patient_id, '') = ''")
    .run();
  const individualPatients: SeedPatientSpec[] = [
    { id: "ind-pat-rajiv", tenantId: "tenant-demo-individual", uhid: "LUM-IND-0106", name: "Rajiv Saxena", age: 44, dateOfBirth: "1982-05-14", gender: "Male", phone: "+91 98111 01061", email: "rajiv.saxena@demo.lumera.in", bloodGroup: "B+", allergies: ["Dust", "Sulfa"], chronicConditions: ["Seasonal Allergic Rhinitis", "Borderline Dyslipidemia"], address: "C-18 Hauz Khas, New Delhi 110016" },
    { id: "ind-pat-sunita", tenantId: "tenant-demo-individual", uhid: "LUM-IND-0107", name: "Sunita Roy", age: 38, dateOfBirth: "1988-09-22", gender: "Female", phone: "+91 98111 01062", email: "sunita.roy@demo.lumera.in", bloodGroup: "O+", allergies: [], chronicConditions: ["Type 2 Diabetes Mellitus", "Primary Hypothyroidism"], address: "Salt Lake Sector I, Kolkata 700064" },
    { id: "ind-pat-3", tenantId: "tenant-demo-individual", uhid: "LUM-IND-0108", name: "Asha Menon", age: 29, dateOfBirth: "1997-02-11", gender: "Female", phone: "+91 98400 12003", email: "asha.menon@demo.lumera.in", bloodGroup: "A+", allergies: [], chronicConditions: ["Nutritional Iron Deficiency Anemia", "Episodic Migraine"], address: "Indiranagar, Bengaluru 560038" },
    { id: "ind-pat-4", tenantId: "tenant-demo-individual", uhid: "LUM-IND-0109", name: "Karthik Rao", age: 51, dateOfBirth: "1975-07-03", gender: "Male", phone: "+91 98400 12004", email: "karthik.rao@demo.lumera.in", bloodGroup: "AB+", allergies: ["Ibuprofen"], chronicConditions: ["Essential Hypertension", "Grade I Fatty Liver (MASLD)"], address: "Mylapore, Chennai 600004" },
    { id: "ind-pat-5", tenantId: "tenant-demo-individual", uhid: "LUM-IND-0110", name: "Meera Shah", age: 33, dateOfBirth: "1993-11-29", gender: "Female", phone: "+91 98400 12005", email: "meera.shah@demo.lumera.in", bloodGroup: "O+", allergies: [], chronicConditions: ["Acute Tropical Febrile Illness (Dengue Triage)"], address: "Navrangpura, Ahmedabad 380009" },
  ];
  for (const p of individualPatients) upsertPatientSpec(p);

  individualPatients.slice(1).forEach((p, idx) => {
    const id = `ind-apt-${idx + 2}`;
    const token = allocateTokenNumber(database, p.tenantId, today, "doc-persona-gp", 10 + idx);
    insertSeedVisit.run(
      id,
      p.tenantId,
      token,
      p.id,
      p.name,
      p.phone,
      p.uhid,
      "doc-persona-gp",
      "Dr. Vikram Malhotra",
      "General Medicine",
      today,
      ["10:30 AM", "11:00 AM", "11:30 AM", "04:00 PM"][idx],
      "New Consultation",
      "Waiting",
      600,
      0,
      JSON.stringify(defaultVitals()),
      now,
      id
    );
  });

  const individualExtraRx: Array<{ pat: SeedPatientSpec; id: string; rxNo: string; dx: string; icd: string; cc: string[]; meds: Array<Record<string, unknown>> }> = [
    { pat: individualPatients[1], id: "ind-rx-2", rxNo: "RX-IND-DEMO-0002", dx: "Type 2 Diabetes Mellitus with Primary Hypothyroidism", icd: "E11.9", cc: ["3-month HbA1c & thyroid review"], meds: [med("m-ind-2a", "Metformin SR 500 mg", "Biguanide", "500 mg", "1-0-1", 30), med("m-ind-2b", "Levothyroxine 50 mcg", "Thyroid", "50 mcg", "1-0-0", 60, "Tablet", "Empty Stomach")] },
    { pat: individualPatients[2], id: "ind-rx-3", rxNo: "RX-IND-DEMO-0003", dx: "Iron Deficiency Anemia with Vitamin D Deficiency", icd: "D50.9", cc: ["Fatigue, hair fall & pallor (1 month)"], meds: [med("m-ind-3a", "Ferrous Ascorbate + Folic Acid", "Iron 100mg", "1 Tablet", "1-0-0", 60), med("m-ind-3b", "Cholecalciferol 60K IU", "Vitamin D3", "1 Capsule", "Once a week", 56, "Capsule")] },
    { pat: individualPatients[3], id: "ind-rx-4", rxNo: "RX-IND-DEMO-0004", dx: "Essential Hypertension with Metabolic Fatty Liver", icd: "I10", cc: ["Home BP 144/90 mmHg & USG Grade I fatty liver"], meds: [med("m-ind-4a", "Telmisartan 40 mg", "ARB", "40 mg", "1-0-0", 30), med("m-ind-4b", "Vitamin E 400 IU", "Antioxidant", "400 IU", "0-1-0", 30, "Capsule")] },
    { pat: individualPatients[4], id: "ind-rx-5", rxNo: "RX-IND-DEMO-0005", dx: "Acute Undifferentiated Febrile Illness — Rule Out Dengue", icd: "A97.9", cc: ["High fever 101.8°F & retro-orbital myalgia (3 days)"], meds: [med("m-ind-5a", "Paracetamol 650 mg (Dolo 650)", "Antipyretic", "650 mg", "1-1-1", 5), med("m-ind-5b", "ORS (Electral)", "Hydration", "200 ml", "1-1-1", 5, "Syrup")] },
  ];
  for (const r of individualExtraRx) {
    insertRx.run(
      r.id,
      r.pat.tenantId,
      r.rxNo,
      r.pat.id,
      r.pat.name,
      r.pat.phone,
      r.pat.uhid,
      r.pat.age,
      r.pat.gender,
      "doc-persona-gp",
      "Dr. Vikram Malhotra",
      "General Medicine",
      "MCI-2012-74892",
      today,
      r.dx,
      r.icd,
      JSON.stringify(r.cc),
      JSON.stringify(r.meds),
      "[]",
      JSON.stringify(["Follow low-salt home-cooked balanced Indian diet", "Review with lab reports"]),
      followUp14,
      `/api/emr/prescription/${r.id}/pdf`,
      now,
      JSON.stringify(defaultVitals()),
      "Malhotra Individual Practice",
      "General Medicine",
      JSON.stringify({ historyOfPresentIllness: r.cc.join("; "), riskLevel: "Low" }),
      r.id
    );
  }

  insertLab.run(
    "ind-lab-rajiv-1",
    "tenant-demo-individual",
    "ind-pat-rajiv",
    "LUM-IND-0106",
    "Rajiv Saxena",
    today,
    "Malhotra Clinic Diagnostics",
    "Lipid Profile",
    "Borderline elevated LDL-C (134 mg/dL); lifestyle modification advised.",
    JSON.stringify([
      { param: "Total Cholesterol", value: 206, unit: "mg/dL", normalRange: "< 200", status: "High" },
      { param: "LDL Cholesterol", value: 134, unit: "mg/dL", normalRange: "< 100", status: "High" },
      { param: "HbA1c", value: 5.5, unit: "%", normalRange: "< 5.7", status: "Normal" },
    ]),
    now,
    "ind-lab-rajiv-1"
  );
  insertLab.run(
    "ind-lab-sunita-1",
    "tenant-demo-individual",
    "ind-pat-sunita",
    "LUM-IND-0107",
    "Sunita Roy",
    today,
    "Malhotra Clinic Diagnostics",
    "Metabolic & Diabetes",
    "Good glycemic & thyroid control on Metformin SR 500 + Levothyroxine 50 mcg.",
    JSON.stringify([
      { param: "HbA1c", value: 6.8, unit: "%", normalRange: "< 7.0", status: "Normal" },
      { param: "TSH", value: 2.6, unit: "mIU/L", normalRange: "0.4 - 4.2", status: "Normal" },
    ]),
    now,
    "ind-lab-sunita-1"
  );

  // 2. Polyclinic Specialty Roster (5 dummy patients + visits + 5 Rx + labs for EACH of the 7 specialties!)
  const poly = buildPolyclinicSpecialtyRoster(today);
  const polyPatById = new Map(poly.patients.map((p) => [p.id, p]));
  for (const p of poly.patients) upsertPatientSpec(p);

  for (const v of poly.visits) {
    const p = polyPatById.get(v.patientId)!;
    const visitDate = shiftIsoDate(today, v.dayOffset);
    const token = allocateTokenNumber(database, p.tenantId, visitDate, v.doctorId, 2100);
    insertSeedVisit.run(
      v.id,
      p.tenantId,
      token,
      p.id,
      p.name,
      p.phone,
      p.uhid,
      v.doctorId,
      v.doctorName,
      v.specialty,
      visitDate,
      v.slot,
      v.type,
      v.status,
      v.fee,
      v.status === "Completed" ? 1 : 0,
      JSON.stringify(v.vitals),
      now,
      v.id
    );
    const nextToken = allocateTokenNumber(database, p.tenantId, visitDate, v.doctorId, 2100, v.id);
    refreshPolyclinicVisitDate.run(visitDate, nextToken, v.id, p.tenantId, visitDate);
  }
  database
    .prepare(
      "UPDATE appointments SET status = 'Confirmed' WHERE id = 'spec-poly-apt-gyne-2' AND tenant_id = 'tenant-demo-polyclinic' AND status = 'Waiting'"
    )
    .run();

  const refreshPolyclinicRx = database.prepare(
    `UPDATE prescriptions
     SET diagnosis = ?, icd10_code = ?, chief_complaints = ?, medicines = ?, lab_tests = ?,
         advice = ?, specialty_modules = ?, date = ?, follow_up_date = ?
     WHERE id = ? AND tenant_id = ?`
  );

  for (const rx of poly.prescriptions) {
    const p = polyPatById.get(rx.patientId)!;
    const ccJson = JSON.stringify(rx.chiefComplaints);
    const medsJson = JSON.stringify(rx.medicines);
    const labsJson = JSON.stringify(rx.labTests || []);
    const adviceJson = JSON.stringify(rx.advice);
    const modulesJson = JSON.stringify(rx.modules);
    insertRx.run(
      rx.id,
      rx.tenantId,
      rx.rxNumber,
      p.id,
      p.name,
      p.phone,
      p.uhid,
      p.age,
      p.gender,
      rx.doctorId,
      rx.doctorName,
      rx.doctorSpecialty,
      rx.doctorRegNumber,
      today,
      rx.diagnosis,
      rx.icd10Code,
      ccJson,
      medsJson,
      labsJson,
      adviceJson,
      followUp14,
      `/api/emr/prescription/${rx.id}/pdf`,
      now,
      JSON.stringify(rx.vitals),
      "Iyer City Polyclinic",
      rx.specialtyType,
      modulesJson,
      rx.id
    );
    if (rx.doctorId === "doc-persona-gynae") {
      refreshPolyclinicRx.run(
        rx.diagnosis,
        rx.icd10Code,
        ccJson,
        medsJson,
        labsJson,
        adviceJson,
        modulesJson,
        today,
        followUp14,
        rx.id,
        rx.tenantId
      );
    }
  }

  const refreshPolyclinicLab = database.prepare(
    `UPDATE lab_reports
     SET date = ?, lab_name = ?, category = ?, doctor_interpretation = ?, results = ?
     WHERE id = ? AND tenant_id = ?`
  );

  for (const lab of poly.labs) {
    const resultsJson = JSON.stringify(lab.results);
    insertLab.run(
      lab.id,
      lab.tenantId,
      lab.patientId,
      lab.uhid,
      lab.patientName,
      today,
      lab.labName,
      lab.category,
      lab.interpretation,
      resultsJson,
      now,
      lab.id
    );
    if (lab.id.startsWith("spec-lab-gyn-")) {
      refreshPolyclinicLab.run(
        today,
        lab.labName,
        lab.category,
        lab.interpretation,
        resultsJson,
        lab.id,
        lab.tenantId
      );
    }
  }

  // Seed 5 Ob/Gyn Invoices for Dr. Shalini Mukhopadhyay (doc-persona-gynae, tenant-demo-polyclinic)
  const insertInvoice = database.prepare(
    `INSERT INTO invoices (
       id, tenant_id, invoice_number, appointment_id, patient_id, patient_name, patient_phone, patient_uhid,
       date, items, subtotal, discount_amount, gstin, gst_percent, tax_amount, total_amount, paid_amount,
       status, payment_mode, payment_ref, issued_by, consulting_doctor_id, consulting_doctor_name,
       receipt_whatsapp_status, created_at, paid_at
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', 0, 0, ?, ?, ?, ?, ?, 'Polyclinic Billing Desk', ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE id = ? OR (tenant_id = ? AND invoice_number = ?))`
  );
  const refreshTodayPaidInvoice = database.prepare(
    `UPDATE invoices SET date = ?, paid_at = ? WHERE id = ? AND tenant_id = ?`
  );

  const gynaeInvoices: Array<{
    id: string;
    invoiceNo: string;
    aptId: string;
    patientId: string;
    dayOffset: number;
    status: "Paid" | "Unpaid";
    paymentMode: string;
    paymentRef: string;
    items: Array<{
      id: string;
      description: string;
      category: string;
      hsnSacCode: string;
      quantity: number;
      unitPrice: number;
      gstPercent: number;
      total: number;
    }>;
  }> = [
    {
      id: "inv-gyn-1",
      invoiceNo: "INV-2026-GYN001",
      aptId: "spec-poly-apt-gyne-4",
      patientId: "gynae-pat-pooja",
      dayOffset: 0,
      status: "Paid",
      paymentMode: "UPI",
      paymentRef: "UPI-4289102441",
      items: [
        { id: "li-gyn-1a", description: "ANC 1st Trimester Booking & Dual Marker Package", category: "Package", hsnSacCode: "9993", quantity: 1, unitPrice: 2200, gstPercent: 0, total: 2200 },
        { id: "li-gyn-1b", description: "Obstetric Specialist Consultation (Dr. Shalini Mukhopadhyay)", category: "Consultation", hsnSacCode: "9993", quantity: 1, unitPrice: 800, gstPercent: 0, total: 800 },
      ],
    },
    {
      id: "inv-gyn-2",
      invoiceNo: "INV-2026-GYN002",
      aptId: "spec-poly-apt-gyne-2",
      patientId: "gynae-pat-kavya",
      dayOffset: 0,
      status: "Paid",
      paymentMode: "UPI",
      paymentRef: "UPI-4289102782",
      items: [
        { id: "li-gyn-2a", description: "Follicular Monitoring TVS Series (CD9 / CD12 / CD14)", category: "Package", hsnSacCode: "9993", quantity: 1, unitPrice: 2400, gstPercent: 0, total: 2400 },
        { id: "li-gyn-2b", description: "Fertility & Ovulation Induction Consultation", category: "Consultation", hsnSacCode: "9993", quantity: 1, unitPrice: 800, gstPercent: 0, total: 800 },
      ],
    },
    {
      id: "inv-gyn-3",
      invoiceNo: "INV-2026-GYN003",
      aptId: "spec-poly-apt-gyne-3",
      patientId: "gynae-pat-rekha",
      dayOffset: -2,
      status: "Paid",
      paymentMode: "Card",
      paymentRef: "POS-HDFC-8812",
      items: [
        { id: "li-gyn-3a", description: "Diagnostic Video Colposcopy", category: "Procedure", hsnSacCode: "9993", quantity: 1, unitPrice: 1800, gstPercent: 0, total: 1800 },
        { id: "li-gyn-3b", description: "Liquid-Based Cytology (LBC Pap) + HPV 16/18 Co-Test", category: "Lab", hsnSacCode: "9993", quantity: 1, unitPrice: 1400, gstPercent: 0, total: 1400 },
        { id: "li-gyn-3c", description: "Gynaecology Specialist Consultation", category: "Consultation", hsnSacCode: "9993", quantity: 1, unitPrice: 800, gstPercent: 0, total: 800 },
      ],
    },
    {
      id: "inv-gyn-4",
      invoiceNo: "INV-2026-GYN004",
      aptId: "spec-poly-apt-gyne-6",
      patientId: "gynae-pat-anjali",
      dayOffset: 0,
      status: "Unpaid",
      paymentMode: "",
      paymentRef: "",
      items: [
        { id: "li-gyn-4a", description: "Cardiotocography Non-Stress Test (NST)", category: "Procedure", hsnSacCode: "9993", quantity: 1, unitPrice: 900, gstPercent: 0, total: 900 },
        { id: "li-gyn-4b", description: "Fetal Growth & Umbilical Artery Doppler USG", category: "Lab", hsnSacCode: "9993", quantity: 1, unitPrice: 1600, gstPercent: 0, total: 1600 },
        { id: "li-gyn-4c", description: "High-Risk Obstetric Consultation (PIH Surveillance)", category: "Consultation", hsnSacCode: "9993", quantity: 1, unitPrice: 800, gstPercent: 0, total: 800 },
      ],
    },
    {
      id: "inv-gyn-5",
      invoiceNo: "INV-2026-GYN005",
      aptId: "spec-poly-apt-gyne-7",
      patientId: "gynae-pat-sneha",
      dayOffset: 0,
      status: "Paid",
      paymentMode: "Cash",
      paymentRef: "CASH-REC-904",
      items: [
        { id: "li-gyn-5a", description: "Postnatal Day-10 OPD Gynaecology & Lactation Consultation", category: "Consultation", hsnSacCode: "9993", quantity: 1, unitPrice: 800, gstPercent: 0, total: 800 },
        { id: "li-gyn-5b", description: "Aseptic LSCS Pfannenstiel Scar Inspection & Dressing", category: "Nursing", hsnSacCode: "9993", quantity: 1, unitPrice: 450, gstPercent: 0, total: 450 },
      ],
    },
  ];

  for (const inv of gynaeInvoices) {
    const p = polyPatById.get(inv.patientId)!;
    const invDate = shiftIsoDate(today, inv.dayOffset);
    const total = inv.items.reduce((sum, item) => sum + item.total, 0);
    const paidAmount = inv.status === "Paid" ? total : 0;
    const paidAt =
      inv.status === "Paid"
        ? inv.dayOffset === 0
          ? now
          : `${invDate}T11:15:00.000Z`
        : null;
    insertInvoice.run(
      inv.id,
      "tenant-demo-polyclinic",
      inv.invoiceNo,
      inv.aptId,
      p.id,
      p.name,
      p.phone,
      p.uhid,
      invDate,
      JSON.stringify(inv.items),
      total,
      total,
      paidAmount,
      inv.status,
      inv.paymentMode,
      inv.paymentRef,
      "doc-persona-gynae",
      "Dr. Shalini Mukhopadhyay",
      inv.status === "Paid" ? "delivered" : "unsent",
      now,
      paidAt,
      inv.id,
      "tenant-demo-polyclinic",
      inv.invoiceNo
    );
    if (inv.dayOffset === 0) {
      refreshTodayPaidInvoice.run(today, inv.status === "Paid" ? now : null, inv.id, "tenant-demo-polyclinic");
    }
  }

  // Seed 4 Ob/Gyn WhatsApp Conversations + Messages in tenant-demo-polyclinic
  const insertPolyWaConv = database.prepare(
    `INSERT INTO whatsapp_conversations (
       id, patient_phone, patient_name, patient_id, uhid, handover_mode, assigned_staff,
       tags, preferred_language, unread_count, last_message, last_message_time, updated_at, tenant_id
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM whatsapp_conversations WHERE id = ? OR (tenant_id = ? AND patient_phone = ?)
     )`
  );
  const insertPolyWaMsg = database.prepare(
    `INSERT INTO whatsapp_messages (
       id, conversation_id, patient_phone, sender, staff_name, content, translated_content,
       detected_language, time_display, status, created_at, tenant_id
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM whatsapp_messages WHERE id = ?)`
  );

  const gynaeWhatsAppThreads: Array<{
    convId: string;
    patientId: string;
    mode: "human" | "bot";
    lang: "en" | "hi" | "mr";
    unread: number;
    tags: string[];
    lastTime: string;
    messages: Array<{
      id: string;
      sender: "user" | "agent" | "bot";
      staffName: string | null;
      content: string;
      translated: string | null;
      time: string;
    }>;
  }> = [
    {
      convId: "conv-gyn-nisha",
      patientId: "poly-pat-nisha",
      mode: "human",
      lang: "en",
      unread: 1,
      tags: ["ANC High-Risk", "GDM Sugar Log"],
      lastTime: "09:25 AM",
      messages: [
        {
          id: "msg-gyn-nisha-1",
          sender: "user",
          staffName: null,
          content: "Good morning Dr. Shalini, my fasting sugar today is 91 mg/dL and 2-hr post-breakfast after 20-min walk is 118 mg/dL. Fetal kick count was 12 kicks in 2 hours.",
          translated: null,
          time: "09:18 AM",
        },
        {
          id: "msg-gyn-nisha-2",
          sender: "agent",
          staffName: "Dr. Shalini Mukhopadhyay",
          content: "Good morning Nisha! Both fasting (<95) and 2-hr post-meal (<120 mg/dL) values are right on target. Continue Metformin SR 500 after dinner, split meals, and bring your SMBG log today.",
          translated: null,
          time: "09:25 AM",
        },
      ],
    },
    {
      convId: "conv-gyn-pooja",
      patientId: "gynae-pat-pooja",
      mode: "human",
      lang: "hi",
      unread: 1,
      tags: ["1st Trimester ANC", "Rh Negative"],
      lastTime: "08:50 AM",
      messages: [
        {
          id: "msg-gyn-pooja-1",
          sender: "user",
          staffName: null,
          content: "नमस्ते डॉ. शालिनी, सुबह हल्की मतली हो रही है। क्या मैं खाली पेट थायरॉइड की गोली लेने के 45 मिनट बाद नींबू पानी और टोस्ट ले सकती हूँ?",
          translated: "Namaste Dr. Shalini, having mild morning nausea. Can I take lemon water and toast 45 minutes after my empty-stomach thyroid tablet?",
          time: "08:42 AM",
        },
        {
          id: "msg-gyn-pooja-2",
          sender: "agent",
          staffName: "Dr. Shalini Mukhopadhyay",
          content: "नमस्ते पूजा जी, बिल्कुल! थायरोनॉर्म 25 mcg लेने के 45 मिनट बाद गुनगुना नींबू पानी और सूखा टोस्ट/भुना चना ले सकती हैं। रात को डॉक्सिनेट की 2 गोली जारी रखें।",
          translated: "Namaste Pooja ji, certainly! After 45 minutes of Thyronorm 25 mcg you may take lemon water and dry toast/roasted chana. Continue Doxinate 2 tablets at bedtime.",
          time: "08:50 AM",
        },
      ],
    },
    {
      convId: "conv-gyn-rekha",
      patientId: "gynae-pat-rekha",
      mode: "bot",
      lang: "mr",
      unread: 0,
      tags: ["AUB-L Fibroid", "Lab Follow-up"],
      lastTime: "Yesterday",
      messages: [
        {
          id: "msg-gyn-rekha-1",
          sender: "user",
          staffName: null,
          content: "नमस्कार मॅडम, आयर्नच्या गोळ्या सुरू केल्यापासून थकवा बराच कमी झाला आहे. पॅप स्मिअर रिपोर्ट नॉर्मल आला आहे का?",
          translated: "Hello Madam, fatigue has reduced after starting iron tablets. Is my Pap smear report normal?",
          time: "Yesterday",
        },
        {
          id: "msg-gyn-rekha-2",
          sender: "agent",
          staffName: "Dr. Shalini Mukhopadhyay",
          content: "नमस्कार रेखा ताई, तुमचा LBC पॅप स्मिअर आणि HPV रिपोर्ट पूर्णपणे नॉर्मल (NILM) आला आहे. हिमोग्लोबिन वाढण्यासाठी आयर्नच्या गोळ्या ६० दिवस नियमित घ्या.",
          translated: "Hello Rekha tai, your LBC Pap smear and HPV co-test report is completely normal (NILM). Continue iron tablets regularly for 60 days to restore hemoglobin.",
          time: "Yesterday",
        },
      ],
    },
    {
      convId: "conv-gyn-kavya",
      patientId: "gynae-pat-kavya",
      mode: "bot",
      lang: "en",
      unread: 0,
      tags: ["Fertility & PCOS", "Follicular Study"],
      lastTime: "10:05 AM",
      messages: [
        {
          id: "msg-gyn-kavya-1",
          sender: "user",
          staffName: null,
          content: "Hi Women's Desk, today is Cycle Day 12 of my Letrozole cycle. Confirming my morning TVS follicular study appointment with Dr. Shalini.",
          translated: null,
          time: "10:02 AM",
        },
        {
          id: "msg-gyn-kavya-2",
          sender: "bot",
          staffName: null,
          content: "Confirmed Kavya! Your Cycle Day 12 TVS Follicular Tracking consult with Dr. Shalini Mukhopadhyay (Women & Maternity Suite 203) is confirmed for today.",
          translated: null,
          time: "10:05 AM",
        },
      ],
    },
  ];

  for (const th of gynaeWhatsAppThreads) {
    const p = polyPatById.get(th.patientId)!;
    const lastMsg = th.messages[th.messages.length - 1];
    insertPolyWaConv.run(
      th.convId,
      p.phone,
      p.name,
      p.id,
      p.uhid,
      th.mode,
      "Dr. Shalini Mukhopadhyay",
      JSON.stringify(th.tags),
      th.lang,
      th.unread,
      lastMsg.content,
      th.lastTime,
      now,
      "tenant-demo-polyclinic",
      th.convId,
      "tenant-demo-polyclinic",
      p.phone
    );
    const convRow = database
      .prepare("SELECT id FROM whatsapp_conversations WHERE tenant_id = ? AND patient_phone = ?")
      .get("tenant-demo-polyclinic", p.phone) as { id?: string } | undefined;
    const effectiveConvId = String(convRow?.id || th.convId);
    for (const m of th.messages) {
      insertPolyWaMsg.run(
        m.id,
        effectiveConvId,
        p.phone,
        m.sender,
        m.staffName,
        m.content,
        m.translated,
        th.lang,
        m.time,
        "read",
        now,
        "tenant-demo-polyclinic",
        m.id
      );
    }
  }

  // Seed confirmed Pediatric IAP immunization doses for Aadhya (9.5m) & Vihaan (3y) & Arjun (8y)
  const insertDose = database.prepare(
    `INSERT INTO immunization_dose_records (
       id, tenant_id, patient_id, schedule_id, dose_code, occurrence_key, antigen, dose_label,
       status, given_on, brand, batch_no, given_by_name, confirmed_by_id, confirmed_by_name, created_at, updated_at
     )
     SELECT ?, ?, ?, 'pediatric_iap', ?, ?, ?, ?, 'given', ?, ?, ?, 'Dr. Ananya Sen', 'user-pediatrics', 'Dr. Ananya Sen', ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM immunization_dose_records WHERE tenant_id = ? AND patient_id = ? AND occurrence_key = ?
     )`
  );
  const pediaVaccineSeeds: Array<[string, string, string, string, number, string, string]> = [
    ["pedia-pat-aadhya", "bcg", "BCG", "Birth dose", -284, "Tubervac SII", "BCG-26A1"],
    ["pedia-pat-aadhya", "opv-0", "OPV", "Birth dose (OPV-0)", -284, "BioPolio", "OPV-26B2"],
    ["pedia-pat-aadhya", "hepb-1", "Hepatitis B", "Birth dose", -284, "GeneVac-B", "HBV-26C3"],
    ["pedia-pat-aadhya", "dtwp-1", "DTwP/DTaP", "Dose 1", -240, "Hexaxim", "HX-101"],
    ["pedia-pat-aadhya", "ipv-1", "IPV", "Dose 1", -240, "Hexaxim", "HX-101"],
    ["pedia-pat-aadhya", "hib-1", "Hib", "Dose 1", -240, "Hexaxim", "HX-101"],
    ["pedia-pat-aadhya", "pcv-1", "PCV", "Dose 1", -240, "Pneumosil", "PCV-201"],
    ["pedia-pat-aadhya", "rv-1", "Rotavirus", "Dose 1", -240, "Rotasiil", "RV-301"],
    ["pedia-pat-aadhya", "dtwp-2", "DTwP/DTaP", "Dose 2", -210, "Hexaxim", "HX-102"],
    ["pedia-pat-aadhya", "dtwp-3", "DTwP/DTaP", "Dose 3", -180, "Hexaxim", "HX-103"],
    ["pedia-pat-vihaan", "bcg", "BCG", "Birth dose", -1139, "Tubervac SII", "BCG-23A"],
    ["poly-pat-arjun", "bcg", "BCG", "Birth dose", -2979, "Tubervac SII", "BCG-18A"],
  ];
  for (const [patId, code, antigen, label, dobRelOffset, brand, batch] of pediaVaccineSeeds) {
    const recId = `imm-demo-${patId}-${code}`;
    const givenOn = shiftIsoDate(today, dobRelOffset);
    insertDose.run(
      recId,
      "tenant-demo-polyclinic",
      patId,
      code,
      code,
      antigen,
      label,
      givenOn,
      brand,
      batch,
      now,
      now,
      "tenant-demo-polyclinic",
      patId,
      code
    );
  }

  // 3. Physio Practice (physio@lumera.me / tenant-demo-physio): Enrich 4 package patients + add 5th patient + 5 Physio Rx
  const physioPatients: SeedPatientSpec[] = [
    { id: "physio-pat-anita", tenantId: "tenant-demo-physio", uhid: "LUM-PHY-3101", name: "Anita Desai", age: 41, dateOfBirth: "1985-04-12", gender: "Female", phone: "+91 98111 31001", email: "anita.desai@demo.lumera.in", bloodGroup: "O+", allergies: [], chronicConditions: ["L4-L5 Lumbar Disc Bulge — Lumbar Rehab Pack (7/10)"], address: "Juhu, Mumbai 400049" },
    { id: "physio-pat-rohit", tenantId: "tenant-demo-physio", uhid: "LUM-PHY-3102", name: "Rohit Khanna", age: 36, dateOfBirth: "1990-08-19", gender: "Male", phone: "+91 98111 31002", email: "rohit.khanna@demo.lumera.in", bloodGroup: "B+", allergies: [], chronicConditions: ["Right Rotator Cuff Impingement — Shoulder Mobility Pack (5/8)"], address: "Andheri West, Mumbai 400053" },
    { id: "physio-pat-leela", tenantId: "tenant-demo-physio", uhid: "LUM-PHY-3103", name: "Leela Nair", age: 58, dateOfBirth: "1968-01-25", gender: "Female", phone: "+91 98111 31003", email: "leela.nair@demo.lumera.in", bloodGroup: "A+", allergies: [], chronicConditions: ["Bilateral Knee OA — Knee Strength Pack (3/8)"], address: "Chembur, Mumbai 400071" },
    { id: "physio-pat-imran", tenantId: "tenant-demo-physio", uhid: "LUM-PHY-3104", name: "Imran Qureshi", age: 29, dateOfBirth: "1997-11-08", gender: "Male", phone: "+91 98111 31004", email: "imran.q@demo.lumera.in", bloodGroup: "O+", allergies: [], chronicConditions: ["Post-ORIF Lateral Malleolus — Ankle Rehab Pack (6/6)"], address: "Bandra East, Mumbai 400051" },
    { id: "physio-pat-vikas", tenantId: "tenant-demo-physio", uhid: "LUM-PHY-3105", name: "Vikas Menon", age: 32, dateOfBirth: "1994-03-16", gender: "Male", phone: "+91 98111 31005", email: "vikas.menon@demo.lumera.in", bloodGroup: "AB+", allergies: [], chronicConditions: ["Cervical Radiculopathy C5-C6 & Ergonomic Upper Crossed Syndrome"], address: "Powai, Mumbai 400076" },
  ];
  for (const p of physioPatients) upsertPatientSpec(p);

  physioPatients.forEach((p, idx) => {
    const rxId = `spec-rx-phy-${idx + 1}`;
    insertRx.run(
      rxId,
      p.tenantId,
      `RX-PHY-2026-080${idx + 1}`,
      p.id,
      p.name,
      p.phone,
      p.uhid,
      p.age,
      p.gender,
      "doc-persona-physio",
      "Dr. Siddharth Varma (PT)",
      "Physiotherapy & Rehabilitation",
      "IAP-2014-9921",
      today,
      p.chronicConditions[0],
      "M54.5",
      JSON.stringify([p.chronicConditions[0]]),
      "[]",
      "[]",
      JSON.stringify(["Perform prescribed Home Exercise Program twice daily within pain-free range"]),
      followUp14,
      `/api/emr/prescription/${rxId}/pdf`,
      now,
      JSON.stringify(defaultVitals()),
      "Physio Practice",
      "Physiotherapy & Rehabilitation",
      JSON.stringify({
        physiotherapyAssessment: {
          vasPainScore: [3, 4, 5, 1, 4][idx],
          painType: "Aching",
          jointRomFindings: [{ joint: ["Lumbar Spine", "Right Shoulder", "Bilateral Knees", "Right Ankle", "Cervical Spine"][idx], movement: "Active ROM", degrees: "Improving per protocol", endFeel: "Capsular / Firm" }],
          muscleStrengthMmt: [{ muscleGroup: "Target Stabilizers", grade: "4/5 (Good)" }],
          gaitAndPosture: "Functional alignment improving",
          specialOrthopedicTests: [],
          functionalGoals: ["Return to full pain-free Indian ADL & work ergonomics"],
        },
        performedTherapies: [
          { id: `pt-proc-${idx}`, name: "Interferential Therapy (IFT) + Manual Mobilization", type: "Electrotherapy & Modality", targetArea: "Affected Segment", durationMinutes: 20, patientTolerance: "Well Tolerated" },
        ],
        prescribedExercises: [
          { id: `pt-hep-${idx}`, exerciseName: "Isometric Core / Joint Stabilization", targetArea: "Lower Back & Core", sets: 3, reps: 10, holdSeconds: 8, frequency: "2x Daily", instructions: "Breathe steadily; do not hold breath" },
        ],
      }),
      rxId
    );
  });

  // 4. All 8 Standalone Pack & Alias Demo Workspaces (5 patients + seed appointments + Rx each!)
  for (const ws of STANDALONE_DEMO_WORKSPACES) {
    ws.patients.forEach((p, idx) => {
      const cleanName = p.name.trim();
      upsertPatientSpec({
        id: p.id,
        tenantId: ws.tenantId,
        uhid: p.uhid,
        name: cleanName,
        age: p.age,
        dateOfBirth: `${2026 - p.age}-06-15`,
        gender: p.gender,
        phone: p.phone,
        email: `${p.id}@demo.lumera.in`,
        bloodGroup: p.bloodGroup,
        allergies: [],
        chronicConditions: p.conditions,
        address: p.address,
      });

      const aptId = `spec-seed-${ws.tenantId}-${idx + 1}`;
      const token = allocateTokenNumber(database, ws.tenantId, today, ws.doctorId, 100 + idx);
      insertSeedVisit.run(
        aptId,
        ws.tenantId,
        token,
        p.id,
        cleanName,
        p.phone,
        p.uhid,
        ws.doctorId,
        ws.doctorName,
        ws.specialty,
        today,
        ["09:30 AM", "10:00 AM", "10:30 AM", "11:00 AM", "04:00 PM"][idx],
        ws.sessionType,
        idx === 0 ? "Completed" : "Waiting",
        ws.fee,
        idx === 0 ? 1 : 0,
        JSON.stringify(defaultVitals()),
        now,
        aptId
      );

      if (ws.withMedicalRx) {
        const rxId = `spec-rx-${ws.tenantId}-${idx + 1}`;
        insertRx.run(
          rxId,
          ws.tenantId,
          `RX-${p.uhid}`,
          p.id,
          cleanName,
          p.phone,
          p.uhid,
          p.age,
          p.gender,
          ws.doctorId,
          ws.doctorName,
          ws.specialty,
          ws.regNumber,
          today,
          p.diagnosis,
          p.icd10,
          JSON.stringify([p.complaint]),
          JSON.stringify(p.meds),
          "[]",
          JSON.stringify(p.advice.length ? p.advice : ["Review as scheduled"]),
          followUp14,
          `/api/emr/prescription/${rxId}/pdf`,
          now,
          JSON.stringify(defaultVitals()),
          `${ws.specialty} Practice`,
          ws.specialty,
          JSON.stringify({
            historyOfPresentIllness: p.complaint,
            ...(p.modules || {}),
          }),
          rxId
        );
      }
    });
  }
}


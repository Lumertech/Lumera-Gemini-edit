import type { UserRole } from "../types";

/** Shared sandbox password for every seeded @lumera.me demo login. */
export const DEMO_PASSWORD = "Lumera@2026";

export type DemoPracticeLine =
  | "Doctors & Clinics"
  | "Dentists"
  | "Physiotherapists"
  | "Therapists"
  | "Wellness & Spas"
  | "Consultants"
  | "Front desk"
  | "Patient"
  | "Platform";

export interface DemoAccount {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  specialty: string;
  phone: string;
  practiceLine: DemoPracticeLine;
  practiceType: "individual" | "polyclinic";
  /** Doctor roster row when this login is a clinician. */
  doctorId?: string;
  qualification?: string;
  regNumber?: string;
  consultationFee?: number;
  opdRoom?: string;
  bio?: string;
}

/**
 * Canonical sandbox matrix. Emails stay on lumera.me.
 * Password is always DEMO_PASSWORD. Not production credentials.
 */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    id: "user-admin",
    email: "admin@lumera.me",
    name: "Priya Iyer",
    role: "super_admin",
    specialty: "",
    phone: "+91 98000 11111",
    practiceLine: "Platform",
    practiceType: "polyclinic",
  },
  {
    id: "user-reception",
    email: "reception@lumera.me",
    name: "Ramesh Patel",
    role: "receptionist",
    specialty: "",
    phone: "+91 98200 44556",
    practiceLine: "Front desk",
    practiceType: "polyclinic",
  },
  {
    id: "user-receptionist",
    email: "receptionist@lumera.me",
    name: "Ramesh Patel",
    role: "receptionist",
    specialty: "",
    phone: "+91 98200 44556",
    practiceLine: "Front desk",
    practiceType: "polyclinic",
  },
  {
    id: "user-patient",
    email: "patient@lumera.me",
    name: "Rajiv Saxena",
    role: "patient",
    specialty: "",
    phone: "+91 98234 55667",
    practiceLine: "Patient",
    practiceType: "individual",
  },
  {
    id: "user-doctor",
    email: "doctor@lumera.me",
    name: "Dr. Vikram Malhotra",
    role: "doctor",
    specialty: "General Medicine",
    phone: "+91 98765 43210",
    practiceLine: "Doctors & Clinics",
    practiceType: "individual",
    doctorId: "doc-persona-gp",
    qualification: "MBBS, MD (General Medicine), FICP",
    regNumber: "MCI-2012-74892",
    consultationFee: 600,
    opdRoom: "GP Consult 102",
    bio: "Sandbox GP / Doctors & Clinics pack — adult medicine, diabetes, hypertension.",
  },
  {
    id: "user-cardiology",
    email: "cardiology@lumera.me",
    name: "Dr. Rajesh Sharma",
    role: "doctor",
    specialty: "Cardiology",
    phone: "+91 98223 99887",
    practiceLine: "Doctors & Clinics",
    practiceType: "individual",
    doctorId: "doc-persona-cardio",
    qualification: "MBBS, MD, DM (Cardiology), FACC",
    regNumber: "DMC-2008-11928",
    consultationFee: 1000,
    opdRoom: "Cardiac OPD 201",
    bio: "Sandbox cardiology pack — NYHA class, targets, ECG/echo fields.",
  },
  {
    id: "user-dermatology",
    email: "dermatology@lumera.me",
    name: "Dr. Meera Vasudevan",
    role: "doctor",
    specialty: "Dermatology",
    phone: "+91 97334 11223",
    practiceLine: "Doctors & Clinics",
    practiceType: "individual",
    doctorId: "doc-persona-derma",
    qualification: "MBBS, MD (Dermatology)",
    regNumber: "KMC-2015-88392",
    consultationFee: 750,
    opdRoom: "Derma Suite 108",
    bio: "Sandbox dermatology pack — lesion type, Fitzpatrick, in-clinic procedures.",
  },
  {
    id: "user-orthopedics",
    email: "orthopedics@lumera.me",
    name: "Dr. Harshvardhan Patel",
    role: "doctor",
    specialty: "Orthopedics",
    phone: "+91 99445 66778",
    practiceLine: "Doctors & Clinics",
    practiceType: "individual",
    doctorId: "doc-persona-ortho",
    qualification: "MBBS, MS (Orthopedics)",
    regNumber: "GMC-2010-55421",
    consultationFee: 800,
    opdRoom: "Ortho OPD 106",
    bio: "Sandbox orthopedics pack — joint, weight-bearing, brace, X-ray summary.",
  },
  {
    id: "user-pediatrics",
    email: "pediatrics@lumera.me",
    name: "Dr. Ananya Sen",
    role: "doctor",
    specialty: "Pediatrics",
    phone: "+91 98112 34567",
    practiceLine: "Doctors & Clinics",
    practiceType: "individual",
    doctorId: "doc-persona-pedia",
    qualification: "MBBS, MD (Pediatrics), DCH",
    regNumber: "WBMC-2016-39482",
    consultationFee: 700,
    opdRoom: "OPD Room 104",
    bio: "Sandbox pediatrics pack — growth percentiles, immunisation, weight-based dosing.",
  },
  {
    id: "user-gynecology",
    email: "gynecology@lumera.me",
    name: "Dr. Shalini Mukhopadhyay",
    role: "doctor",
    specialty: "Gynecology",
    phone: "+91 98319 88990",
    practiceLine: "Doctors & Clinics",
    practiceType: "individual",
    doctorId: "doc-persona-gynae",
    qualification: "MBBS, MS (Obstetrics & Gynecology)",
    regNumber: "WBMC-2011-44910",
    consultationFee: 800,
    opdRoom: "Women & Maternity 203",
    bio: "Sandbox gynecology pack — LMP/EDD, gravida-para, antenatal checklist.",
  },
  {
    id: "user-ent",
    email: "ent@lumera.me",
    name: "Dr. Naveen Iyer",
    role: "doctor",
    specialty: "ENT",
    phone: "+91 98120 66771",
    practiceLine: "Doctors & Clinics",
    practiceType: "individual",
    doctorId: "doc-persona-ent",
    qualification: "MBBS, MS (ENT)",
    regNumber: "MMC-2014-22011",
    consultationFee: 700,
    opdRoom: "ENT Suite 110",
    bio: "Sandbox ENT pack — ear/nose/throat intake and consult template.",
  },
  {
    id: "user-ophthalmology",
    email: "ophthalmology@lumera.me",
    name: "Dr. Alok Nath Mukherjee",
    role: "doctor",
    specialty: "Ophthalmology",
    phone: "+91 98109 44332",
    practiceLine: "Doctors & Clinics",
    practiceType: "individual",
    doctorId: "doc-persona-ophtho",
    qualification: "MBBS, MS (Ophthalmology), DNB",
    regNumber: "DMC-2009-33211",
    consultationFee: 750,
    opdRoom: "Eye Suite 205",
    bio: "Sandbox ophthalmology pack — acuity, refraction, IOP, fundus.",
  },
  {
    id: "user-dentist",
    email: "dentist@lumera.me",
    name: "Dr. Arunachalam Swamy",
    role: "doctor",
    specialty: "Dental Surgery",
    phone: "+91 98401 22334",
    practiceLine: "Dentists",
    practiceType: "individual",
    doctorId: "doc-persona-dentist",
    qualification: "BDS, MDS (Endodontics)",
    regNumber: "DCI-2013-19920",
    consultationFee: 650,
    opdRoom: "Dental Operatory 109",
    bio: "Sandbox dentist pack — odontogram / tooth chart and dental visit template.",
  },
  {
    id: "user-physio",
    email: "physio@lumera.me",
    name: "Dr. Siddharth Varma (PT)",
    role: "doctor",
    specialty: "Physiotherapy & Rehabilitation",
    phone: "+91 98312 77889",
    practiceLine: "Physiotherapists",
    practiceType: "individual",
    doctorId: "doc-persona-physio",
    qualification: "BPT, MPT (Musculoskeletal)",
    regNumber: "IAP-2014-9921",
    consultationFee: 700,
    opdRoom: "Rehab Suite 105",
    bio: "Sandbox physio pack — VAS, ROM, session plan. Not an Rx-first GP chart.",
  },
  {
    id: "user-therapist",
    email: "therapist@lumera.me",
    name: "Anika Bose, MPhil (Clinical Psychology)",
    role: "doctor",
    specialty: "Psychiatry & Mental Health",
    phone: "+91 98177 22001",
    practiceLine: "Therapists",
    practiceType: "individual",
    doctorId: "doc-persona-therapist",
    qualification: "MPhil Clinical Psychology, RCI",
    regNumber: "RCI-2017-4410",
    consultationFee: 1800,
    opdRoom: "Therapy Room 3",
    bio: "Sandbox therapist pack — counseling session notes, not a medical Rx studio.",
  },
  {
    id: "user-wellness",
    email: "wellness@lumera.me",
    name: "Kavya Menon",
    role: "doctor",
    specialty: "Wellness & Spas",
    phone: "+91 98450 11882",
    practiceLine: "Wellness & Spas",
    practiceType: "individual",
    doctorId: "doc-persona-wellness",
    qualification: "CIDESCO / Salon operations",
    regNumber: "SPA-DEMO-1001",
    consultationFee: 2500,
    opdRoom: "Treatment Suite A",
    bio: "Sandbox wellness & salon pack — services and packages. Not a medical chart.",
  },
  {
    id: "user-consultant",
    email: "consultant@lumera.me",
    name: "Aarav Mehta",
    role: "doctor",
    specialty: "Consulting",
    phone: "+91 99001 33445",
    practiceLine: "Consultants",
    practiceType: "individual",
    doctorId: "doc-persona-consultant",
    qualification: "MBA, Independent consultant",
    regNumber: "CONSULT-DEMO-12",
    consultationFee: 5000,
    opdRoom: "Meeting Room 2",
    bio: "Sandbox consultant pack — meetings, briefs, invoices. Not a clinic EMR.",
  },
];

export const DEMO_ACCOUNT_EMAILS = DEMO_ACCOUNTS.map((a) => a.email);

export function demoAccountByEmail(email?: string | null): DemoAccount | undefined {
  const key = String(email || "").trim().toLowerCase();
  return DEMO_ACCOUNTS.find((a) => a.email === key);
}

export function isDemoAccountEmail(email?: string | null): boolean {
  return Boolean(demoAccountByEmail(email));
}

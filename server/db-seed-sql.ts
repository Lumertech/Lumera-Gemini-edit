import type { DatabaseSync } from "node:sqlite";
import { PRODUCT_NAME } from "../src/brand.ts";

/** Demo roster + CMS/WhatsApp seed payloads extracted from db.ts so the
 *  MCP GitHub upload of db.ts stays under the ~100k tool-payload ceiling.
 *  Schema/migrations remain in db.ts. getDb()/initDatabase() still own wiring.
 */

export const DOCTOR_SEED = [
  {
    id: "doc-1",
    name: "Dr. Vikram Malhotra",
    qualification: "MBBS, MD (General Medicine), FICP",
    regNumber: "MCI-2012-74892",
    specialty: "General Medicine",
    experienceYears: 14,
    consultationFee: 600,
    opdRoom: "OPD Room 102",
    availableDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    opdTiming: "09:00 AM - 02:00 PM",
    phone: "+91 98765 43210",
    email: "doctor@lumera.me",
    avatarUrl: "https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&w=400&q=80",
    bio: "Senior Consultant Physician specializing in Adult Internal Medicine, Hypertension, Diabetes & Preventive Cardiology.",
    hprId: "HPR-IN-2012-9841",
  },
  {
    id: "doc-6",
    name: "Dr. Siddharth Varma (PT)",
    qualification: "BPT, MPT (Musculoskeletal & Sports Physiotherapy), MIAP, CMP",
    regNumber: "IAP-2014-9921",
    specialty: "Physiotherapy & Rehabilitation",
    experienceYears: 12,
    consultationFee: 700,
    opdRoom: "Physio & Rehab Suite 105",
    availableDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    opdTiming: "08:30 AM - 01:30 PM, 04:30 PM - 08:00 PM",
    phone: "+91 98312 77889",
    email: "dr.siddharth@lumera.health",
    avatarUrl: "https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&w=400&q=80",
    bio: "Lead Musculoskeletal & Sports Physiotherapist certified in Spinal Mobilization, Dry Needling & Post-Operative Knee Rehab.",
    hprId: "HPR-IN-2014-6102",
  },
  {
    id: "doc-2",
    name: "Dr. Ananya Sen",
    qualification: "MBBS, MD (Pediatrics), DCH (London)",
    regNumber: "WBMC-2016-39482",
    specialty: "Pediatrics",
    experienceYears: 9,
    consultationFee: 700,
    opdRoom: "OPD Room 104",
    availableDays: ["Mon", "Wed", "Fri", "Sat"],
    opdTiming: "10:00 AM - 03:00 PM",
    phone: "+91 98112 34567",
    email: "dr.ananya@lumera.health",
    avatarUrl: "https://images.unsplash.com/photo-1594824813589-98072124c6e9?auto=format&fit=crop&w=400&q=80",
    bio: "Consultant Pediatrician with extensive experience in Neonatal Intensive Care, Immunization, and Developmental Milestones.",
    hprId: "HPR-IN-2016-3391",
  },
  {
    id: "doc-3",
    name: "Dr. Rajesh Sharma",
    qualification: "MBBS, MD, DM (Cardiology), FACC",
    regNumber: "DMC-2008-11928",
    specialty: "Cardiology",
    experienceYears: 18,
    consultationFee: 1000,
    opdRoom: "Cardiac OPD 201",
    availableDays: ["Tue", "Thu", "Sat"],
    opdTiming: "11:00 AM - 04:00 PM",
    phone: "+91 98223 99887",
    email: "dr.rajesh@lumera.health",
    avatarUrl: "https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&w=400&q=80",
    bio: "Interventional Cardiologist & Clinical Electrophysiology Specialist with 18+ years managing Coronary Artery Disease and Heart Failure.",
    hprId: "HPR-IN-2008-1140",
  },
  {
    id: "doc-4",
    name: "Dr. Meera Vasudevan",
    qualification: "MBBS, MD (Dermatology, Venereology & Leprosy)",
    regNumber: "KMC-2015-88392",
    specialty: "Dermatology",
    experienceYears: 11,
    consultationFee: 750,
    opdRoom: "Derma Suite 108",
    availableDays: ["Mon", "Tue", "Thu", "Fri"],
    opdTiming: "02:00 PM - 07:00 PM",
    phone: "+91 97334 11223",
    email: "dr.meera@lumera.health",
    avatarUrl: "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=400&q=80",
    bio: "Consultant Dermatologist & Dermatosurgeon specializing in Clinical Dermatology, Trichology, and Advanced Laser Therapies.",
    hprId: "HPR-IN-2015-8821",
  },
  {
    id: "doc-5",
    name: "Dr. Harshvardhan Patel",
    qualification: "MBBS, MS (Orthopedics), M.Ch (Joint Replacement)",
    regNumber: "GMC-2010-55421",
    specialty: "Orthopedics",
    experienceYears: 15,
    consultationFee: 800,
    opdRoom: "Ortho OPD 106",
    availableDays: ["Mon", "Wed", "Fri"],
    opdTiming: "09:30 AM - 01:30 PM",
    phone: "+91 99445 66778",
    email: "dr.harsh@lumera.health",
    avatarUrl: "https://images.unsplash.com/photo-1582750433449-648ed127bb54?auto=format&fit=crop&w=400&q=80",
    bio: "Chief Orthopedic Surgeon with fellowships in Computer-Navigated Joint Replacements and Arthroscopic Sports Medicine.",
    hprId: "HPR-IN-2010-5519",
  },
  {
    id: "doc-7",
    name: "Dr. Shalini Mukhopadhyay",
    qualification: "MBBS, MS (Obstetrics & Gynecology), DGO, FICOG",
    regNumber: "WBMC-2011-44910",
    specialty: "Gynecology",
    experienceYears: 15,
    consultationFee: 800,
    opdRoom: "Women & Maternity Suite 203",
    availableDays: ["Mon", "Tue", "Thu", "Sat"],
    opdTiming: "10:00 AM - 02:30 PM",
    phone: "+91 98319 88990",
    email: "dr.shalini@lumera.health",
    avatarUrl: "https://images.unsplash.com/photo-1591604021695-0c69b7c05981?auto=format&fit=crop&w=400&q=80",
    bio: "Senior Consultant Gynecologist & Obstetrician specializing in High-Risk Obstetrics, Infertility Care, and Minimally Invasive Laparoscopy.",
    hprId: "HPR-IN-2011-4402",
  },
  {
    id: "doc-8",
    name: "Dr. Arunachalam Swamy",
    qualification: "BDS, MDS (Conservative Dentistry & Endodontics), FIA",
    regNumber: "DCI-2013-19920",
    specialty: "Dental Surgery",
    experienceYears: 13,
    consultationFee: 650,
    opdRoom: "Dental Operatory 109",
    availableDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    opdTiming: "09:00 AM - 01:00 PM, 05:00 PM - 08:30 PM",
    phone: "+91 98401 22334",
    email: "dr.arun@lumera.health",
    avatarUrl: "https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=400&q=80",
    bio: "Specialist Dental Surgeon & Endodontist with mastery in Single-Sitting Microscope-Assisted Root Canals and Cosmetic Restorations.",
    hprId: "HPR-IN-2013-1945",
  },
  {
    id: "doc-9",
    name: "Dr. Alok Nath Mukherjee",
    qualification: "MBBS, MS (Ophthalmology), DNB, FICO (UK)",
    regNumber: "DMC-2009-33211",
    specialty: "Ophthalmology",
    experienceYears: 16,
    consultationFee: 750,
    opdRoom: "Eye & Refraction Suite 205",
    availableDays: ["Mon", "Wed", "Fri", "Sat"],
    opdTiming: "11:00 AM - 04:30 PM",
    phone: "+91 98109 44332",
    email: "dr.alok@lumera.health",
    avatarUrl: "https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=400&q=80",
    bio: "Consultant Ophthalmic Surgeon specializing in Phaco-Emulsification Cataract Surgeries, Diabetic Retinopathy, and Glaucoma Management.",
    hprId: "HPR-IN-2009-3382",
  },
];

export type MetaWhatsAppTemplateSeed = {
  id: string;
  tenant_id: string;
  waba_id: string;
  name: string;
  category: string;
  language: string;
  status: string;
  components: string;
  meta_template_id: string;
  rejection_reason: string | null;
};

export const META_WHATSAPP_TEMPLATE_SEED: MetaWhatsAppTemplateSeed[] = [
      {
        id: "tpl-1",
        tenant_id: "tenant-lumera-main",
        waba_id: "waba_398249018247019",
        name: "appointment_reminder_v1",
        category: "UTILITY",
        language: "en",
        status: "APPROVED",
        components: JSON.stringify([
          { type: "HEADER", format: "TEXT", text: "Appointment Confirmation - Lumera Health" },
          {
            type: "BODY",
            text: "Hello {{1}}, your consultation with {{2}} is confirmed for {{3}} at {{4}}. Your OPD Token is #{{5}}. Please arrive 10 minutes prior to your slot.",
            example: { body_text: [["Rajiv Saxena", "Dr. Vikram Malhotra", "Tomorrow", "09:30 AM", "04"]] }
          },
          { type: "FOOTER", text: "Lumera Apex PolyClinic • Indiranagar, Bengaluru" },
          {
            type: "BUTTONS",
            buttons: [
              { type: "QUICK_REPLY", text: "Confirm Arrival" },
              { type: "QUICK_REPLY", text: "Reschedule Slot" }
            ]
          }
        ]),
        meta_template_id: "meta_tpl_983102948102",
        rejection_reason: null
      },
      {
        id: "tpl-2",
        tenant_id: "tenant-lumera-main",
        waba_id: "waba_398249018247019",
        name: "post_consultation_rx",
        category: "UTILITY",
        language: "en",
        status: "APPROVED",
        components: JSON.stringify([
          { type: "HEADER", format: "DOCUMENT" },
          {
            type: "BODY",
            text: "Dear {{1}}, thank you for consulting Dr. {{2}}. Your digital prescription (Rx: {{3}}) and itemized consultation receipt are attached above. You can view dosage schedules anytime on your Lumera Portal.",
            example: { body_text: [["Sunita Roy", "Vikram Malhotra", "RX-2026-0101"]] }
          },
          { type: "FOOTER", text: "Lumera Health EMR System • Certified Digital Rx" },
          {
            type: "BUTTONS",
            buttons: [
              { type: "URL", text: "Open Patient Portal", url: "https://lumera.health/portal" }
            ]
          }
        ]),
        meta_template_id: "meta_tpl_983102948103",
        rejection_reason: null
      },
      {
        id: "tpl-3",
        tenant_id: "tenant-lumera-main",
        waba_id: "waba_398249018247019",
        name: "lab_report_ready",
        category: "UTILITY",
        language: "en",
        status: "APPROVED",
        components: JSON.stringify([
          { type: "HEADER", format: "TEXT", text: "Diagnostic Pathology Report" },
          {
            type: "BODY",
            text: "Namaste {{1}}, your test results for {{2}} conducted on {{3}} have been signed off by the pathologist and are now ready for download.",
            example: { body_text: [["Rajiv Saxena", "Renal & Vitamin Profile", "28 Aug 2026"]] }
          },
          { type: "FOOTER", text: "Lumera Central Diagnostics" },
          {
            type: "BUTTONS",
            buttons: [
              { type: "QUICK_REPLY", text: "Download PDF" },
              { type: "QUICK_REPLY", text: "Book Follow-up" }
            ]
          }
        ]),
        meta_template_id: "meta_tpl_983102948104",
        rejection_reason: null
      },
      {
        id: "tpl-4",
        tenant_id: "tenant-lumera-main",
        waba_id: "waba_398249018247019",
        name: "opd_queue_token_alert",
        category: "UTILITY",
        language: "en",
        status: "APPROVED",
        components: JSON.stringify([
          { type: "HEADER", format: "TEXT", text: "Live Queue Update" },
          {
            type: "BODY",
            text: "Patient Alert: Token #{{1}} ({{2}}). You are next in line for {{3}}. Please proceed to {{4}}.",
            example: { body_text: [["02", "Priyanka Mukherjee", "Dr. Siddharth Varma", "Rehab Suite 105"]] }
          },
          { type: "FOOTER", text: "Live OPD Triage System" }
        ]),
        meta_template_id: "meta_tpl_983102948105",
        rejection_reason: null
      },
      {
        id: "tpl-5",
        tenant_id: "tenant-lumera-main",
        waba_id: "waba_398249018247019",
        name: "otp_login_verification",
        category: "AUTHENTICATION",
        language: "en",
        status: "APPROVED",
        components: JSON.stringify([
          {
            type: "BODY",
            text: "Your Lumera Health verification code is {{1}}. Valid for 5 minutes. Never share this code with anyone.",
            example: { body_text: [["492810"]] }
          },
          {
            type: "BUTTONS",
            buttons: [
              { type: "QUICK_REPLY", text: "Copy Code" }
            ]
          }
        ]),
        meta_template_id: "meta_tpl_983102948106",
        rejection_reason: null
      },
      {
        id: "tpl-6",
        tenant_id: "tenant-lumera-main",
        waba_id: "waba_398249018247019",
        name: "preventive_cardiac_camp",
        category: "MARKETING",
        language: "en",
        status: "PENDING",
        components: JSON.stringify([
          { type: "HEADER", format: "IMAGE" },
          {
            type: "BODY",
            text: "Dear {{1}}, Lumera Health is organizing a Comprehensive Cardiac Wellness Camp on Saturday, {{2}}. Includes ECG, Lipid Profile & Senior Cardiologist consultation at 50% discount.",
            example: { body_text: [["Rajiv", "15 September 2026"]] }
          },
          { type: "FOOTER", text: "Reply STOP to unsubscribe from health updates" },
          {
            type: "BUTTONS",
            buttons: [
              { type: "QUICK_REPLY", text: "Book Camp Slot" },
              { type: "QUICK_REPLY", text: "View Details" }
            ]
          }
        ]),
        meta_template_id: "meta_tpl_983102948107",
        rejection_reason: null
      }
    ];

export function seedCms(database: DatabaseSync, now: string) {
  const set = database.prepare("INSERT INTO cms_settings (key, value) VALUES (?, ?)");
  const settings: Record<string, string> = {
    brand_name: PRODUCT_NAME,
    badge_text: "AI-Powered Practice Management for Healthcare Professionals",
    hero_title: "Your AI Receptionist for 24/7 Appointment Booking",
    hero_subtitle:
      "Let Lumera AI answer calls, book appointments via WhatsApp, and manage your practice automatically — in Hindi, Tamil, Telugu, Marathi, Bengali & English.",
    contact_email: "ravee@lumer.me",
    cta_primary: "Get Started Free",
    cta_secondary: "See Demo",
    cta_banner_title: "Ready to Transform Your Practice?",
    cta_banner_subtitle: "Start your free trial today. No credit card required. Set up in under 5 minutes.",
    stats: JSON.stringify([
      { icon: "calendar", value: "50K+", label: "Appointments Booked" },
      { icon: "clock", value: "10K+", label: "Hours Saved Monthly" },
      { icon: "trend", value: "95%", label: "No-Show Reduction" },
      { icon: "bot", value: "24/7", label: "AI Availability" },
    ]),
    gemini_model: "models/gemini-3.7-flash",
    ambient_sensitivity: "High (Medical Grade 16kHz)",
    auto_soap: "true",
    abdm_enabled: "true",
    clinic_name: "Lumera Healthcare & Polyclinic Institute",
    clinic_address: "Suite 401-405, Healthcare Towers, 14 Park Circus Avenue, Kolkata",
    logo_url: "",
  };
  for (const [key, value] of Object.entries(settings)) {
    set.run(key, value);
  }

  const insertSection = database.prepare(
    "INSERT INTO cms_sections (id, type, sort_order, payload) VALUES (?, ?, ?, ?)"
  );

  const pains = [
    {
      title: "Handle every call yourself",
      items: [
        "Constant interruptions during consultations",
        "Missed calls = missed patients",
        "No time for actual patient care",
      ],
    },
    {
      title: "Let calls go unanswered",
      items: [
        "Patients hang up and call competitors",
        "No way to reconnect with lost leads",
        "Poor first impression of your practice",
      ],
    },
    {
      title: "Hire expensive receptionists",
      items: [
        "High salary costs that add up fast",
        "Staff unavailable nights & weekends",
        "Inconsistent patient experience",
      ],
    },
  ];
  pains.forEach((p, i) => insertSection.run(`pain-${i + 1}`, "pain", i, JSON.stringify(p)));

  const features = [
    { title: "AI Voice Assistant", desc: "Human-like AI answers calls in Hindi, Tamil, Telugu, Marathi & more. Never miss a patient call again." },
    { title: "WhatsApp Integration", desc: "Patients book appointments through WhatsApp. AI chatbot handles queries 24/7." },
    { title: "Smart Scheduling", desc: "AI manages your calendar, prevents double-bookings, and optimizes appointment slots." },
    { title: "Automated Reminders", desc: "WhatsApp & voice reminders reduce no-shows by up to 95%. Smart follow-ups included." },
    { title: "Instant Payments", desc: "Send payment links via WhatsApp. Accept UPI, cards, or Razorpay. Get paid faster." },
    { title: "ABDM-aligned (NHA sandbox)", desc: "ABHA ID integration path, digital consent, and sandbox-unverified health records — not production HIU/HIP approval." },
  ];
  features.forEach((f, i) => insertSection.run(`feat-${i + 1}`, "feature", i, JSON.stringify(f)));

  const personas = [
    { title: "Doctors & Clinics", desc: "AI prescriptions, patient records, ABDM sandbox path" },
    { title: "Dentists", desc: "Treatment plans, follow-up reminders, payment tracking" },
    { title: "Therapists", desc: "Session notes, secure storage, appointment reminders" },
    { title: "Wellness & Spas", desc: "Service catalog, packages, loyalty management" },
    { title: "Physiotherapists", desc: "Treatment tracking, exercise reminders, progress notes" },
    { title: "Consultants", desc: "Meeting scheduling, document sharing, invoicing" },
  ];
  personas.forEach((p, i) => insertSection.run(`persona-${i + 1}`, "persona", i, JSON.stringify(p)));

  const testimonials = [
    {
      quote: "Lumera AI answers calls instantly and sounds natural. Patients think they're speaking to my receptionist.",
      name: "Dr. Priya Sharma",
      role: "Cardiologist, Mumbai",
    },
    {
      quote: "Since switching to Lumera, we don't miss after-hours calls anymore. Revenue is up 30%.",
      name: "Dr. Rajesh Kumar",
      role: "Dental Clinic, Bangalore",
    },
    {
      quote: "The WhatsApp booking is a game-changer. My patients love how easy it is to schedule appointments.",
      name: "Dr. Meera Patel",
      role: "Physiotherapist, Delhi",
    },
  ];
  testimonials.forEach((t, i) => insertSection.run(`quote-${i + 1}`, "testimonial", i, JSON.stringify(t)));

  const insertPolicy = database.prepare(
    "INSERT INTO cms_policies (slug, title, body, updated_at) VALUES (?, ?, ?, ?)"
  );
  insertPolicy.run(
    "privacy",
    "Privacy Policy",
    `# Privacy Policy

Lumera Solutions LLP (“Lumera”, “we”) provides AI-assisted practice management for healthcare professionals.

## Information we collect
- Account details (name, email, phone, role) for clinic staff and patients you enrol
- Clinical workflow data you enter in the EMR (appointments, SOAP notes, prescriptions)
- Technical logs required for security and audit

## How we use it
Data is used to operate the clinician suite, patient portal, and admin CMS; to generate AI drafts you review; and to meet ABDM / NDHM interoperability where you enable it.

## Sharing
We do not sell health information. Processors (for example Gemini API when a clinic key is configured) receive only the minimum payload needed for the requested inference.

## Retention & rights
Clinic administrators can disable users and export or delete CMS content from the Admin console. Contact ravee@lumer.me for data requests.`,
    now
  );
  insertPolicy.run(
    "terms",
    "Terms of Service",
    `# Terms of Service

By creating a Lumera account you agree to use the software for lawful clinical and administrative purposes.

## Accounts
You are responsible for credentials issued to your staff. Demo passwords must be changed before any live patient data is stored.

## Clinical responsibility
AI-generated SOAP notes, prescriptions, and chat replies are decision-support drafts. Licensed practitioners remain solely responsible for diagnosis, treatment, and documentation.

## Availability
The service is provided as a practice operating suite. Scheduled maintenance may occur with notice in the admin audit log.`,
    now
  );
  insertPolicy.run(
    "disclaimer",
    "Medical Disclaimer",
    `# Medical Disclaimer

Lumera is not a substitute for professional medical advice, diagnosis, or treatment.

Ambient transcription, HEXA answers, and OCR lab extraction can contain errors. Always verify against source documents and clinical judgement before acting.

Emergency care should never rely on the AI receptionist or WhatsApp bot — direct patients to emergency services.`,
    now
  );
  insertPolicy.run(
    "security",
    "Data Security",
    `# Data Security

- Passwords are stored with scrypt hashes; sessions use httpOnly cookies
- Role-based access separates Super Admin, clinicians, reception, and patients
- Mutating admin actions are written to an immutable audit log
- Gemini API keys stay in server environment variables and are never written to SQLite
- Uploaded media is stored on the clinic server under /uploads

Report suspected incidents to ravee@lumer.me.`,
    now
  );
}

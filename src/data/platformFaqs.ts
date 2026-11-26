import {
  CONTACT_EMAIL,
  TRIAL_DAYS,
  WHATSAPP_BILLED_BY_META,
  WHATSAPP_INR_PAYMENT,
} from "../lib/pricingCopy";
import { META_TECH_PROVIDER_STATEMENT } from "../lib/metaStatus";

export type FaqCategoryId =
  | "whatsapp-linking"
  | "voice-languages"
  | "shared-mobile"
  | "clinical-scribe"
  | "pricing-billing"
  | "privacy-records";

export interface FaqCategoryMeta {
  id: FaqCategoryId;
  label: string;
  shortLabel: string;
  description: string;
}

export interface PlatformFaqItem {
  id: string;
  category: FaqCategoryId;
  question: string;
  answer: string;
  bullets?: string[];
  highlightNote?: string;
  tags: string[];
  showInWhatsAppSetup?: boolean;
}

export interface WhatsAppNumberOptionCard {
  id: string;
  badge: string;
  title: string;
  verdict: "Recommended" | "Supported with Caveats" | "No Extra SIM Needed";
  summary: string;
  details: string[];
}

export const FAQ_CATEGORIES: FaqCategoryMeta[] = [
  {
    id: "whatsapp-linking",
    label: "WhatsApp & Number Linking",
    shortLabel: "WhatsApp Linking",
    description: "Existing vs. new numbers, Meta virtual numbers, landlines, 2FA PINs, templates, and Meta billing.",
  },
  {
    id: "voice-languages",
    label: "AI Receptionist & Languages",
    shortLabel: "Voice & Languages",
    description: "24/7 voice vs. messaging-only mode, Hindi/Marathi/regional locking, and staff handover.",
  },
  {
    id: "shared-mobile",
    label: "Shared Mobile (Pets, Kids & Family)",
    shortLabel: "Pets & Family",
    description: "Multiple pets, multiple children, elderly parents, or friends registered on a single mobile number.",
  },
  {
    id: "clinical-scribe",
    label: "Ambient Scribe & Specialties",
    shortLabel: "Scribe & Specialties",
    description: "Consent-gated ambient SOAP notes, doctor sign-off, and 13+ medical, dental, rehab & veterinary packs.",
  },
  {
    id: "pricing-billing",
    label: "Pricing, Trial & Payments",
    shortLabel: "Pricing & Trial",
    description: `${TRIAL_DAYS}-day card-free trial, 0% patient payment commission, GST invoices, and 1-step cancellation.`,
  },
  {
    id: "privacy-records",
    label: "Data Privacy & Records",
    shortLabel: "Privacy & Records",
    description: "DPDP Act 2023 safeguards, clinic data ownership, role-based access, and ABDM sandbox status.",
  },
];

export const WHATSAPP_NUMBER_OPTIONS: WhatsAppNumberOptionCard[] = [
  {
    id: "dedicated-new-or-landline",
    badge: "Option 1 · Cleanest Setup",
    title: "New Mobile SIM or Clinic Landline",
    verdict: "Recommended",
    summary:
      "Use any Indian mobile SIM or clinic reception landline that is NOT currently registered on a WhatsApp app.",
    details: [
      "Receives a one-time 6-digit SMS or automated voice call OTP inside Meta Embedded Signup.",
      "Zero risk to your personal chats — your doctor or reception personal WhatsApp stays separate.",
      "Landlines work via the 'Phone Call' verification option (ensure any auto-attendant IVR is temporarily bypassed during the 60-second OTP call).",
    ],
  },
  {
    id: "meta-virtual-number",
    badge: "Option 2 · Hardware-Free",
    title: "Meta-Provided Virtual Number",
    verdict: "No Extra SIM Needed",
    summary:
      "Don't want to buy a new SIM card? Meta can issue a cloud virtual number during Embedded Signup once your business is verified.",
    details: [
      "Select Meta's virtual phone number option directly inside the Meta Embedded Signup popup.",
      "No physical handset or SMS OTP SIM swap is required — Meta verifies ownership through your Meta Business Portfolio.",
      "Complete Meta Business Verification (clinic registration, GST, MSME, or utility proof) in Meta Business Settings to activate full messaging limits.",
    ],
  },
  {
    id: "existing-whatsapp-number",
    badge: "Option 3 · Existing Number Rules",
    title: "Can I Use My Existing WhatsApp Number?",
    verdict: "Supported with Caveats",
    summary:
      "Numbers active on regular personal WhatsApp Messenger cannot be linked directly while active — you must either migrate or use Business App Coexistence.",
    details: [
      "Personal WhatsApp Messenger app: Cannot run simultaneously on Cloud API. To reuse that number, back up chats, delete the WhatsApp account inside the mobile app (Settings → Account → Delete my account), then link it as a clean number.",
      "WhatsApp Business App (Coexistence): If your clinic already uses the WhatsApp Business App (not personal Messenger), Meta Embedded Signup v4 supports Coexistence in eligible regions by scanning a QR code from your Business App.",
    ],
  },
];

export const PLATFORM_FAQS: PlatformFaqItem[] = [
  // =========================================================================
  // 1. WHATSAPP & NUMBER LINKING JOURNEY
  // =========================================================================
  {
    id: "wa-existing-number",
    category: "whatsapp-linking",
    showInWhatsAppSetup: true,
    question: "Can I connect my existing WhatsApp number, or do I need a new number?",
    answer:
      "In most cases, clinics should use a dedicated new mobile/landline number not currently active on WhatsApp, or choose a Meta-provided virtual number. A number active on the regular personal WhatsApp Messenger app cannot be connected to the WhatsApp Cloud API at the same time.",
    bullets: [
      "Best practice — New SIM or Clinic Landline: Any number not registered on WhatsApp links in under 2 minutes via a 6-digit SMS or voice OTP.",
      "Meta Virtual Number (no SIM required): Inside Meta Embedded Signup, Meta can provision a virtual business number after verifying your business portfolio.",
      "Reusing an existing personal WhatsApp number: You must first delete the WhatsApp account inside your phone app (Settings → Account → Delete my account — simply uninstalling the app is not enough) before Meta allows Cloud API registration.",
      "Existing WhatsApp Business App (Coexistence): If the number runs on the WhatsApp Business App in an eligible region, Meta Embedded Signup v4 lets you link in Coexistence mode by scanning a QR code.",
    ],
    highlightNote:
      "Tip: Keeping your personal doctor mobile separate from your public clinic AI receptionist line also protects your personal privacy after OPD hours.",
    tags: ["existing whatsapp number", "new number", "personal whatsapp", "coexistence", "migrate", "sim"],
  },
  {
    id: "wa-virtual-number",
    category: "whatsapp-linking",
    showInWhatsAppSetup: true,
    question: "How does getting a virtual WhatsApp number from Meta work?",
    answer:
      "During Meta Embedded Signup, if your clinic does not want to purchase a separate SIM card or dedicate a landline, Meta offers cloud-hosted virtual business numbers in supported workflows once your Meta Business Portfolio is verified.",
    bullets: [
      "When prompted to add a phone number in the Meta popup, select the option to use a free Meta-provided business number where offered for your portfolio.",
      "Because there is no physical SIM card, verification is tied to your Meta Business Portfolio verification (clinic GST certificate, Shop & Establishment / Clinical Establishment certificate, MSME Udyam, or clinic utility/bank statement).",
      "Patients message that virtual number on WhatsApp just like any normal business account, and our 2-way clinic inbox + automated receptionist handle every chat.",
    ],
    tags: ["virtual number", "meta virtual number", "555 number", "business verification", "no sim"],
  },
  {
    id: "wa-landline-number",
    category: "whatsapp-linking",
    showInWhatsAppSetup: true,
    question: "Can I link my existing clinic landline number to WhatsApp?",
    answer:
      "Yes. Any fixed clinic landline that can receive direct incoming voice calls (and has never been registered on a WhatsApp mobile app) can be linked during Meta Embedded Signup.",
    bullets: [
      "Choose 'Phone Call' instead of 'Text Message (SMS)' on Meta's number verification step.",
      "Meta places an automated voice call to your reception landline and reads out the 6-digit verification code.",
      "Important: If your landline uses an IVR ('Press 1 for Reception'), temporarily route calls directly to a handset during signup because Meta's automated OTP call cannot press IVR extensions.",
    ],
    tags: ["landline", "reception phone", "voice call otp", "ivr", "fixed line"],
  },
  {
    id: "wa-checklist-before-signup",
    category: "whatsapp-linking",
    showInWhatsAppSetup: true,
    question: "What should I keep ready before clicking 'Connect clinic WhatsApp number'?",
    answer:
      "Having four details handy makes Meta Embedded Signup finish smoothly in a single 3-minute session:",
    bullets: [
      "A Facebook account with admin access to your clinic's Meta Business Portfolio (if you don't have a Business Portfolio yet, Meta lets you create one inside the popup).",
      "Your public clinic display name (matching your clinic signboard/letterhead so Meta approves the display name) and clinic website or social page URL.",
      "Immediate access to the phone or landline receiving the 6-digit SMS/voice OTP — unless you choose a Meta virtual number.",
      "Allow browser popups for www.mylumera.in so the Facebook Embedded Signup window is not blocked.",
    ],
    tags: ["checklist", "embedded signup", "facebook login", "meta business portfolio", "popup"],
  },
  {
    id: "wa-2fa-pin",
    category: "whatsapp-linking",
    showInWhatsAppSetup: true,
    question: "Why is Meta asking for an existing 6-digit Two-Step Verification PIN?",
    answer:
      "If your phone number previously had WhatsApp Two-Step Verification (2FA) enabled — or was previously registered on a WhatsApp Business Account — Meta requires that exact 6-digit PIN to complete Cloud API registration.",
    bullets: [
      "When Meta signals that an existing PIN is required, our setup card automatically displays a '6-digit PIN' field so you can complete registration without restarting Embedded Signup.",
      "If you forgot the prior 6-digit PIN, open Meta WhatsApp Manager → Phone Numbers → Two-step verification to reset or turn it off via the recovery email on that Meta Business account.",
    ],
    tags: ["pin", "6-digit pin", "two-step verification", "2fa", "registration error"],
  },
  {
    id: "wa-meta-billing-and-templates",
    category: "whatsapp-linking",
    showInWhatsAppSetup: true,
    question: "Who pays for WhatsApp messages, and how do message templates work?",
    answer: `${META_TECH_PROVIDER_STATEMENT} ${WHATSAPP_BILLED_BY_META} ${WHATSAPP_INR_PAYMENT}`,
    bullets: [
      "Zero markup from us: Your clinic owns its WhatsApp Business Account (WABA) and pays Meta directly at Meta's standard India conversation rates.",
      "24-hour customer service window: When a patient messages your clinic first (to book a slot, check timings, or ask a question), replies within 24 hours are service conversations.",
      "Proactive utility templates: Appointment reminders, queue alerts, and prescription/invoice notifications sent outside the 24-hour window use Meta utility templates — click 'Sync WhatsApp templates' in Clinic Settings after connecting.",
      "If Meta's card/UPI AutoPay fails, Meta pauses outbound delivery and we surface an immediate alert in your workspace.",
    ],
    tags: ["whatsapp pricing", "meta billing", "templates", "utility template", "inr payment", "waba"],
  },
  {
    id: "wa-polyclinic-vs-personal-doctor-number",
    category: "whatsapp-linking",
    question: "Can a polyclinic use one central WhatsApp number while visiting doctors keep their own?",
    answer:
      "Yes. Every clinic workspace supports one clinic-owned reception WABA line that routes across all departments and doctors on your roster, while individual doctors can optionally connect a personal practitioner WABA line.",
    bullets: [
      "Polyclinic central desk: Patients message one clinic number, browse available specialists (Cardiology, Gynaecology, Pediatrics, Dental, Physio, etc.), and book tokens into the right doctor's calendar.",
      "Visiting consultants: If a doctor consults across two clinics on Lumera using a personal practitioner number, our tenant resolver automatically routes returning patients or prompts new patients to pick which clinic location they want.",
    ],
    tags: ["polyclinic", "visiting doctor", "multiple clinics", "personal waba", "routing"],
  },

  // =========================================================================
  // 2. AI RECEPTIONIST & REGIONAL LANGUAGES
  // =========================================================================
  {
    id: "voice-vs-messaging-only",
    category: "voice-languages",
    question: "Can I choose between AI Voice Calls + WhatsApp chat versus WhatsApp Messaging-Only?",
    answer:
      "Yes. Inside WhatsApp Hub → Voice & Receptionist Settings, your clinic controls whether your connected line answers live voice calls or operates strictly via text.",
    bullets: [
      "Voice + Messaging Mode: Answers inbound patient calls and voice notes in natural Indian languages, checks real-time OPD slot availability, and books tokens automatically.",
      "Messaging-Only Mode: Automatically declines WhatsApp voice calls and instantly sends the caller a polite WhatsApp message (in their preferred language) with tap-to-book buttons for Appointments, Doctor Timings, and Clinic Location.",
    ],
    tags: ["voice calls", "messaging only", "maya", "ai receptionist", "call decline"],
  },
  {
    id: "regional-language-locking",
    category: "voice-languages",
    question: "How does multilingual support work when patients write or speak in Hindi, Marathi, or regional languages?",
    answer:
      "Our receptionist detects explicit language requests (such as 'Hindi mein baat karo', 'मराठीत बोला', or regional script messages) and locks the conversation into that language across follow-up turns.",
    bullets: [
      "Full textual & button localization: In Hindi and Marathi WhatsApp flows, both the entire message body and interactive quick-reply buttons stay in Devanagari without drifting back to English mid-chat.",
      "Additional Indian languages: Supports Tamil, Telugu, Bengali, Kannada, Malayalam, Gujarati, English, and spoken Hinglish in consult and voice workflows.",
      "Instant human handover: Anytime a patient taps 'Speak with Receptionist' (or staff clicks Take Over in the 2-Way Staff Inbox), automated replies pause so your front desk can chat directly.",
    ],
    tags: ["hindi", "marathi", "tamil", "telugu", "bengali", "multilingual", "language lock", "human handover"],
  },
  {
    id: "emergency-safety-routing",
    category: "voice-languages",
    question: "How does the automated receptionist handle medical emergencies?",
    answer:
      "The automated receptionist is strictly for outpatient scheduling, clinic information, and record retrieval — never emergency triage. Any message mentioning emergency red flags (chest pain, acute breathlessness, heavy bleeding, trauma, ambulance) immediately halts routine booking and displays emergency instructions (108 / 112 ambulance + nearest 24/7 ER).",
    tags: ["emergency", "108", "red flags", "clinical safety", "ambulance"],
  },

  // =========================================================================
  // 3. SHARED MOBILE NUMBERS (PETS, CHILDREN, FAMILY & FRIENDS)
  // =========================================================================
  {
    id: "shared-mobile-multi-pet-child-family",
    category: "shared-mobile",
    question: "Can one mobile number register multiple pets, multiple children, or a family member / friend?",
    answer:
      "Yes — shared-mobile household recognition is built across Reception, Quick-Add, Patients, Consultations, the Patient Portal, and WhatsApp booking.",
    bullets: [
      "Separate UHID & clinical chart per individual/pet: Registering a second child under one parent's phone, three pets (dogs/cats) under one pet parent's mobile, or an elderly parent/spouse/friend never overwrites the first person's chart.",
      "Explicit relationship tags: Tag each profile as Self, Child, Pet, Spouse / Partner, Parent, Family Member, or Friend / Caregiver alongside the primary mobile holder's name.",
      "Live Reception & Consult switchers: Typing a shared mobile number at Reception immediately lists every linked child, pet, or relative for 1-click check-in or '+ Register New Profile on This Mobile', and doctors can switch sibling/pet charts in 1 click mid-consult.",
      "Smart WhatsApp profile picker: When a shared-mobile household texts 'Book Appointment', the bot asks which pet, child, or family member the visit is for — or routes directly if named (e.g. 'Book for Mochi' or 'Book for my friend Karan').",
    ],
    tags: ["shared mobile", "multiple pets", "multiple children", "family member", "friend", "veterinary", "pediatrics", "same phone"],
  },

  // =========================================================================
  // 4. IN-CONSULT AMBIENT SCRIBE & SPECIALTY WORKFLOWS
  // =========================================================================
  {
    id: "ambient-scribe-consent-and-review",
    category: "clinical-scribe",
    question: "How does the In-Consult Ambient Scribe work, and can AI ever sign a prescription on its own?",
    answer:
      "Never. Every AI clinical output is strictly human-in-the-loop and consent-gated:",
    bullets: [
      "Recorded patient consent first: The consultation microphone stays locked until the clinician records an explicit patient-consent tick.",
      "Editable draft only: Spoken history and examination findings are structured into an editable SOAP note and draft prescription.",
      "Mandatory doctor acceptance: Nothing is saved to the permanent medical chart or dispatched to the patient until the prescribing doctor reviews, edits, and explicitly accepts the draft.",
      "Transcript minimization: Raw audio/transcripts are scrubbed from saved draft payloads (only a cryptographic SHA-256 hash is retained for audit integrity).",
    ],
    tags: ["ambient scribe", "patient consent", "soap note", "prescription", "doctor review", "safety"],
  },
  {
    id: "supported-specialties-and-veterinary",
    category: "clinical-scribe",
    question: "Which medical, surgical, dental, rehab, veterinary, and wellness specialties are supported?",
    answer:
      "Each practice type loads a purpose-built clinical or operational workspace rather than forcing every profession into a generic GP pad:",
    bullets: [
      "Obstetrics & Gynaecology: 4-mode studio (Antenatal/EDD/DIPSI/NST, Fertility & TVS Follicular Study, FIGO PALM-COEIN Gynaecology, Postnatal/Menopause) + statutory PCPNDT Form F USG log.",
      "Veterinary Medicine: Multi-pet owner households, WSAVA India dog & cat vaccination schedules, live mg/kg weight-based dosing, tick-fever (Ehrlichia/Babesia) triage, spay/neuter ASA surgery notes, and 10-day bite observation log.",
      "Pediatrics: IAP-ACVIP 2025 & India UIP immunization charts with vial batch stock deduction, growth percentiles, and weight-based dosing.",
      "Specialist Medical Packs: General Medicine, Cardiology (NYHA/ASCVD/Echo), Orthopedics, Dermatology, ENT, Neurology, and Ophthalmology.",
      "Dedicated Non-GP Verticals: Dental Surgery (interactive odontogram & chair queue), Physiotherapy & Rehab (VAS/ROM session boards), Mental Health Therapy (counseling notes), Wellness & Spas, and Independent Consultants.",
    ],
    tags: ["specialties", "gynaecology", "veterinary", "pediatrics", "dental", "physiotherapy", "cardiology", "odontogram"],
  },
  {
    id: "custom-letterhead-and-rx-pdf",
    category: "clinical-scribe",
    question: "Can I customize my clinic letterhead, OPD slot durations, and print or WhatsApp prescriptions?",
    answer:
      "Yes. You can configure your clinic name, qualification, medical/veterinary/dental council registration number, address, custom footer disclaimer, OPD slot duration (e.g. 10, 15, or 30 minutes), overlap limits, and 1-click specialty drug presets — generating clean A4 printouts and digital Rx PDFs.",
    tags: ["letterhead", "pdf", "print", "presets", "slot duration", "registration number"],
  },

  // =========================================================================
  // 5. PRICING, FREE TRIAL, BILLING & PATIENT PAYMENTS
  // =========================================================================
  {
    id: "free-trial-and-cancellation",
    category: "pricing-billing",
    question: `How does the ${TRIAL_DAYS}-day free trial work, and is a credit card required to start?`,
    answer: `Every new clinic starts with ${TRIAL_DAYS} days free with no card needed for Lumera. You get full access to your specialty workspace, OPD queue, prescriptions, and onboarding.`,
    bullets: [
      "Optional AutoPay: Add a payment method only when you decide to continue.",
      "No lock-in: Cancel any time on the Billing page in one click — cancelling is never harder than signing up.",
      "If you choose not to subscribe when the trial ends, your workspace moves to read-only mode so you can still view and export your clinic records.",
    ],
    tags: ["free trial", "30-day trial", "no credit card", "cancel", "autopay"],
  },
  {
    id: "patient-payments-zero-commission",
    category: "pricing-billing",
    question: "Does Lumera collect patient consultation fees or take a cut of clinic revenue?",
    answer:
      "No. Patients pay your clinic directly via your own reception UPI QR, card terminal, cash counter, or clinic Razorpay link. Lumera never collects, holds, or deducts commissions from patient payments, and gives you full itemized OPD/procedure invoicing and daily revenue tracking.",
    tags: ["patient payments", "commission", "upi", "invoices", "gst", "razorpay"],
  },
  {
    id: "gst-and-refund-policy",
    category: "pricing-billing",
    question: "Do subscription prices include GST, and what is the refund window?",
    answer:
      "All published subscription prices are exclusive of 18% GST. Add your clinic GSTIN on the Billing page to receive a compliant B2B GST tax invoice.",
    bullets: [
      "Annual plans include a 7-day refund window from the paid start date (processed within 15 business days with a GST credit note).",
      "Monthly plans are non-refundable, and cancelling stops the next monthly renewal immediately.",
      `Multi-doctor clinics: Polyclinic plans include up to 3 doctors, with transparent per-doctor add-ons from the 4th to 10th doctor (contact ${CONTACT_EMAIL} for 11+ doctors).`,
    ],
    tags: ["gst", "gstin", "refund", "annual plan", "monthly plan", "extra doctors"],
  },

  // =========================================================================
  // 6. DATA PRIVACY, DPDP ACT, ABDM SANDBOX & RECORDS
  // =========================================================================
  {
    id: "data-ownership-and-retention",
    category: "privacy-records",
    question: "Who owns our patient records, and what happens to our data if we leave?",
    answer:
      "Your clinic retains ownership of its clinical records, isolated strictly within your tenant workspace.",
    bullets: [
      "90-day export window: After cancellation, clinical records remain locked and exportable by your clinic for 90 days before permanent deletion.",
      "Tax law retention: Subscription and tax billing records are retained for 8 years as required under Indian tax regulations.",
      `Early deletion or transfer: Write to ${CONTACT_EMAIL} at any time to request immediate export or deletion of your workspace records.`,
    ],
    tags: ["data ownership", "export", "retention", "90 days", "delete account", "tenant isolation"],
  },
  {
    id: "dpdp-and-abdm-sandbox-status",
    category: "privacy-records",
    question: "How do you handle India's DPDP Act 2023, patient consent, and ABHA / ABDM (sandbox) integration?",
    answer:
      "Lumera is engineered around India's Digital Personal Data Protection (DPDP) Act 2023 principles — enforcing tenant-level database isolation, role-based chart redaction (receptionists cannot write prescriptions or view unredacted clinical notes), explicit consent logs before ambient audio capture or document storage, and tamper-evident audit logs. ABHA linking and ABDM records are currently in sandbox testing and not yet live.",
    tags: ["dpdp", "privacy", "security", "role based access", "abha sandbox", "abdm sandbox"],
  },
];

export const WHATSAPP_SETUP_FAQS: PlatformFaqItem[] = PLATFORM_FAQS.filter(
  (item) => item.showInWhatsAppSetup
);

export function buildFaqPageJsonLd(items: PlatformFaqItem[] = PLATFORM_FAQS) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: [
          item.answer,
          ...(item.bullets && item.bullets.length > 0 ? item.bullets.map((b) => `• ${b}`) : []),
          ...(item.highlightNote ? [item.highlightNote] : []),
        ].join(" "),
      },
    })),
  };
}

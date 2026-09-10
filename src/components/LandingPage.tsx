import React, { useEffect, useState } from "react";
import {
  Sparkles,
  Phone,
  Calendar,
  Clock,
  TrendingUp,
  Bot,
  Mic,
  MicOff,
  MessageCircle,
  CalendarCheck,
  Bell,
  CreditCard,
  ShieldCheck,
  Stethoscope,
  Smile,
  HeartPulse,
  Flower2,
  Activity,
  Briefcase,
  ArrowRight,
  Check,
  Globe,
  MessageSquare,
  Lock,
  FileCode2,
  CheckCircle2,
  Play,
  RotateCcw,
  Send,
  ExternalLink,
  ShieldAlert,
  Award,
  Shield
} from "lucide-react";
import { useNav } from "../nav/NavigationContext";

interface SitePayload {
  settings: {
    brandName: string;
    badgeText: string;
    heroTitle: string;
    heroSubtitle: string;
    contactEmail: string;
    ctaPrimary: string;
    ctaSecondary: string;
    ctaBannerTitle: string;
    ctaBannerSubtitle: string;
    logoUrl: string;
    clinicName: string;
  };
  stats: { icon: string; value: string; label: string }[];
  pains: { id: string; title: string; items: string[] }[];
  features: { id: string; title: string; desc: string }[];
  personas: { id: string; title: string; desc: string }[];
  testimonials: { id: string; quote: string; name: string; role: string }[];
  policies: { slug: string; title: string }[];
}

const STAT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  calendar: Calendar,
  clock: Clock,
  trend: TrendingUp,
  bot: Bot,
};

const FEATURE_ICONS = [Mic, MessageCircle, CalendarCheck, Bell, CreditCard, ShieldCheck];
const FEATURE_COLORS = [
  "from-purple-500 to-indigo-500",
  "from-green-500 to-teal-500",
  "from-blue-500 to-cyan-500",
  "from-orange-500 to-red-500",
  "from-pink-500 to-purple-500",
  "from-teal-500 to-green-500",
];
const PERSONA_ICONS = [Stethoscope, Smile, HeartPulse, Flower2, Activity, Briefcase];
const PERSONA_COLORS = [
  "from-indigo-500 to-purple-600",
  "from-teal-500 to-cyan-600",
  "from-violet-500 to-fuchsia-600",
  "from-rose-400 to-orange-500",
  "from-emerald-500 to-teal-600",
  "from-slate-600 to-indigo-700",
];

export const REGIONAL_LANGUAGES = [
  { name: "Hindi", script: "हिंदी", greeting: "नमस्ते, अपॉइंटमेंट बुक करें", flag: "🇮🇳" },
  { name: "Tamil", script: "தமிழ்", greeting: "வணக்கம், முன்பதிவு செய்க", flag: "🇮🇳" },
  { name: "Telugu", script: "తెలుగు", greeting: "నమస్కారం, అపాయింట్‌మెంట్ తీసుకోండి", flag: "🇮🇳" },
  { name: "Marathi", script: "मराठी", greeting: "नमस्कार, अपॉइंटमेंट बुक करा", flag: "🇮🇳" },
  { name: "Bengali", script: "বাংলা", greeting: "নমস্কার, অ্যাপয়েন্টমেন্ট বুক করুন", flag: "🇮🇳" },
  { name: "English", script: "English", greeting: "Hello, schedule your consultation", flag: "🌐" },
];

const FALLBACK: SitePayload = {
  settings: {
    brandName: "Lumera",
    badgeText: "ABDM-aligned AI Healthcare OS & Voice Receptionist (sandbox path)",
    heroTitle: "Next-Gen AI Receptionist & Ambient Clinical Scribe",
    heroSubtitle:
      "Automate patient call answering, 3-click WhatsApp appointment scheduling, and ambient consultation SOAP notes across regional Indian languages.",
    contactEmail: "contact@lumera.health",
    ctaPrimary: "Experience Doctor EHR",
    ctaSecondary: "Open Clinical Demo",
    ctaBannerTitle: "Ready to Supercharge Your Practice?",
    ctaBannerSubtitle: "Experience seamless AI receptionist calls, smart prescriptions, and compliant ABDM records.",
    logoUrl: "",
    clinicName: "Lumera Health Systems",
  },
  stats: [
    { icon: "calendar", value: "50K+", label: "Appointments Booked" },
    { icon: "clock", value: "12K+", label: "Doctor Hours Saved" },
    { icon: "trend", value: "96%", label: "No-Show Reduction" },
    { icon: "bot", value: "24/7", label: "Multi-Lingual AI Live" },
  ],
  pains: [],
  features: [],
  personas: [],
  testimonials: [],
  policies: [
    { slug: "privacy-policy", title: "Privacy Policy" },
    { slug: "terms-of-service", title: "Terms of Service" },
    { slug: "data-deletion-instructions", title: "Data Deletion Instructions" },
    { slug: "security", title: "Data Security" },
  ],
};

// Interactive Ambient Scribe Simulation Presets
const AMBIENT_DEMOS = [
  {
    id: "hinglish",
    label: "Hinglish (Fever & Cough)",
    doctor: "Namaste Rajesh ji, kya takleef ho rahi hai aapko?",
    patient: "Doctor saab, 2 din se bohot tez fever hai, throat me pain hai khana nigalte waqt, aur continuous runny nose aur body ache hai.",
    examination: "Temperature: 100.4°F, Posterior pharyngeal wall congested with tonsillar erythema. Lungs clear.",
    soap: {
      subjective: "Acute viral upper respiratory symptoms, fever up to 100.4°F, sore throat & severe myalgia x 2 days.",
      objective: "Vitals: BP 122/80 mmHg, Pulse 84 bpm, Temp 100.4°F, SpO2 98%. Pharynx congested, bilateral tonsillar erythema.",
      assessment: "Acute Viral Pharyngitis & Upper Respiratory Infection (ICD-10: J06.9)",
      plan: "1. Tab Dolo 650mg TDS x 3 days\n2. Tab Montair-LC OD at bedtime x 5 days\n3. Warm saline gargles 3x daily",
    },
    fhir: {
      resourceType: "Bundle",
      type: "transaction",
      entry: [
        {
          resource: {
            resourceType: "Encounter",
            status: "finished",
            class: { code: "AMB", display: "Ambulatory" },
            subject: { reference: "Patient/UHID-IND-7782" }
          }
        },
        {
          resource: {
            resourceType: "Condition",
            clinicalStatus: "active",
            code: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: "J06.9", display: "Acute upper respiratory infection" }] }
          }
        },
        {
          resource: {
            resourceType: "MedicationRequest",
            status: "active",
            intent: "order",
            medicationCodeableConcept: { text: "Dolo 650mg (Paracetamol)" },
            dosageInstruction: [{ text: "1 tablet after food three times daily" }]
          }
        }
      ]
    }
  },
  {
    id: "marathi",
    label: "Marathi (Knee Osteoarthritis)",
    doctor: "नमस्कार काका, गुडघ्याचा त्रास कसा आहे?",
    patient: "गेल्या आठवड्यापासून डाव्या गुडघ्यात खूप तीव्र वेदना होत आहेत. जिने चढताना गुडघा कडक होतो आणि कट-कट आवाज येतो.",
    examination: "Left knee medial joint tenderness, crepitus on passive flexion. ROM limited to 105 degrees.",
    soap: {
      subjective: "Left knee chronic stiffness and mechanical joint crepitus aggravated on climbing stairs x 1 week.",
      objective: "Left knee: Medial joint line tenderness (+), Crepitus on passive flexion, ROM restricted to 105°.",
      assessment: "Osteoarthritis of Left Knee Joint (ICD-10: M17.12)",
      plan: "1. Tab Aceclofenac + Paracetamol SOS x 5 days\n2. Cap Diacerein + Glucosamine OD x 30 days\n3. Physiotherapy Quad strengthening protocol",
    },
    fhir: {
      resourceType: "Bundle",
      type: "transaction",
      entry: [
        {
          resource: {
            resourceType: "Condition",
            clinicalStatus: "active",
            code: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: "M17.12", display: "Unilateral primary osteoarthritis, left knee" }] }
          }
        },
        {
          resource: {
            resourceType: "ServiceRequest",
            status: "active",
            intent: "order",
            code: { text: "Physiotherapy Knee Quadriceps Rehabilitation" }
          }
        }
      ]
    }
  }
];

export const LandingPage: React.FC = () => {
  const [site, setSite] = useState<SitePayload>(FALLBACK);
  const { go } = useNav();

  // Ambient Scribe Interactive Simulator State
  const [selectedAmbientIndex, setSelectedAmbientIndex] = useState(0);
  const [activeOutputTab, setActiveOutputTab] = useState<"soap" | "fhir">("soap");
  const [isSimulatingAudio, setIsSimulatingAudio] = useState(false);
  const [scribeProgress, setScribeProgress] = useState(100);

  // WhatsApp Concierge Simulator State
  const [chatStep, setChatStep] = useState<number>(1);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/public/site")
      .then((r) => r.json())
      .then((d) =>
        setSite({
          ...FALLBACK,
          ...d,
          settings: { ...FALLBACK.settings, ...(d.settings || {}) },
          stats: Array.isArray(d.stats) && d.stats.length ? d.stats : FALLBACK.stats,
          pains: d.pains || FALLBACK.pains,
          features: d.features || FALLBACK.features,
          personas: d.personas || FALLBACK.personas,
          testimonials: d.testimonials || FALLBACK.testimonials,
          policies: d.policies || FALLBACK.policies,
        })
      )
      .catch(() => undefined);
  }, []);

  const s = site.settings;
  const currentDemo = AMBIENT_DEMOS[selectedAmbientIndex];

  const handleSimulateAudio = () => {
    setIsSimulatingAudio(true);
    setScribeProgress(20);
    setTimeout(() => setScribeProgress(60), 600);
    setTimeout(() => {
      setScribeProgress(100);
      setIsSimulatingAudio(false);
    }, 1200);
  };

  const handleBookSlot = (slot: string) => {
    setSelectedSlot(slot);
    setChatStep(2);
  };

  const handleResetChat = () => {
    setChatStep(1);
    setSelectedSlot(null);
  };

  return (
    <div className="h-full overflow-y-auto text-white font-sans selection:bg-purple-600 selection:text-white bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 scroll-smooth">
      {/* 1. TOP NAVIGATION BAR: Consolidated Single "Sign In" Button */}
      <header className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between border-b border-white/10">
        <button type="button" onClick={() => go("landing")} className="flex items-center gap-3">
          {s.logoUrl ? (
            <img src={s.logoUrl} alt={s.brandName} className="h-10 w-10 rounded-xl object-cover shadow-lg shadow-purple-500/30" />
          ) : (
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/30">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
          )}
          <span className="font-manrope text-2xl font-bold tracking-tight text-white">{s.brandName}</span>
        </button>

        {/* Consolidated Single Sign In Button */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => go("login", { loginNext: "app", loginMode: "signin" })}
            className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold shadow-md shadow-blue-500/20 transition-all cursor-pointer flex items-center gap-2"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </button>
        </div>
      </header>

      {/* HERO SECTION */}
      <section className="max-w-5xl mx-auto px-4 pt-12 pb-14 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/20 border border-blue-400/30 text-xs font-semibold text-blue-300 mb-6">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>{s.badgeText}</span>
        </div>

        <h1 className="font-manrope text-4xl sm:text-6xl font-extrabold leading-tight tracking-tight text-white">
          {s.heroTitle}
        </h1>

        {/* Regional Language Scripts in Sub-headline */}
        <p className="mt-5 text-base sm:text-xl text-slate-300 max-w-3xl mx-auto leading-relaxed">
          Let Lumera AI answer clinic phone calls, book appointments via WhatsApp, and generate clinical prescriptions in{" "}
          <span className="text-purple-300 font-semibold">हिंदी (Hindi)</span>,{" "}
          <span className="text-teal-300 font-semibold">தமிழ் (Tamil)</span>,{" "}
          <span className="text-cyan-300 font-semibold">తెలుగు (Telugu)</span>,{" "}
          <span className="text-amber-300 font-semibold">मराठी (Marathi)</span>,{" "}
          <span className="text-rose-300 font-semibold">বাংলা (Bengali)</span> &amp;{" "}
          <span className="text-blue-300 font-semibold">English</span>.
        </p>

        {/* HERO CTA BUTTON: Direct routing to single-card auth */}
        <div className="mt-8 flex flex-col items-center justify-center">
          <button
            type="button"
            onClick={() => go("login", { loginNext: "app", loginMode: "signin" })}
            className="inline-flex items-center gap-2.5 px-9 py-4 rounded-xl bg-blue-600 hover:bg-blue-500 font-manrope font-bold text-base text-white shadow-xl shadow-blue-600/30 hover:shadow-blue-600/50 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
          >
            <Stethoscope className="w-5 h-5 text-blue-200" />
            <span>Try for free</span>
            <ArrowRight className="w-4 h-4 text-blue-200" />
          </button>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Instant Sandbox Access
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> No Credit Card Required
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> ABDM sandbox milestone path
            </span>
          </div>
        </div>

        {/* 2. AUTO-SCROLLING REGIONAL NATIVE LANGUAGE TICKER */}
        <div className="mt-8 overflow-hidden relative max-w-5xl mx-auto py-2">
          <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-slate-950 to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-slate-950 to-transparent z-10 pointer-events-none" />

          <div className="animate-marquee gap-3">
            {[...REGIONAL_LANGUAGES, ...REGIONAL_LANGUAGES, ...REGIONAL_LANGUAGES].map((lang, idx) => (
              <div
                key={idx}
                className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-slate-800/80 border border-slate-700/80 backdrop-blur-xs text-xs whitespace-nowrap shadow-xs hover:border-blue-500/50 transition-colors"
              >
                <span className="text-sm">{lang.flag}</span>
                <span className="font-bold text-slate-100">{lang.script}</span>
                <span className="text-slate-400 font-mono text-[10px]">({lang.name})</span>
                <span className="text-slate-500 text-[10px]">•</span>
                <span className="text-purple-300 font-medium text-[11px]">“{lang.greeting}”</span>
              </div>
            ))}
          </div>
        </div>

        {/* 3. ABDM & META COMPLIANCE STRIP */}
        <div className="mt-8 max-w-4xl mx-auto bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-4 shadow-xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center divide-y md:divide-y-0 md:divide-x divide-slate-800">
            <div className="flex items-center justify-center gap-2.5 px-3 py-1">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="text-left">
                <span className="block text-xs font-bold text-slate-100 uppercase tracking-wider">ABDM M1–M3 · NHA sandbox path</span>
                <span className="text-[11px] text-slate-400 font-medium">Ayushman Bharat Digital Mission</span>
              </div>
            </div>

            <div className="flex items-center justify-center gap-2.5 px-3 py-1">
              <div className="w-9 h-9 rounded-lg bg-green-500/20 text-green-400 flex items-center justify-center shrink-0">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div className="text-left">
                <span className="block text-xs font-bold text-slate-100 uppercase tracking-wider">WhatsApp Cloud API · Meta Tech Provider path</span>
                <span className="text-[11px] text-slate-400 font-medium">SANDBOX readiness — App Review not submitted</span>
              </div>
            </div>

            <div className="flex items-center justify-center gap-2.5 px-3 py-1">
              <div className="w-9 h-9 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
                <Lock className="w-5 h-5" />
              </div>
              <div className="text-left">
                <span className="block text-xs font-bold text-slate-100 uppercase tracking-wider">256-Bit Encryption / Built for DPDP Act 2023</span>
                <span className="text-[11px] text-slate-400 font-medium">Digital Personal Data Protection Act 2023</span>
              </div>
            </div>
          </div>
        </div>

        {/* Practice Stats Metric Cards: Highlight Time Saved per Consultation */}
        <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm px-4 py-5 hover:border-blue-500/30 transition-all">
            <Clock className="w-6 h-6 mx-auto mb-2 text-blue-400" />
            <div className="font-manrope text-2xl sm:text-3xl font-bold text-white">12 mins</div>
            <div className="text-xs text-slate-400 mt-1">Saved per Consultation</div>
            <span className="inline-block mt-2 px-2 py-0.5 rounded-full bg-blue-500/10 text-[10px] text-blue-300 font-medium">Zero Manual Typing</span>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm px-4 py-5 hover:border-purple-500/30 transition-all">
            <TrendingUp className="w-6 h-6 mx-auto mb-2 text-purple-400" />
            <div className="font-manrope text-2xl sm:text-3xl font-bold text-white">3.5 hrs</div>
            <div className="text-xs text-slate-400 mt-1">Saved Daily per Clinician</div>
            <span className="inline-block mt-2 px-2 py-0.5 rounded-full bg-purple-500/10 text-[10px] text-purple-300 font-medium">Documentation Fatigue: Zero</span>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm px-4 py-5 hover:border-emerald-500/30 transition-all">
            <MessageCircle className="w-6 h-6 mx-auto mb-2 text-emerald-400" />
            <div className="font-manrope text-2xl sm:text-3xl font-bold text-white">94%</div>
            <div className="text-xs text-slate-400 mt-1">WhatsApp Self-Service Rate</div>
            <span className="inline-block mt-2 px-2 py-0.5 rounded-full bg-emerald-500/10 text-[10px] text-emerald-300 font-medium">Automated Booking &amp; Tokens</span>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm px-4 py-5 hover:border-cyan-500/30 transition-all">
            <ShieldCheck className="w-6 h-6 mx-auto mb-2 text-cyan-400" />
            <div className="font-manrope text-2xl sm:text-3xl font-bold text-white">100%</div>
            <div className="text-xs text-slate-400 mt-1">ABDM sandbox-ready architecture</div>
            <span className="inline-block mt-2 px-2 py-0.5 rounded-full bg-cyan-500/10 text-[10px] text-cyan-300 font-medium">FHIR R4 &amp; ABHA-aligned</span>
          </div>
        </div>
      </section>

      {/* CORE CLINICAL BENEFITS SECTION */}
      <section className="max-w-6xl mx-auto px-4 py-16 border-t border-slate-800/80">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-blue-500/20 border border-blue-500/30 text-xs text-blue-300 mb-3">
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
            <span>Engineered for Indian Healthcare Workflows</span>
          </div>
          <h2 className="font-manrope text-3xl sm:text-4xl font-extrabold text-white">
            Core Clinical Benefits
          </h2>
          <p className="text-slate-400 mt-2 max-w-2xl mx-auto text-sm">
            Everything your practice needs to eliminate typing, automate patient communication, and stay on the ABDM sandbox path.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Benefit 1: Ambient AI Scribe */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 flex flex-col justify-between hover:border-purple-500/50 hover:shadow-xl hover:shadow-purple-500/10 transition-all">
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center justify-center text-xl">
                🎙️
              </div>
              <div>
                <h3 className="font-manrope text-xl font-bold text-white">
                  Ambient AI Scribe
                </h3>
                <p className="text-xs font-semibold text-purple-400 mt-0.5">
                  Zero typing, instant SOAP &amp; FHIR Rx notes
                </p>
              </div>
              <p className="text-slate-300 text-xs leading-relaxed">
                Zero typing during consultations. Ambiently transcribes natural doctor-patient dialogues in <strong className="text-purple-300">Hindi, Tamil, Telugu, Marathi, Bengali &amp; English</strong>.
              </p>
              <ul className="space-y-2 text-xs text-slate-400 pt-2 border-t border-slate-800">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Instant SOAP note generation in seconds</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Automated ICD-10 &amp; SNOMED-CT clinical coding</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>ABDM-aligned FHIR R4 Bundle output</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800/80">
              <span className="text-[11px] font-semibold text-purple-400 flex items-center gap-1">
                Eliminates 3+ hours of daily documentation
              </span>
            </div>
          </div>

          {/* Benefit 2: WhatsApp AI Receptionist */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 flex flex-col justify-between hover:border-emerald-500/50 hover:shadow-xl hover:shadow-emerald-500/10 transition-all">
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center text-xl">
                💬
              </div>
              <div>
                <h3 className="font-manrope text-xl font-bold text-white">
                  24/7 WhatsApp AI Receptionist
                </h3>
                <p className="text-xs font-semibold text-emerald-400 mt-0.5">
                  Automated booking &amp; token reminders
                </p>
              </div>
              <p className="text-slate-300 text-xs leading-relaxed">
                Automate appointment booking, live OPD token updates, and follow-up reminders via WhatsApp Cloud API (Meta Tech Provider path).
              </p>
              <ul className="space-y-2 text-xs text-slate-400 pt-2 border-t border-slate-800">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>3-click patient self-booking directly in chat</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Live OPD queue token &amp; ETA notifications</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Instant digital PDF prescription dispatch</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800/80">
              <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
                94% front-desk automation rate
              </span>
            </div>
          </div>

          {/* Benefit 3: Smart Rx Studio & Lab OCR */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 flex flex-col justify-between hover:border-cyan-500/50 hover:shadow-xl hover:shadow-cyan-500/10 transition-all">
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 flex items-center justify-center text-xl">
                🩺
              </div>
              <div>
                <h3 className="font-manrope text-xl font-bold text-white">
                  Smart Rx Studio &amp; Lab OCR
                </h3>
                <p className="text-xs font-semibold text-cyan-400 mt-0.5">
                  Real-time drug interactions &amp; OCR analytics
                </p>
              </div>
              <p className="text-slate-300 text-xs leading-relaxed">
                Evidence-based prescribing with automated drug interactions, specialty toolbars, and instant blood report OCR analytics.
              </p>
              <ul className="space-y-2 text-xs text-slate-400 pt-2 border-t border-slate-800">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Real-time drug-drug interaction warnings</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Generic / brand swap · Jan Aushadhi planned</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>One-click lab report OCR with trend graphing</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800/80">
              <span className="text-[11px] font-semibold text-cyan-400 flex items-center gap-1">
                Cardiology, Physio, Ortho &amp; Peds toolbars
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. INTERACTIVE FEATURE PREVIEWS: Experience Lumera Section */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-purple-500/20 border border-purple-500/30 text-xs text-purple-300 mb-3">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>Interactive Live Sandbox</span>
          </div>
          <h2 className="font-manrope text-3xl sm:text-4xl font-extrabold text-white">Experience Lumera In Action</h2>
          <p className="text-slate-400 mt-2 max-w-2xl mx-auto text-sm">
            Test drive our ambient voice consultation scribe and automated WhatsApp booking flow before you sign in.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* PREVIEW 1: AMBIENT AI SCRIBE SIMULATOR */}
          <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-lg bg-blue-600/30 border border-blue-400/40 flex items-center justify-center text-blue-400">
                  <Mic className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white flex items-center gap-1.5">
                    Ambient AI Scribe Simulator
                  </h3>
                  <span className="text-[10px] text-slate-400">Multi-Lingual Audio → Structured FHIR Rx</span>
                </div>
              </div>

              {/* Language preset buttons */}
              <div className="flex gap-1">
                {AMBIENT_DEMOS.map((d, i) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      setSelectedAmbientIndex(i);
                      handleSimulateAudio();
                    }}
                    className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors ${
                      selectedAmbientIndex === i
                        ? "bg-blue-600 text-white"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    {d.label.split(" ")[0]}
                  </button>
                ))}
              </div>
            </div>

            {/* Audio dialogue transcription snippet */}
            <div className="mt-4 p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2 text-xs">
              <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                <span className="flex items-center gap-1 text-rose-400">
                  <span className={`w-2 h-2 rounded-full ${isSimulatingAudio ? 'bg-rose-500 animate-ping' : 'bg-emerald-500'}`} />
                  {isSimulatingAudio ? "Transcribing Voice Audio..." : "Ambient Mic Complete"}
                </span>
                <button
                  onClick={handleSimulateAudio}
                  disabled={isSimulatingAudio}
                  className="text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1"
                >
                  <Play className="w-3 h-3" /> Re-play Audio
                </button>
              </div>

              <div className="space-y-1 text-slate-300 font-mono text-[11px] leading-relaxed">
                <p><span className="text-blue-400 font-bold">Doctor:</span> {currentDemo.doctor}</p>
                <p><span className="text-emerald-400 font-bold">Patient:</span> {currentDemo.patient}</p>
                <p className="text-slate-400 italic"><span className="text-purple-400 font-bold">Exam:</span> {currentDemo.examination}</p>
              </div>
            </div>

            {/* Output Tabs: SOAP Note vs FHIR JSON */}
            <div className="mt-4 flex-1 flex flex-col">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex space-x-2">
                  <button
                    onClick={() => setActiveOutputTab("soap")}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                      activeOutputTab === "soap"
                        ? "bg-blue-600 text-white shadow-xs"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Clinical SOAP Note
                  </button>
                  <button
                    onClick={() => setActiveOutputTab("fhir")}
                    className={`px-3 py-1 rounded-md text-xs font-bold flex items-center gap-1 transition-all ${
                      activeOutputTab === "fhir"
                        ? "bg-purple-600 text-white shadow-xs"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <FileCode2 className="w-3.5 h-3.5" />
                    FHIR R4 JSON
                  </button>
                </div>
                <span className="text-[10px] text-emerald-400 font-mono">100% Extracted</span>
              </div>

              <div className="mt-3 flex-1 overflow-hidden">
                {activeOutputTab === "soap" ? (
                  <div className="space-y-2.5 text-xs bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Assessment &amp; ICD-10:</span>
                      <strong className="text-emerald-300 text-xs font-semibold">{currentDemo.soap.assessment}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Subjective Findings:</span>
                      <p className="text-slate-300 text-[11px]">{currentDemo.soap.subjective}</p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Prescribed Plan &amp; Rx:</span>
                      <pre className="text-slate-200 font-mono text-[11px] whitespace-pre-line leading-relaxed">
                        {currentDemo.soap.plan}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 max-h-56 overflow-y-auto">
                    <pre className="font-mono text-[10px] text-purple-300 leading-tight">
                      {JSON.stringify(currentDemo.fhir, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* PREVIEW 2: WHATSAPP CONCIERGE DEMO FRAME */}
          <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-2xl flex flex-col items-center">
            <div className="w-full flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-lg bg-green-500/20 text-green-400 flex items-center justify-center">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">WhatsApp Receptionist Test-Drive</h3>
                  <span className="text-[10px] text-slate-400">Automated 3-Click Appointment Booking</span>
                </div>
              </div>

              <button
                onClick={handleResetChat}
                className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 font-semibold"
              >
                <RotateCcw className="w-3 h-3" /> Reset Demo
              </button>
            </div>

            {/* Mobile Phone Mockup Frame */}
            <div className="w-full max-w-sm rounded-3xl bg-slate-950 border-4 border-slate-800 p-3 shadow-2xl space-y-3">
              {/* WhatsApp Header */}
              <div className="bg-emerald-800 text-white rounded-xl p-2.5 flex items-center space-x-2.5 shadow-sm">
                <div className="w-7 h-7 rounded-full bg-white text-emerald-800 font-bold text-xs flex items-center justify-center">
                  L
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-bold">Lumera Clinic Assistant</span>
                    <CheckCircle2 className="w-3 h-3 text-emerald-300 fill-emerald-300 text-emerald-900" />
                  </div>
                  <span className="text-[9px] text-emerald-200 block">Simulator Business Account</span>
                </div>
              </div>

              {/* Chat Thread */}
              <div className="space-y-2.5 text-xs py-1 min-h-[220px]">
                {/* Incoming Patient Query */}
                <div className="flex justify-end">
                  <div className="bg-emerald-900/80 text-emerald-100 rounded-2xl rounded-tr-xs p-2.5 max-w-[85%] text-[11px] shadow-sm">
                    Namaste! I want to book a consultation with Dr. Siddharth Varma for severe shoulder pain tomorrow.
                  </div>
                </div>

                {/* Bot Response */}
                <div className="flex justify-start">
                  <div className="bg-slate-800 text-slate-100 rounded-2xl rounded-tl-xs p-2.5 max-w-[90%] text-[11px] space-y-1.5 shadow-sm">
                    <p className="font-semibold text-emerald-400">Namaste! 🙏 Welcome to Lumera Health.</p>
                    <p>Dr. Siddharth Varma (Physiotherapy &amp; Rehab) has 2 slots available tomorrow:</p>
                    <div className="space-y-1 pt-1">
                      <div className="p-1 rounded bg-slate-900/60 font-mono text-[10px] text-blue-300">
                        1️⃣ 04:30 PM - 05:00 PM (Token #14)
                      </div>
                      <div className="p-1 rounded bg-slate-900/60 font-mono text-[10px] text-blue-300">
                        2️⃣ 06:00 PM - 06:30 PM (Token #15)
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 1: Clickable Action Chips */}
                {chatStep === 1 && (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block text-center">
                      Tap a slot to test-drive:
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleBookSlot("04:30 PM (Token #14)")}
                        className="py-1.5 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-sm transition-all cursor-pointer text-center"
                      >
                        ⚡ Book 4:30 PM Slot
                      </button>
                      <button
                        onClick={() => handleBookSlot("06:00 PM (Token #15)")}
                        className="py-1.5 px-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-sm transition-all cursor-pointer text-center"
                      >
                        ⚡ Book 6:00 PM Slot
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 2: Instant Booking Confirmation */}
                {chatStep === 2 && (
                  <>
                    <div className="flex justify-end">
                      <div className="bg-emerald-900/80 text-emerald-100 rounded-2xl rounded-tr-xs p-2.5 max-w-[85%] text-[11px] shadow-sm">
                        Please confirm my slot for {selectedSlot}.
                      </div>
                    </div>
                    <div className="flex justify-start">
                      <div className="bg-emerald-950/90 border border-emerald-700/80 text-emerald-100 rounded-2xl rounded-tl-xs p-3 max-w-[95%] text-[11px] space-y-1 shadow-md">
                        <div className="flex items-center gap-1.5 font-bold text-emerald-300 text-xs">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Appointment Confirmed!</span>
                        </div>
                        <p className="text-[10px] text-emerald-200">
                          Dr. Siddharth Varma • {selectedSlot}
                        </p>
                        <p className="text-[10px] text-slate-300 font-mono">
                          UHID: IND-2026-9041 • Clinic Room 102
                        </p>
                        <p className="text-[10px] text-emerald-300 font-medium pt-1">
                          Digital token and WhatsApp reminder have been dispatched.
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* DOCTOR TESTIMONIALS & CLINICAL ENDORSEMENTS */}
      <section className="max-w-6xl mx-auto px-4 py-16 border-t border-slate-800/80">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-xs text-emerald-300 mb-3">
            <Award className="w-3.5 h-3.5 text-emerald-400" />
            <span>Trusted by Leading Practitioners Across India</span>
          </div>
          <h2 className="font-manrope text-3xl sm:text-4xl font-extrabold text-white">
            What Clinicians Are Saying
          </h2>
          <p className="text-slate-400 mt-2 max-w-2xl mx-auto text-sm">
            Hear from specialist doctors who transformed their patient throughput and eliminated clinical burnout with Lumera.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Testimonial 1 */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 flex flex-col justify-between hover:border-slate-700 transition-all">
            <div className="space-y-3">
              <div className="flex items-center text-amber-400 gap-1 text-xs">
                {"★".repeat(5)}
              </div>
              <p className="text-slate-200 text-xs sm:text-sm leading-relaxed italic">
                “Lumera's ambient scribe captures bilateral ROM, spine posture, and joint tenderness while I physically examine the athlete. Not a single keystroke during consults.”
              </p>
            </div>
            <div className="pt-4 mt-4 border-t border-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-600/30 border border-blue-400/40 text-blue-300 font-bold flex items-center justify-center text-xs">
                SV
              </div>
              <div>
                <strong className="text-white text-xs block">Dr. Siddharth Varma</strong>
                <span className="text-[11px] text-slate-400">Consultant Physiotherapist &amp; Sports Rehab</span>
              </div>
            </div>
          </div>

          {/* Testimonial 2 */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 flex flex-col justify-between hover:border-slate-700 transition-all">
            <div className="space-y-3">
              <div className="flex items-center text-amber-400 gap-1 text-xs">
                {"★".repeat(5)}
              </div>
              <p className="text-slate-200 text-xs sm:text-sm leading-relaxed italic">
                “The automated drug-drug interaction engine and instant WhatsApp prescription PDF delivery have elevated patient adherence and eliminated chemist confusion completely.”
              </p>
            </div>
            <div className="pt-4 mt-4 border-t border-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-purple-600/30 border border-purple-400/40 text-purple-300 font-bold flex items-center justify-center text-xs">
                RM
              </div>
              <div>
                <strong className="text-white text-xs block">Dr. Rajesh Mehta</strong>
                <span className="text-[11px] text-slate-400">Senior Interventional Cardiologist</span>
              </div>
            </div>
          </div>

          {/* Testimonial 3 */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 flex flex-col justify-between hover:border-slate-700 transition-all">
            <div className="space-y-3">
              <div className="flex items-center text-amber-400 gap-1 text-xs">
                {"★".repeat(5)}
              </div>
              <p className="text-slate-200 text-xs sm:text-sm leading-relaxed italic">
                “Parents love receiving their digital queue tokens and immunization schedules right on WhatsApp. It eliminated our morning reception crowd bottlenecks by 85%.”
              </p>
            </div>
            <div className="pt-4 mt-4 border-t border-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-600/30 border border-emerald-400/40 text-emerald-300 font-bold flex items-center justify-center text-xs">
                PS
              </div>
              <div>
                <strong className="text-white text-xs block">Dr. Priya Sharma</strong>
                <span className="text-[11px] text-slate-400">Consultant Pediatrician</span>
              </div>
            </div>
          </div>
        </div>

        {/* Conversion Banner */}
        <div className="mt-14 p-8 rounded-3xl bg-gradient-to-r from-blue-900/60 via-indigo-900/60 to-purple-900/60 border border-blue-500/30 text-center space-y-4 shadow-2xl">
          <h3 className="text-2xl sm:text-3xl font-extrabold text-white font-manrope">
            Ready to Experience the AI Clinical Operating System?
          </h3>
          <p className="text-slate-300 text-xs sm:text-sm max-w-xl mx-auto">
            Get instant sandbox access in 30 seconds. No credit card required. Designed for ABDM M1–M3 &amp; DPDP (sandbox path).
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => go("login", { loginNext: "app", loginMode: "signin" })}
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 font-manrope font-bold text-sm text-white shadow-xl shadow-blue-600/40 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
            >
              <Stethoscope className="w-4 h-4" />
              <span>Try for free</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* CONSOLIDATED FOOTER & COMPLIANCE */}
      <footer className="border-t border-white/10 px-4 py-12 text-center text-xs text-slate-400 bg-slate-950">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Brand & Mission Statement */}
          <div className="flex items-center justify-center gap-2 text-white font-manrope font-bold text-lg">
            <Sparkles className="w-5 h-5 text-blue-400" />
            <span>Lumera Health</span>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl mx-auto">
            Empowering Indian healthcare with multilingual ambient scribing, automated WhatsApp patient self-service, and ABDM-aligned interoperability (sandbox path).
          </p>

          {/* Policy Links */}
          <div className="flex flex-wrap justify-center gap-4 sm:gap-6 text-xs text-slate-300 font-medium pt-2 border-t border-slate-900">
            <button
              type="button"
              onClick={() => go("legal", { policySlug: "terms-of-service" })}
              className="hover:text-blue-400 transition cursor-pointer"
            >
              Terms of Service
            </button>
            <button
              type="button"
              onClick={() => go("legal", { policySlug: "privacy-policy" })}
              className="hover:text-blue-400 transition cursor-pointer"
            >
              Privacy Policy
            </button>
            <button
              type="button"
              onClick={() => go("legal", { policySlug: "data-deletion-instructions" })}
              className="hover:text-blue-400 transition cursor-pointer"
            >
              Meta Data Deletion Callback
            </button>
            <button
              type="button"
              onClick={() => go("legal", { policySlug: "security" })}
              className="hover:text-blue-400 transition cursor-pointer"
            >
              ABDM &amp; DPDP Security Statement
            </button>
            <button
              type="button"
              onClick={() => go("login", { loginNext: "admin" })}
              className="hover:text-purple-400 transition cursor-pointer inline-flex items-center gap-1 text-slate-400 hover:text-slate-200"
            >
              <Shield className="w-3 h-3 text-purple-400" />
              <span>Admin</span>
            </button>
          </div>

          {/* Compliance declaration */}
          <div className="pt-2 text-[11px] text-slate-500 space-y-1">
            <p>
              Lumera Health Systems is building toward Meta Tech Provider. App Review is not submitted.
            </p>
            <p>
              Designed for ABDM M1–M3 &amp; DPDP (sandbox path).
            </p>
            <p className="text-slate-600 pt-2">
              © {new Date().getFullYear()} Lumera Solutions LLP. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

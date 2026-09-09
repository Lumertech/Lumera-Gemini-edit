import React, { useState } from "react";
import {
  Sparkles,
  ShieldCheck,
  Stethoscope,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  Building2,
  FileText,
  Activity,
  Mic,
  MessageSquare,
  Users,
  Award,
  Clock,
  IndianRupee,
  BadgeCheck,
  Zap,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useNav } from "../nav/NavigationContext";
import { PolyclinicSpecialty } from "../types";

const SPECIALTIES: PolyclinicSpecialty[] = [
  "General Medicine",
  "Cardiology",
  "Pediatrics",
  "Dermatology",
  "Orthopedics",
  "Physiotherapy & Rehabilitation",
  "Gynecology",
  "ENT",
  "Neurology",
  "Ophthalmology",
  "Dental Surgery",
  "Psychiatry & Mental Health",
];

export const OnboardingWizard: React.FC = () => {
  const { user, completeOnboarding } = useAuth();
  const { go } = useNav();

  // Step state: 1: Profile & Credentials, 2: 4-Step Interactive Tour, 3: Launch Practice
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);

  // Profile Form States
  const [doctorName, setDoctorName] = useState(
    user?.name ? (user.name.startsWith("Dr.") ? user.name : `Dr. ${user.name}`) : "Dr. Practice Director"
  );
  const [qualification, setQualification] = useState("MBBS, MD (Medicine)");
  const [regNumber, setRegNumber] = useState(
    `MCI-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`
  );
  const [specialty, setSpecialty] = useState<PolyclinicSpecialty>(
    (user?.specialty as PolyclinicSpecialty) || "General Medicine"
  );
  const [practiceType, setPracticeType] = useState<'individual' | 'polyclinic'>(
    (user?.practiceType as 'individual' | 'polyclinic') || 'individual'
  );
  const [consultationFee, setConsultationFee] = useState<number>(600);
  const [opdRoom, setOpdRoom] = useState("OPD Suite 101");
  const [opdTiming, setOpdTiming] = useState("09:00 AM - 01:00 PM, 04:00 PM - 07:00 PM");

  // Interactive Tour Active Slide (1 to 4)
  const [tourIndex, setTourIndex] = useState(0);

  // Queue initial choice
  const [queueMode, setQueueMode] = useState<"clean" | "sample">("clean");

  // Loading & Submission states
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const tourSteps = [
    {
      id: "opd",
      title: "1. Compact OPD Queue & Real-Time Tokens",
      badge: "Zero Latency Reception",
      icon: Users,
      color: "from-blue-500 to-cyan-500",
      description:
        "High-density, scannable patient tokens displaying Token #, Patient Demographics, inline verified ABHA badges, and 1-click status transitions ('Waiting' → 'In Consult' → 'Completed').",
      highlight: "Compact Cards & Patient Profile Drawer",
      previewItems: [
        { token: "#01", name: "Rajiv Saxena", age: "44Y/M", abha: true, status: "In Consult" },
        { token: "#02", name: "Sunita Verma", age: "32Y/F", abha: true, status: "Waiting" },
        { token: "#03", name: "Arjun Mehta", age: "28Y/M", abha: false, status: "Waiting" },
      ],
    },
    {
      id: "vitals",
      title: "2. Vitals Intake & Automated Risk Triage",
      badge: "Clinical Safety Matrix",
      icon: Activity,
      color: "from-rose-500 to-pink-500",
      description:
        "Capture blood pressure, pulse, SpO2, and temperature in seconds with automated color-coded risk triage indicators alerting you to hypertension or respiratory compromise.",
      highlight: "Real-time Triage Alert Badges",
      previewItems: [
        { metric: "Blood Pressure", val: "120/80 mmHg", status: "Optimal", color: "text-emerald-400" },
        { metric: "Pulse Rate", val: "74 bpm", status: "Normal", color: "text-emerald-400" },
        { metric: "Oxygen (SpO2)", val: "99%", status: "Optimal", color: "text-emerald-400" },
      ],
    },
    {
      id: "rx",
      title: "3. Smart Rx Studio & WhatsApp Dispatch",
      badge: "ABDM & Meta Certified",
      icon: MessageSquare,
      color: "from-emerald-500 to-teal-500",
      description:
        "Select medicines with auto-dosage and frequency calculations. Generate signed digital prescriptions and dispatch them instantly to patients' WhatsApp in PDF format.",
      highlight: "Instant PDF Delivery to WhatsApp",
      previewItems: [
        { name: "Tab. Paracetamol 650mg", dose: "1 tab TID x 3 days", inst: "Post Meals" },
        { name: "Tab. Pantoprazole 40mg", dose: "1 tab OD x 5 days", inst: "Empty Stomach" },
      ],
    },
    {
      id: "scribe",
      title: "4. Pulse AI Ambient Scribe",
      badge: "Zero Typing Dictation",
      icon: Mic,
      color: "from-purple-500 to-indigo-500",
      description:
        "Speak naturally in English, Hindi, or mixed dialects during your patient consult. Pulse AI listens ambidently and synthesizes structured clinical SOAP notes with ICD-10 suggestions.",
      highlight: "Bilingual SOAP Synthesis & ICD-10",
      previewItems: [
        { section: "Subjective", note: "Fever and mild cough for 3 days; no breathlessness." },
        { section: "Assessment", note: "Acute Upper Respiratory Tract Viral Infection." },
      ],
    },
  ];

  const handleCompleteSetup = async () => {
    setBusy(true);
    setError("");

    try {
      await completeOnboarding({
        specialty,
        regNumber,
        consultationFee,
        qualification,
        opdRoom,
        opdTiming,
        practiceType,
      });

      // If clean queue was selected, set local preference
      if (queueMode === "clean") {
        try {
          localStorage.setItem("lumera_queue_clean_start", "true");
        } catch {
          /* ignore */
        }
      } else {
        try {
          localStorage.removeItem("lumera_queue_clean_start");
        } catch {
          /* ignore */
        }
      }

      // Navigate to Doctor EHR
      go("app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to finalize practice onboarding");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full w-full bg-slate-950 text-slate-100 flex flex-col items-center justify-start p-4 sm:p-6 overflow-y-auto">
      {/* Top Clinic Identification Banner */}
      <div className="w-full max-w-4xl bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 mb-6 shadow-xl backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-purple-600/30 shrink-0">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-xl font-bold text-white">
                  {user?.clinicName || "Lumera Healthcare Center"}
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  {specialty}
                </span>
                {user?.tenantId && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono text-slate-400 bg-slate-800 border border-slate-700">
                    ID: {user.tenantId}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                New Practice Setup & Clinical Suite Activation Wizard
              </p>
            </div>
          </div>

          {/* ABDM Readiness Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/40 border border-emerald-600/30 text-emerald-400 text-xs font-medium">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>HFR: {user?.hfrId || "IN-HFR-ACTIVE"}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-950/40 border border-cyan-600/30 text-cyan-400 text-xs font-medium">
              <BadgeCheck className="w-3.5 h-3.5" />
              <span>HPR: {user?.hprId || "IN-HPR-ACTIVE"}</span>
            </div>
          </div>
        </div>

        {/* Stepper Tabs */}
        <div className="grid grid-cols-3 gap-2 mt-5 pt-4 border-t border-slate-800/80">
          <button
            type="button"
            onClick={() => setActiveStep(1)}
            className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
              activeStep === 1
                ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                : "bg-slate-800/60 text-slate-400 hover:text-slate-200"
            }`}
          >
            <span className="w-4 h-4 rounded-full bg-white/20 text-[10px] flex items-center justify-center">1</span>
            <span>Doctor Profile</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveStep(2)}
            className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
              activeStep === 2
                ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                : "bg-slate-800/60 text-slate-400 hover:text-slate-200"
            }`}
          >
            <span className="w-4 h-4 rounded-full bg-white/20 text-[10px] flex items-center justify-center">2</span>
            <span>4-Step Tour</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveStep(3)}
            className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
              activeStep === 3
                ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                : "bg-slate-800/60 text-slate-400 hover:text-slate-200"
            }`}
          >
            <span className="w-4 h-4 rounded-full bg-white/20 text-[10px] flex items-center justify-center">3</span>
            <span>Launch Practice</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="w-full max-w-4xl p-3 mb-4 rounded-xl bg-red-950/40 border border-red-800 text-red-300 text-xs flex items-center gap-2">
          <span>⚠️ {error}</span>
        </div>
      )}

      {/* STEP 1: CLINICAL PROFILE & REGISTRATION SETUP */}
      {activeStep === 1 && (
        <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-xl">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <Stethoscope className="w-5 h-5 text-cyan-400" />
                Primary Clinician & OPD Setup
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Configure your official medical credential details for prescription headers and OPD queue assignments.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-950/60 text-cyan-400 border border-cyan-800/60">
              Step 1 of 3
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {/* Doctor Full Name */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Clinician Full Name (with Title)
              </label>
              <div className="relative">
                <Award className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={doctorName}
                  onChange={(e) => setDoctorName(e.target.value)}
                  placeholder="e.g. Dr. Rajiv Saxena"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>

            {/* Medical Council Reg # */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Medical Council Registration Number
              </label>
              <div className="relative">
                <ShieldCheck className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={regNumber}
                  onChange={(e) => setRegNumber(e.target.value)}
                  placeholder="e.g. MCI-2026-89410"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono"
                />
              </div>
            </div>

            {/* Clinical Specialty */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Primary Specialty
              </label>
              <select
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value as PolyclinicSpecialty)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-purple-500"
              >
                {SPECIALTIES.map((spec) => (
                  <option key={spec} value={spec}>
                    {spec}
                  </option>
                ))}
              </select>
            </div>

            {/* Practice Type */}
            <div className="md:col-span-2">
              <label className="block text-slate-300 font-semibold mb-1">
                Practice Type & Staff Onboarding
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPracticeType('individual')}
                  className={`p-3 rounded-xl border text-left transition-all flex flex-col gap-1 cursor-pointer ${
                    practiceType === 'individual'
                      ? 'bg-purple-950/40 border-purple-500 text-white shadow-md'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between font-semibold text-xs text-white">
                    <span>Individual Practice (Single Specialty)</span>
                    {practiceType === 'individual' && <CheckCircle2 className="w-4 h-4 text-purple-400" />}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Locked specialty workflow. Focused single-doctor practice without multi-staff onboarding.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setPracticeType('polyclinic')}
                  className={`p-3 rounded-xl border text-left transition-all flex flex-col gap-1 cursor-pointer ${
                    practiceType === 'polyclinic'
                      ? 'bg-purple-950/40 border-purple-500 text-white shadow-md'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between font-semibold text-xs text-white">
                    <span>Polyclinic / Multi-Speciality Clinic</span>
                    {practiceType === 'polyclinic' && <CheckCircle2 className="w-4 h-4 text-purple-400" />}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Option to onboard different doctors, receptionists, and staff across multiple specialties.
                  </p>
                </button>
              </div>
            </div>

            {/* Qualifications */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Degrees & Qualifications
              </label>
              <input
                type="text"
                value={qualification}
                onChange={(e) => setQualification(e.target.value)}
                placeholder="e.g. MBBS, MD (Medicine), DNB"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>

            {/* Consultation Fee */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Standard Consultation Fee (₹ INR)
              </label>
              <div className="relative">
                <IndianRupee className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="number"
                  min="0"
                  step="50"
                  value={consultationFee}
                  onChange={(e) => setConsultationFee(Number(e.target.value))}
                  placeholder="600"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-semibold"
                />
              </div>
            </div>

            {/* OPD Room */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Assigned OPD Suite / Desk
              </label>
              <div className="relative">
                <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={opdRoom}
                  onChange={(e) => setOpdRoom(e.target.value)}
                  placeholder="OPD Suite 101"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>

            {/* OPD Hours */}
            <div className="md:col-span-2">
              <label className="block text-slate-300 font-semibold mb-1">
                Consultation Timings (Shown on WhatsApp & Patient Slip)
              </label>
              <div className="relative">
                <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={opdTiming}
                  onChange={(e) => setOpdTiming(e.target.value)}
                  placeholder="09:00 AM - 01:00 PM, 04:00 PM - 07:00 PM"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={() => setActiveStep(2)}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-purple-600/30"
            >
              <span>Save & View 4-Step Clinical Tour</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: 4-STEP INTERACTIVE TOUR */}
      {activeStep === 2 && (
        <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-xl">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-400" />
                Explore the 4 Core Clinical Workflows
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Lumera seamlessly links Token Generation, Vitals Intake, WhatsApp Rx Delivery, and AI Ambient Scribe.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-950/60 text-amber-400 border border-amber-800/60">
              Step 2 of 3
            </span>
          </div>

          {/* 4 Feature Selector Chips */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
            {tourSteps.map((step, idx) => {
              const IconComp = step.icon;
              const isSelected = tourIndex === idx;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setTourIndex(idx)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    isSelected
                      ? "bg-slate-800 border-purple-500 shadow-md ring-1 ring-purple-500"
                      : "bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-400"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div
                      className={`w-7 h-7 rounded-lg bg-gradient-to-tr ${step.color} flex items-center justify-center text-white shrink-0`}
                    >
                      <IconComp className="w-4 h-4" />
                    </div>
                    <span className="text-[11px] font-bold text-white truncate">
                      {step.title.split(".")[1] || step.title}
                    </span>
                  </div>
                  <span className="text-[10px] text-purple-400 font-medium block truncate">
                    {step.badge}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Active Step Showcase Card */}
          {(() => {
            const cur = tourSteps[tourIndex];
            const Icon = cur.icon;
            return (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 mb-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-800/80">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-xl bg-gradient-to-tr ${cur.color} flex items-center justify-center text-white shadow-md`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm sm:text-base font-bold text-white">{cur.title}</h3>
                      <span className="text-xs text-purple-400 font-medium">{cur.highlight}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 self-end md:self-auto">
                    <button
                      type="button"
                      disabled={tourIndex === 0}
                      onClick={() => setTourIndex((prev) => Math.max(0, prev - 1))}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-xs text-slate-400 px-2 font-mono">
                      {tourIndex + 1} / 4
                    </span>
                    <button
                      type="button"
                      disabled={tourIndex === tourSteps.length - 1}
                      onClick={() => setTourIndex((prev) => Math.min(tourSteps.length - 1, prev + 1))}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <p className="text-xs sm:text-sm text-slate-300 mb-4 leading-relaxed">
                  {cur.description}
                </p>

                {/* Micro Preview of the feature */}
                <div className="bg-slate-900/90 rounded-lg p-3 border border-slate-800">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    Live UI Emulation
                  </div>

                  {cur.id === "opd" && (
                    <div className="space-y-1.5">
                      {cur.previewItems.map((item: any, i: number) => (
                        <div
                          key={i}
                          className="flex items-center justify-between p-2 rounded bg-slate-950 border border-slate-800 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-cyan-400 bg-cyan-950/60 px-1.5 py-0.5 rounded text-[10px]">
                              {item.token}
                            </span>
                            <span className="font-semibold text-white">{item.name}</span>
                            <span className="text-slate-400 text-[11px]">• {item.age}</span>
                            {item.abha && (
                              <span
                                title="Verified ABHA"
                                className="inline-flex items-center text-[10px] text-emerald-400 bg-emerald-950/60 px-1 rounded"
                              >
                                ✓ ABHA
                              </span>
                            )}
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              item.status === "In Consult"
                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                                : "bg-blue-500/20 text-blue-300 border border-blue-500/40"
                            }`}
                          >
                            {item.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {cur.id === "vitals" && (
                    <div className="grid grid-cols-3 gap-2">
                      {cur.previewItems.map((item: any, i: number) => (
                        <div key={i} className="p-2.5 rounded bg-slate-950 border border-slate-800 text-center">
                          <span className="text-[10px] text-slate-400 block">{item.metric}</span>
                          <span className={`text-sm font-bold block my-0.5 ${item.color}`}>
                            {item.val}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950/80 text-emerald-400">
                            {item.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {cur.id === "rx" && (
                    <div className="space-y-1.5">
                      {cur.previewItems.map((item: any, i: number) => (
                        <div
                          key={i}
                          className="flex items-center justify-between p-2 rounded bg-slate-950 border border-slate-800 text-xs"
                        >
                          <div>
                            <span className="font-semibold text-white block">{item.name}</span>
                            <span className="text-slate-400 text-[11px]">{item.dose}</span>
                          </div>
                          <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-300">
                            {item.inst}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {cur.id === "scribe" && (
                    <div className="space-y-1.5">
                      {cur.previewItems.map((item: any, i: number) => (
                        <div key={i} className="p-2 rounded bg-slate-950 border border-slate-800 text-xs">
                          <span className="font-bold text-purple-300 uppercase tracking-wider text-[10px] block">
                            {item.section}
                          </span>
                          <span className="text-slate-300 text-[11px]">{item.note}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Nav buttons */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setActiveStep(1)}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Profile
            </button>

            <button
              type="button"
              onClick={() => setActiveStep(3)}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-purple-600/30"
            >
              <span>Continue to Practice Launch</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: LAUNCH CONFIGURATION & FINAL ACTIVATION */}
      {activeStep === 3 && (
        <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-xl">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                Launch Practice Suite
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Select your initial queue state and activate your enterprise trial clinical environment.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
              Step 3 of 3
            </span>
          </div>

          {/* Queue Selection Choice */}
          <div className="mb-6">
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5">
              Initial OPD Queue State
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div
                onClick={() => setQueueMode("clean")}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  queueMode === "clean"
                    ? "bg-purple-950/30 border-purple-500 shadow-md ring-1 ring-purple-500"
                    : "bg-slate-950 border-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-white text-sm">Clean Queue (0 Patients)</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Recommended for Live Clinics
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Start with a completely fresh, empty OPD queue ready for your real reception desk to register patients and assign tokens.
                </p>
              </div>

              <div
                onClick={() => setQueueMode("sample")}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  queueMode === "sample"
                    ? "bg-purple-950/30 border-purple-500 shadow-md ring-1 ring-purple-500"
                    : "bg-slate-950 border-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-white text-sm">Sample Patient Tokens (3)</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    Testing & Walkthrough
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Pre-load 3 demonstration patient cards with simulated vitals and medical histories to test prescriptions and AI scribe immediately.
                </p>
              </div>
            </div>
          </div>

          {/* Practice Activation Checklist */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 mb-6">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
              Included Enterprise Trial Quotas
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span className="text-slate-200">500 Pulse AI Ambient Scribe Minutes</span>
              </div>
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span className="text-slate-200">100 Monthly DHIS Transaction Claims</span>
              </div>
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span className="text-slate-200">Official WhatsApp Business Cloud API Enabled</span>
              </div>
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span className="text-slate-200">ABDM M1, M2, M3 Compliant EHR Architecture</span>
              </div>
            </div>
          </div>

          {/* Launch Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => setActiveStep(2)}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Tour
            </button>

            <button
              type="button"
              onClick={handleCompleteSetup}
              disabled={busy}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-xl shadow-purple-600/30 transition-all disabled:opacity-50"
            >
              {busy ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Activating Practice Suite...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  <span>Complete Setup & Launch Practice Suite</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useRef, useState } from "react";
import {
  Sparkles,
  ShieldCheck,
  Stethoscope,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  Building2,
  Clock,
  IndianRupee,
  Award,
  PenLine,
  Upload,
  Timer,
  LayoutTemplate,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useNav } from "../nav/NavigationContext";
import { PolyclinicSpecialty } from "../types";
import { displayDoctorName, markWelcomeDashboard } from "../lib/sessionWorkspace";
import { letterheadFromSessionHints, patchTenantLetterhead } from "../lib/letterhead";

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

const RX_TEMPLATES = [
  {
    id: "classic" as const,
    title: "Classic Letterhead",
    description: "Full clinic header, doctor credentials, signature block, and ABDM footer.",
  },
  {
    id: "compact" as const,
    title: "Compact OPD Slip",
    description: "Dense one-page layout for high-volume OPD with short advice and medicines.",
  },
  {
    id: "detailed" as const,
    title: "Detailed Clinical Rx",
    description: "SOAP-style sections, specialty modules, and extended lifestyle advice.",
  },
];

export const OnboardingWizard: React.FC = () => {
  const { user, completeOnboarding } = useAuth();
  const { go } = useNav();
  const signatureInputRef = useRef<HTMLInputElement | null>(null);

  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);

  const [doctorName, setDoctorName] = useState(displayDoctorName(user?.name));
  const [clinicName, setClinicName] = useState(user?.clinicName || "");
  const [qualification, setQualification] = useState("");
  const [regNumber, setRegNumber] = useState("");
  const [specialty, setSpecialty] = useState<PolyclinicSpecialty>(
    (user?.specialty as PolyclinicSpecialty) || "General Medicine"
  );
  const [signatureUrl, setSignatureUrl] = useState("");

  const [practiceType, setPracticeType] = useState<"individual" | "polyclinic">(
    user?.practiceType === "polyclinic" ? "polyclinic" : "individual"
  );

  const [consultationFee, setConsultationFee] = useState<number>(600);
  const [slotDurationMinutes, setSlotDurationMinutes] = useState<number>(15);
  const [opdTiming, setOpdTiming] = useState("09:00 AM - 01:00 PM, 04:00 PM - 07:00 PM");
  const [rxTemplate, setRxTemplate] = useState<"classic" | "compact" | "detailed">("classic");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const validateStep1 = () => {
    if (!doctorName.trim()) return "Please enter the clinician full name.";
    if (!clinicName.trim()) return "Please enter the clinic / practice name.";
    if (!regNumber.trim()) return "Medical Council registration number is required.";
    if (!qualification.trim()) return "Please enter qualification / degrees.";
    return "";
  };

  const goNextFromStep1 = () => {
    const msg = validateStep1();
    if (msg) {
      setError(msg);
      return;
    }
    setError("");
    setActiveStep(2);
  };

  const handleSignatureFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setSignatureUrl(typeof reader.result === "string" ? reader.result : "");
    };
    reader.readAsDataURL(file);
  };

  const handleCompleteSetup = async () => {
    const step1Error = validateStep1();
    if (step1Error) {
      setError(step1Error);
      setActiveStep(1);
      return;
    }
    if (!consultationFee || consultationFee < 0) {
      setError("Enter a valid default consultation fee.");
      setActiveStep(3);
      return;
    }

    setBusy(true);
    setError("");

    try {
      await completeOnboarding({
        doctorName: displayDoctorName(doctorName),
        clinicName: clinicName.trim(),
        specialty,
        regNumber: regNumber.trim(),
        consultationFee,
        qualification: qualification.trim(),
        opdRoom: "",
        opdTiming,
        practiceType,
        signatureUrl,
        slotDurationMinutes,
        rxTemplate,
      });

      try {
        await patchTenantLetterhead(
          letterheadFromSessionHints(clinicName.trim(), {
            phone: user?.phone || "",
            email: user?.email || "",
            signatureUrl,
          })
        );
      } catch {
        // Persistence is owned by Platform GET/PATCH /api/tenant/letterhead.
      }

      try {
        localStorage.setItem("lumera_queue_clean_start", "true");
      } catch {
        /* ignore */
      }

      markWelcomeDashboard();
      go("app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to finalize practice onboarding");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full w-full bg-slate-950 text-slate-100 flex flex-col items-center justify-start p-4 sm:p-6 overflow-y-auto">
      <div className="w-full max-w-4xl bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 mb-6 shadow-xl backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-purple-600/30 shrink-0">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-xl font-bold text-white">
                  {clinicName || user?.clinicName || "New Lumera Practice"}
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  {specialty}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Complete practice setup before entering the clinical workspace
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/40 border border-emerald-600/30 text-emerald-400 text-xs font-medium">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>HFR: {user?.hfrId || "Pending"}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-5 pt-4 border-t border-slate-800/80">
          {[
            { id: 1 as const, label: "Doctor & Practice" },
            { id: 2 as const, label: "Practice Type" },
            { id: 3 as const, label: "Consult & Billing" },
          ].map((step) => (
            <button
              key={step.id}
              type="button"
              onClick={() => setActiveStep(step.id)}
              className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                activeStep === step.id
                  ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                  : "bg-slate-800/60 text-slate-400 hover:text-slate-200"
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-white/20 text-[10px] flex items-center justify-center">{step.id}</span>
              <span>{step.label}</span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="w-full max-w-4xl p-3 mb-4 rounded-xl bg-red-950/40 border border-red-800 text-red-300 text-xs">
          {error}
        </div>
      )}

      {activeStep === 1 && (
        <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-xl">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <Stethoscope className="w-5 h-5 text-cyan-400" />
                Doctor & Practice Details
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                These credentials print on prescriptions, ABHA letters, and WhatsApp Rx headers.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-950/60 text-cyan-400 border border-cyan-800/60">
              Step 1 of 3
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Full Name</label>
              <div className="relative">
                <Award className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={doctorName}
                  onChange={(e) => setDoctorName(e.target.value)}
                  placeholder="Dr. Firstname Lastname"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Medical Council Registration Number</label>
              <div className="relative">
                <ShieldCheck className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={regNumber}
                  onChange={(e) => setRegNumber(e.target.value)}
                  placeholder="e.g. MCI / State Medical Council number"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Qualification</label>
              <input
                type="text"
                value={qualification}
                onChange={(e) => setQualification(e.target.value)}
                placeholder="e.g. MBBS, MD (Medicine)"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Primary Speciality</label>
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
            <div className="md:col-span-2">
              <label className="block text-slate-300 font-semibold mb-1">Clinic Name</label>
              <div className="relative">
                <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={clinicName}
                  onChange={(e) => setClinicName(e.target.value)}
                  placeholder="Registered clinic / hospital name"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-slate-300 font-semibold mb-1">Digital Signature Upload / Setup</label>
              <input
                ref={signatureInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => handleSignatureFile(e.target.files?.[0])}
              />
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => signatureInputRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-3 rounded-xl border border-dashed border-slate-600 bg-slate-950 text-slate-300 hover:border-purple-500"
                >
                  <Upload className="w-4 h-4" />
                  {signatureUrl ? "Replace signature image" : "Upload signature image"}
                </button>
                {signatureUrl && (
                  <div className="sm:w-48 h-16 rounded-xl bg-white flex items-center justify-center overflow-hidden border border-slate-700">
                    <img src={signatureUrl} alt="Digital signature preview" className="max-h-14 object-contain" />
                  </div>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1">
                <PenLine className="w-3 h-3" /> PNG or JPEG on a transparent / white background works best on Rx prints.
              </p>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={goNextFromStep1}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-purple-600/30"
            >
              <span>Continue to Practice Type</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {activeStep === 2 && (
        <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-xl">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white">Practice Type Selection</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                This controls whether the Polyclinic Roster and multi-staff tools appear in the sidebar.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-950/60 text-amber-400 border border-amber-800/60">
              Step 2 of 3
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setPracticeType("individual")}
              className={`p-4 rounded-xl border text-left transition-all ${
                practiceType === "individual"
                  ? "bg-purple-950/40 border-purple-500 text-white shadow-md"
                  : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center justify-between font-semibold text-sm text-white mb-1">
                <span>Individual Practice / Single Specialty</span>
                {practiceType === "individual" && <CheckCircle2 className="w-4 h-4 text-purple-400" />}
              </div>
              <p className="text-xs text-slate-400">
                One locked specialty workflow. Polyclinic roster stays hidden.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setPracticeType("polyclinic")}
              className={`p-4 rounded-xl border text-left transition-all ${
                practiceType === "polyclinic"
                  ? "bg-purple-950/40 border-purple-500 text-white shadow-md"
                  : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center justify-between font-semibold text-sm text-white mb-1">
                <span>Polyclinic / Multi-Specialty Clinic</span>
                {practiceType === "polyclinic" && <CheckCircle2 className="w-4 h-4 text-purple-400" />}
              </div>
              <p className="text-xs text-slate-400">
                Enable department roster, additional doctors, and multi-specialty OPD.
              </p>
            </button>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setActiveStep(1)}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
            <button
              type="button"
              onClick={() => {
                setError("");
                setActiveStep(3);
              }}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-semibold text-xs flex items-center gap-2"
            >
              Continue to Billing Setup <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {activeStep === 3 && (
        <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-xl">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white">Consultation & Billing Setup</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Defaults used for appointments, invoices, and the prescription layout.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
              Step 3 of 3
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs mb-5">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Default consultation fee (₹)</label>
              <div className="relative">
                <IndianRupee className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="number"
                  min="0"
                  step="50"
                  value={consultationFee}
                  onChange={(e) => setConsultationFee(Number(e.target.value))}
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-purple-500 font-semibold"
                />
              </div>
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Average slot duration</label>
              <div className="relative">
                <Timer className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <select
                  value={slotDurationMinutes}
                  onChange={(e) => setSlotDurationMinutes(Number(e.target.value))}
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-purple-500"
                >
                  {[10, 15, 20, 30, 45, 60].map((mins) => (
                    <option key={mins} value={mins}>
                      {mins} minutes
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-slate-300 font-semibold mb-1">Operating OPD hours</label>
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

          <label className="block text-slate-300 font-semibold mb-2 text-xs">Prescription template layout</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            {RX_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => setRxTemplate(tpl.id)}
                className={`p-3 rounded-xl border text-left ${
                  rxTemplate === tpl.id
                    ? "bg-purple-950/40 border-purple-500"
                    : "bg-slate-950 border-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between text-white text-xs font-semibold mb-1">
                  <span className="flex items-center gap-1.5">
                    <LayoutTemplate className="w-3.5 h-3.5 text-purple-300" />
                    {tpl.title}
                  </span>
                  {rxTemplate === tpl.id && <CheckCircle2 className="w-4 h-4 text-purple-400" />}
                </div>
                <p className="text-[11px] text-slate-400">{tpl.description}</p>
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setActiveStep(2)}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
            <button
              type="button"
              onClick={handleCompleteSetup}
              disabled={busy}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-600 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-xl shadow-purple-600/30 disabled:opacity-50"
            >
              {busy ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Saving practice profile...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  Finish setup & open dashboard
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

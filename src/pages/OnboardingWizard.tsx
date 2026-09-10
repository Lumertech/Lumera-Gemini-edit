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
  Users,
  UserPlus,
  Trash2,
  MapPin,
  Ticket,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useNav } from "../nav/NavigationContext";
import { PolyclinicSpecialty } from "../types";
import { displayDoctorName, markWelcomeDashboard } from "../lib/sessionWorkspace";
import { letterheadFromSessionHints, patchTenantLetterhead } from "../lib/letterhead";
import {
  DEFAULT_FRONT_DESK,
  DEFAULT_PRACTICE_TYPE,
  onboardingTrackFromUser,
  postOnboardingHomeView,
  type FrontDeskRules,
  type PracticeType,
  type RosterDoctorDraft,
} from "../lib/practiceOnboarding";

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

function emptyRosterDraft(): RosterDoctorDraft {
  return { name: "", specialty: "General Medicine", qualification: "", consultationFee: 600 };
}

export const OnboardingWizard: React.FC = () => {
  const { user, completeOnboarding } = useAuth();
  const { go } = useNav();
  const signatureInputRef = useRef<HTMLInputElement | null>(null);

  const [track, setTrack] = useState<PracticeType>(onboardingTrackFromUser(user?.practiceType) || DEFAULT_PRACTICE_TYPE);
  const [individualStep, setIndividualStep] = useState<1 | 2 | 3>(1);
  const [polyclinicStep, setPolyclinicStep] = useState<1 | 2 | 3 | 4>(1);

  const [doctorName, setDoctorName] = useState(displayDoctorName(user?.name));
  const [clinicName, setClinicName] = useState(user?.clinicName || "");
  const [qualification, setQualification] = useState("");
  const [regNumber, setRegNumber] = useState("");
  const [specialty, setSpecialty] = useState<PolyclinicSpecialty>(
    (user?.specialty as PolyclinicSpecialty) || "General Medicine"
  );
  const [signatureUrl, setSignatureUrl] = useState("");
  const [facilityAddress, setFacilityAddress] = useState("");
  const [facilityCity, setFacilityCity] = useState("");

  const [consultationFee, setConsultationFee] = useState<number>(600);
  const [slotDurationMinutes, setSlotDurationMinutes] = useState<number>(15);
  const [opdTiming, setOpdTiming] = useState("09:00 AM - 01:00 PM, 04:00 PM - 07:00 PM");
  const [rxTemplate, setRxTemplate] = useState<"classic" | "compact" | "detailed">("classic");

  const [departments, setDepartments] = useState<PolyclinicSpecialty[]>(
    user?.specialty ? [user.specialty as PolyclinicSpecialty] : ["General Medicine"]
  );
  const [roster, setRoster] = useState<RosterDoctorDraft[]>([emptyRosterDraft()]);
  const [frontDesk, setFrontDesk] = useState<FrontDeskRules>(DEFAULT_FRONT_DESK);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const switchTrack = (next: PracticeType) => {
    setTrack(next);
    setError("");
    setIndividualStep(1);
    setPolyclinicStep(1);
    if (next === "polyclinic" && departments.length === 0) {
      setDepartments([specialty]);
    }
  };

  const validateClinician = () => {
    if (!doctorName.trim()) return "Please enter the clinician full name.";
    if (!regNumber.trim()) return "Medical Council registration number is required.";
    if (!qualification.trim()) return "Please enter qualification / degrees.";
    return "";
  };

  const validateClinic = () => {
    if (!clinicName.trim()) {
      return track === "polyclinic" ? "Please enter the facility / clinic name." : "Please enter your clinic name.";
    }
    return "";
  };

  const validateConsult = () => {
    if (!consultationFee || consultationFee < 0) return "Enter a valid default consultation fee.";
    if (!opdTiming.trim()) return "Please enter operating hours.";
    return "";
  };

  const handleSignatureFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setSignatureUrl(typeof reader.result === "string" ? reader.result : "");
    };
    reader.readAsDataURL(file);
  };

  const toggleDepartment = (spec: PolyclinicSpecialty) => {
    setDepartments((prev) => {
      if (prev.includes(spec)) {
        return prev.length === 1 ? prev : prev.filter((item) => item !== spec);
      }
      return [...prev, spec];
    });
    if (!departments.includes(spec) && departments.length === 0) {
      setSpecialty(spec);
    }
  };

  const handleCompleteSetup = async () => {
    if (track === "individual") {
      const clinicianError = validateClinician();
      if (clinicianError) {
        setError(clinicianError);
        setIndividualStep(1);
        return;
      }
    } else if (!doctorName.trim()) {
      setError("Please enter the practice director / admin name.");
      setPolyclinicStep(1);
      return;
    }
    const clinicError = validateClinic();
    if (clinicError) {
      setError(clinicError);
      if (track === "individual") setIndividualStep(2);
      else setPolyclinicStep(1);
      return;
    }
    if (track === "polyclinic" && departments.length === 0) {
      setError("Select at least one clinical department.");
      setPolyclinicStep(2);
      return;
    }
    const consultError = validateConsult();
    if (consultError) {
      setError(consultError);
      if (track === "individual") setIndividualStep(3);
      else setPolyclinicStep(4);
      return;
    }

    setBusy(true);
    setError("");

    const primarySpecialty = track === "polyclinic" ? departments[0] || specialty : specialty;
    const rosterDoctors = roster
      .map((row) => ({
        ...row,
        name: row.name.trim(),
        specialty: row.specialty.trim(),
      }))
      .filter((row) => row.name && row.specialty);

    try {
      const result = await completeOnboarding({
        doctorName: displayDoctorName(doctorName) || user?.name,
        clinicName: clinicName.trim(),
        specialty: primarySpecialty,
        regNumber: regNumber.trim(),
        consultationFee,
        qualification: qualification.trim(),
        opdRoom: "",
        opdTiming,
        practiceType: track,
        signatureUrl,
        slotDurationMinutes,
        rxTemplate,
        facilityAddress: facilityAddress.trim(),
        facilityCity: facilityCity.trim(),
        departments: track === "polyclinic" ? departments : [primarySpecialty],
        rosterDoctors: track === "polyclinic" ? rosterDoctors : [],
        frontDesk,
      });

      try {
        await patchTenantLetterhead(
          letterheadFromSessionHints(
            clinicName.trim(),
            {
              phone: user?.phone || "",
              email: user?.email || "",
              signatureUrl,
            },
            { address: facilityAddress.trim(), city: facilityCity.trim() }
          )
        );
      } catch {
        // Persistence is owned by Platform GET/PATCH /api/tenant/letterhead.
      }

      try {
        localStorage.setItem("lumera_queue_clean_start", "true");
      } catch {
        /* ignore */
      }

      const home = result.homeView || postOnboardingHomeView(track);
      if (home === "welcome") {
        markWelcomeDashboard();
      }
      go("app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to finalize practice onboarding");
      setBusy(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500";
  const primaryBtn =
    "px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-purple-600/30";
  const backBtn =
    "px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5";

  const individualSteps = [
    { id: 1 as const, label: "Clinician" },
    { id: 2 as const, label: "Your clinic" },
    { id: 3 as const, label: "Consult & billing" },
  ];
  const polyclinicSteps = [
    { id: 1 as const, label: "Facility" },
    { id: 2 as const, label: "Departments" },
    { id: 3 as const, label: "Doctor roster" },
    { id: 4 as const, label: "Front desk" },
  ];
  const steps = track === "individual" ? individualSteps : polyclinicSteps;
  const activeStep = track === "individual" ? individualStep : polyclinicStep;

  return (
    <div
      className="min-h-full w-full bg-slate-950 text-slate-100 flex flex-col items-center justify-start p-4 sm:p-6 overflow-y-auto"
      data-testid="onboarding-wizard"
      data-onboarding-track={track}
    >
      <div className="w-full max-w-4xl bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 mb-6 shadow-xl backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-lg shrink-0 ${
                track === "individual"
                  ? "bg-gradient-to-tr from-emerald-600 to-teal-600 shadow-emerald-600/30"
                  : "bg-gradient-to-tr from-indigo-600 to-purple-600 shadow-indigo-600/30"
              }`}
            >
              {track === "individual" ? <Stethoscope className="w-6 h-6" /> : <Building2 className="w-6 h-6" />}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-xl font-bold text-white">
                  {clinicName || user?.clinicName || (track === "individual" ? "Your practice" : "New facility")}
                </h1>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                    track === "individual"
                      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                      : "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                  }`}
                >
                  {track === "individual" ? "Individual practice" : "Multi-specialty / polyclinic"}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {track === "individual"
                  ? "Set up your clinician profile, clinic, and consult defaults — then open your daily OPD dashboard."
                  : "Configure the facility, departments, roster, and shared front desk before opening operations."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/40 border border-emerald-600/30 text-emerald-400 text-xs font-medium">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>HFR: {user?.hfrId || "Pending"} · sandbox</span>
            </div>
          </div>
        </div>

        <div className={`grid gap-2 mt-5 pt-4 border-t border-slate-800/80 ${track === "individual" ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4"}`}>
          {steps.map((step) => (
            <button
              key={step.id}
              type="button"
              onClick={() => {
                if (track === "individual") setIndividualStep(step.id as 1 | 2 | 3);
                else setPolyclinicStep(step.id as 1 | 2 | 3 | 4);
              }}
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

        <div className="mt-3 text-[11px] text-slate-500">
          {track === "individual" ? (
            <button type="button" className="text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline" onClick={() => switchTrack("polyclinic")}>
              Setting up a multi-specialty / polyclinic instead?
            </button>
          ) : (
            <button type="button" className="text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline" onClick={() => switchTrack("individual")}>
              This is a solo / individual practice instead?
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="w-full max-w-4xl p-3 mb-4 rounded-xl bg-red-950/40 border border-red-800 text-red-300 text-xs">
          {error}
        </div>
      )}

      {track === "individual" && individualStep === 1 && (
        <section className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-xl">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <Stethoscope className="w-5 h-5 text-emerald-400" />
                Your clinician profile
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Name, registration, specialty, and signature print on prescriptions and ABHA letters.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
              Step 1 of 3
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Full name</label>
              <div className="relative">
                <Award className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input className={`${inputClass} pl-9`} value={doctorName} onChange={(e) => setDoctorName(e.target.value)} placeholder="Dr. Firstname Lastname" />
              </div>
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Medical Council registration</label>
              <div className="relative">
                <ShieldCheck className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input className={`${inputClass} pl-9 font-mono`} value={regNumber} onChange={(e) => setRegNumber(e.target.value)} placeholder="e.g. MCI / State Medical Council number" />
              </div>
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Qualification</label>
              <input className={inputClass} value={qualification} onChange={(e) => setQualification(e.target.value)} placeholder="e.g. MBBS, MD (Medicine)" />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Your specialty</label>
              <select className={inputClass} value={specialty} onChange={(e) => setSpecialty(e.target.value as PolyclinicSpecialty)}>
                {SPECIALTIES.map((spec) => (
                  <option key={spec} value={spec}>{spec}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-slate-300 font-semibold mb-1">Digital signature</label>
              <input ref={signatureInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => handleSignatureFile(e.target.files?.[0])} />
              <div className="flex flex-col sm:flex-row gap-3">
                <button type="button" onClick={() => signatureInputRef.current?.click()} className="flex-1 flex items-center justify-center gap-2 px-3 py-3 rounded-xl border border-dashed border-slate-600 bg-slate-950 text-slate-300 hover:border-purple-500">
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
                <PenLine className="w-3 h-3" /> Optional now — PNG or JPEG on a white background prints cleanest on Rx.
              </p>
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              className={primaryBtn}
              onClick={() => {
                const msg = validateClinician();
                if (msg) { setError(msg); return; }
                setError("");
                setIndividualStep(2);
              }}
            >
              Continue to clinic <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      {track === "individual" && individualStep === 2 && (
        <section className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-xl">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-cyan-400" />
                Single clinic basics
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                One clinic for this account. No department roster or front-desk admin chrome.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-950/60 text-cyan-400 border border-cyan-800/60">
              Step 2 of 3
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="md:col-span-2">
              <label className="block text-slate-300 font-semibold mb-1">Clinic name</label>
              <div className="relative">
                <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input className={`${inputClass} pl-9`} value={clinicName} onChange={(e) => setClinicName(e.target.value)} placeholder="Registered clinic name" />
              </div>
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">City</label>
              <div className="relative">
                <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input className={`${inputClass} pl-9`} value={facilityCity} onChange={(e) => setFacilityCity(e.target.value)} placeholder="e.g. Bengaluru" />
              </div>
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Clinic address</label>
              <input className={inputClass} value={facilityAddress} onChange={(e) => setFacilityAddress(e.target.value)} placeholder="Optional street / landmark" />
            </div>
          </div>
          <div className="mt-6 flex items-center justify-between">
            <button type="button" className={backBtn} onClick={() => setIndividualStep(1)}>
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
            <button
              type="button"
              className={primaryBtn}
              onClick={() => {
                const msg = validateClinic();
                if (msg) { setError(msg); return; }
                setError("");
                setIndividualStep(3);
              }}
            >
              Continue to consult defaults <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      {track === "individual" && individualStep === 3 && (
        <section className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-xl">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white">Consultation & billing defaults</h2>
              <p className="text-xs text-slate-400 mt-0.5">Fees, slot length, and hours for your daily OPD / queue / Rx.</p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
              Step 3 of 3
            </span>
          </div>
          <ConsultFields
            consultationFee={consultationFee}
            setConsultationFee={setConsultationFee}
            slotDurationMinutes={slotDurationMinutes}
            setSlotDurationMinutes={setSlotDurationMinutes}
            opdTiming={opdTiming}
            setOpdTiming={setOpdTiming}
            rxTemplate={rxTemplate}
            setRxTemplate={setRxTemplate}
            inputClass={inputClass}
          />
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <button type="button" className={`${backBtn} w-full sm:w-auto justify-center`} onClick={() => setIndividualStep(2)}>
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
            <button type="button" onClick={handleCompleteSetup} disabled={busy} className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-xl shadow-emerald-600/20 disabled:opacity-50">
              {busy ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /> Saving your practice...</>
              ) : (
                <><Sparkles className="w-4 h-4 text-amber-300" /> Open my OPD dashboard <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          </div>
        </section>
      )}

      {track === "polyclinic" && polyclinicStep === 1 && (
        <section className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-xl">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-300" />
                Facility & admin
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                This account is the clinic admin home. Clinician roster is added in a later step — not bolted onto a solo profile.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-950/60 text-indigo-300 border border-indigo-800/60">
              Step 1 of 4
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="md:col-span-2">
              <label className="block text-slate-300 font-semibold mb-1">Facility / polyclinic name</label>
              <input className={inputClass} value={clinicName} onChange={(e) => setClinicName(e.target.value)} placeholder="Registered facility name" />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Director / admin name</label>
              <input className={inputClass} value={doctorName} onChange={(e) => setDoctorName(e.target.value)} placeholder="Practice director" />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Director registration (if clinician)</label>
              <input className={`${inputClass} font-mono`} value={regNumber} onChange={(e) => setRegNumber(e.target.value)} placeholder="Optional if admin-only" />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Qualification</label>
              <input className={inputClass} value={qualification} onChange={(e) => setQualification(e.target.value)} placeholder="e.g. MBBS, MD — or leave blank for admin" />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">City</label>
              <input className={inputClass} value={facilityCity} onChange={(e) => setFacilityCity(e.target.value)} placeholder="e.g. Hyderabad" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-slate-300 font-semibold mb-1">Facility address</label>
              <input className={inputClass} value={facilityAddress} onChange={(e) => setFacilityAddress(e.target.value)} placeholder="Street, area, pin" />
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              className={primaryBtn}
              onClick={() => {
                const msg = validateClinic();
                if (msg) { setError(msg); return; }
                setError("");
                setPolyclinicStep(2);
              }}
            >
              Continue to departments <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      {track === "polyclinic" && polyclinicStep === 2 && (
        <section className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-xl">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white">Departments & specialties</h2>
              <p className="text-xs text-slate-400 mt-0.5">Choose the clinical departments this facility will run. Roster doctors attach to these later.</p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-950/60 text-indigo-300 border border-indigo-800/60">
              Step 2 of 4
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {SPECIALTIES.map((spec) => {
              const selected = departments.includes(spec);
              return (
                <button
                  key={spec}
                  type="button"
                  onClick={() => toggleDepartment(spec)}
                  className={`p-3 rounded-xl border text-left text-xs font-semibold transition-all ${
                    selected ? "bg-indigo-950/50 border-indigo-400 text-white" : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-600"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    {spec}
                    {selected && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-300 shrink-0" />}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-6 flex items-center justify-between">
            <button type="button" className={backBtn} onClick={() => setPolyclinicStep(1)}>
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
            <button
              type="button"
              className={primaryBtn}
              onClick={() => {
                if (!departments.length) {
                  setError("Select at least one clinical department.");
                  return;
                }
                setSpecialty(departments[0]);
                setError("");
                setPolyclinicStep(3);
              }}
            >
              Continue to roster <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      {track === "polyclinic" && polyclinicStep === 3 && (
        <section className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-xl">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-300" />
                Doctor roster
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Add consulting doctors now, or finish with an empty extra roster — you can invite from Team after opening the clinic.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-950/60 text-indigo-300 border border-indigo-800/60">
              Step 3 of 4
            </span>
          </div>
          <div className="space-y-3">
            {roster.map((row, index) => (
              <div key={index} className="grid grid-cols-1 sm:grid-cols-12 gap-2 p-3 rounded-xl bg-slate-950 border border-slate-800">
                <input
                  className={`${inputClass} sm:col-span-4 text-xs`}
                  value={row.name}
                  onChange={(e) => setRoster((prev) => prev.map((item, i) => (i === index ? { ...item, name: e.target.value } : item)))}
                  placeholder="Dr. Name"
                />
                <select
                  className={`${inputClass} sm:col-span-3 text-xs`}
                  value={row.specialty}
                  onChange={(e) => setRoster((prev) => prev.map((item, i) => (i === index ? { ...item, specialty: e.target.value } : item)))}
                >
                  {(departments.length ? departments : SPECIALTIES).map((spec) => (
                    <option key={spec} value={spec}>{spec}</option>
                  ))}
                </select>
                <input
                  className={`${inputClass} sm:col-span-3 text-xs`}
                  value={row.qualification || ""}
                  onChange={(e) => setRoster((prev) => prev.map((item, i) => (i === index ? { ...item, qualification: e.target.value } : item)))}
                  placeholder="Qualification"
                />
                <div className="sm:col-span-2 flex gap-2">
                  <input
                    type="number"
                    min="0"
                    className={`${inputClass} text-xs`}
                    value={row.consultationFee ?? 600}
                    onChange={(e) => setRoster((prev) => prev.map((item, i) => (i === index ? { ...item, consultationFee: Number(e.target.value) } : item)))}
                    placeholder="Fee"
                  />
                  {roster.length > 1 && (
                    <button type="button" className="px-2 rounded-lg bg-slate-800 text-slate-400 hover:text-rose-300" onClick={() => setRoster((prev) => prev.filter((_, i) => i !== index))} aria-label="Remove doctor">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-300 hover:text-indigo-200"
            onClick={() => setRoster((prev) => [...prev, emptyRosterDraft()])}
          >
            <UserPlus className="w-3.5 h-3.5" /> Add another doctor
          </button>
          <div className="mt-6 flex items-center justify-between">
            <button type="button" className={backBtn} onClick={() => setPolyclinicStep(2)}>
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
            <button type="button" className={primaryBtn} onClick={() => { setError(""); setPolyclinicStep(4); }}>
              Continue to front desk <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      {track === "polyclinic" && polyclinicStep === 4 && (
        <section className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-xl">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white">Shared queue & front-desk rules</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                These apply across departments. Reception still offers practice-simple intake and ABHA (sandbox) on the same patient record.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-950/60 text-indigo-300 border border-indigo-800/60">
              Step 4 of 4
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
            <button
              type="button"
              onClick={() => setFrontDesk((prev) => ({ ...prev, sharedQueue: !prev.sharedQueue }))}
              className={`p-3 rounded-xl border text-left text-xs ${frontDesk.sharedQueue ? "bg-indigo-950/40 border-indigo-400" : "bg-slate-950 border-slate-800"}`}
            >
              <div className="font-semibold text-white flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Shared front-desk queue</div>
              <p className="text-slate-400 mt-1">One reception queue across specialties. Turn off only if each department will run its own desk later.</p>
            </button>
            <button
              type="button"
              onClick={() => setFrontDesk((prev) => ({ ...prev, walkInEnabled: !prev.walkInEnabled }))}
              className={`p-3 rounded-xl border text-left text-xs ${frontDesk.walkInEnabled ? "bg-indigo-950/40 border-indigo-400" : "bg-slate-950 border-slate-800"}`}
            >
              <div className="font-semibold text-white flex items-center gap-1.5"><Ticket className="w-3.5 h-3.5" /> Walk-in tokens</div>
              <p className="text-slate-400 mt-1">Reception can issue Waiting OPD tokens without a prior appointment.</p>
            </button>
            <div className="text-xs">
              <label className="block text-slate-300 font-semibold mb-1">Token prefix</label>
              <input className={inputClass} value={frontDesk.tokenPrefix} onChange={(e) => setFrontDesk((prev) => ({ ...prev, tokenPrefix: e.target.value.toUpperCase().slice(0, 8) }))} />
            </div>
          </div>
          <ConsultFields
            consultationFee={consultationFee}
            setConsultationFee={setConsultationFee}
            slotDurationMinutes={slotDurationMinutes}
            setSlotDurationMinutes={setSlotDurationMinutes}
            opdTiming={opdTiming}
            setOpdTiming={setOpdTiming}
            rxTemplate={rxTemplate}
            setRxTemplate={setRxTemplate}
            inputClass={inputClass}
          />
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <button type="button" className={`${backBtn} w-full sm:w-auto justify-center`} onClick={() => setPolyclinicStep(3)}>
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
            <button type="button" onClick={handleCompleteSetup} disabled={busy} className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-600 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-xl shadow-indigo-600/20 disabled:opacity-50">
              {busy ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /> Opening clinic operations...</>
              ) : (
                <><Sparkles className="w-4 h-4 text-amber-300" /> Open clinic operations <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          </div>
        </section>
      )}
    </div>
  );
};

function ConsultFields({
  consultationFee,
  setConsultationFee,
  slotDurationMinutes,
  setSlotDurationMinutes,
  opdTiming,
  setOpdTiming,
  rxTemplate,
  setRxTemplate,
  inputClass,
}: {
  consultationFee: number;
  setConsultationFee: (n: number) => void;
  slotDurationMinutes: number;
  setSlotDurationMinutes: (n: number) => void;
  opdTiming: string;
  setOpdTiming: (s: string) => void;
  rxTemplate: "classic" | "compact" | "detailed";
  setRxTemplate: (t: "classic" | "compact" | "detailed") => void;
  inputClass: string;
}) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs mb-5">
        <div>
          <label className="block text-slate-300 font-semibold mb-1">Default consultation fee (₹)</label>
          <div className="relative">
            <IndianRupee className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input type="number" min="0" step="50" value={consultationFee} onChange={(e) => setConsultationFee(Number(e.target.value))} className={`${inputClass} pl-9 font-semibold`} />
          </div>
        </div>
        <div>
          <label className="block text-slate-300 font-semibold mb-1">Average slot duration</label>
          <div className="relative">
            <Timer className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <select value={slotDurationMinutes} onChange={(e) => setSlotDurationMinutes(Number(e.target.value))} className={`${inputClass} pl-9`}>
              {[10, 15, 20, 30, 45, 60].map((mins) => (
                <option key={mins} value={mins}>{mins} minutes</option>
              ))}
            </select>
          </div>
        </div>
        <div className="md:col-span-2">
          <label className="block text-slate-300 font-semibold mb-1">Operating OPD hours</label>
          <div className="relative">
            <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input value={opdTiming} onChange={(e) => setOpdTiming(e.target.value)} placeholder="09:00 AM - 01:00 PM, 04:00 PM - 07:00 PM" className={`${inputClass} pl-9`} />
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
            className={`p-3 rounded-xl border text-left ${rxTemplate === tpl.id ? "bg-purple-950/40 border-purple-500" : "bg-slate-950 border-slate-800 hover:border-slate-700"}`}
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
    </>
  );
}

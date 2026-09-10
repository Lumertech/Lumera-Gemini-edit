import React, { useEffect, useRef, useState } from "react";
import { Award, Building2, Clock, IndianRupee, MapPin, PenLine, Save, ShieldCheck, Stamp, Timer, Upload } from "lucide-react";
import { Doctor, PolyclinicSpecialty, TenantLetterhead } from "../types";
import { useAuth } from "../auth/AuthContext";
import { patchTenantLetterhead } from "../lib/letterhead";

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

interface ClinicProfileSettingsProps {
  currentDoctor: Doctor;
  letterhead?: TenantLetterhead | null;
  onDoctorUpdated: (doctor: Doctor) => void;
  onLetterheadSaved?: (letterhead: TenantLetterhead) => void;
}

export const ClinicProfileSettings: React.FC<ClinicProfileSettingsProps> = ({
  currentDoctor,
  letterhead,
  onDoctorUpdated,
  onLetterheadSaved,
}) => {
  const { user, completeOnboarding } = useAuth();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [doctorName, setDoctorName] = useState(currentDoctor.name || user?.name || "");
  const [clinicName, setClinicName] = useState(letterhead?.clinicName || user?.clinicName || "");
  const [regNumber, setRegNumber] = useState(currentDoctor.regNumber || "");
  const [qualification, setQualification] = useState(currentDoctor.qualification || "");
  const [specialty, setSpecialty] = useState<PolyclinicSpecialty>(
    (currentDoctor.specialty as PolyclinicSpecialty) || "General Medicine"
  );
  const [consultationFee, setConsultationFee] = useState(currentDoctor.consultationFee || 0);
  const [slotDurationMinutes, setSlotDurationMinutes] = useState(currentDoctor.slotDurationMinutes || 15);
  const [opdTiming, setOpdTiming] = useState(currentDoctor.opdTiming || "");
  const [rxTemplate, setRxTemplate] = useState<"classic" | "compact" | "detailed">(
    currentDoctor.rxTemplate || "classic"
  );
  const [signatureUrl, setSignatureUrl] = useState(letterhead?.signatureUrl || currentDoctor.signatureUrl || "");
  const [address, setAddress] = useState(letterhead?.address || "");
  const [city, setCity] = useState(letterhead?.city || "");
  const [phone, setPhone] = useState(letterhead?.phone || user?.phone || "");
  const [clinicEmail, setClinicEmail] = useState(letterhead?.email || user?.email || "");
  const [gstin, setGstin] = useState(letterhead?.gstin || "");
  const [upiId, setUpiId] = useState(letterhead?.upiId || "");
  const [sealText, setSealText] = useState(letterhead?.sealText || "");
  const [website, setWebsite] = useState(letterhead?.website || "");
  const [regId, setRegId] = useState(letterhead?.regId || "");
  const [tagline, setTagline] = useState(letterhead?.tagline || "");
  const [footerDisclaimer, setFooterDisclaimer] = useState(letterhead?.footerDisclaimer || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!letterhead) return;
    setClinicName(letterhead.clinicName || user?.clinicName || "");
    setAddress(letterhead.address || "");
    setCity(letterhead.city || "");
    setPhone(letterhead.phone || user?.phone || "");
    setClinicEmail(letterhead.email || user?.email || "");
    setGstin(letterhead.gstin || "");
    setUpiId(letterhead.upiId || "");
    setSealText(letterhead.sealText || "");
    setWebsite(letterhead.website || "");
    setRegId(letterhead.regId || "");
    setTagline(letterhead.tagline || "");
    setFooterDisclaimer(letterhead.footerDisclaimer || "");
    if (letterhead.signatureUrl) setSignatureUrl(letterhead.signatureUrl);
  }, [letterhead, user?.clinicName, user?.email, user?.phone]);

  const handleSave = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await completeOnboarding({
        doctorName,
        clinicName,
        specialty,
        regNumber,
        qualification,
        consultationFee,
        opdTiming,
        practiceType: user?.practiceType,
        signatureUrl,
        slotDurationMinutes,
        rxTemplate,
      });
      if (res.user) {
        onDoctorUpdated({
          ...currentDoctor,
          name: doctorName,
          qualification,
          regNumber,
          specialty,
          consultationFee,
          opdTiming,
          signatureUrl,
          slotDurationMinutes,
          rxTemplate,
        });
      }

      const saved = await patchTenantLetterhead({
        clinicName: clinicName.trim(),
        address: address.trim(),
        city: city.trim(),
        phone: phone.trim(),
        email: clinicEmail.trim(),
        website: website.trim(),
        gstin: gstin.trim(),
        regId: regId.trim(),
        upiId: upiId.trim(),
        whatsappNumber: phone.trim() || user?.phone || "",
        sealText: sealText.trim(),
        signatureUrl,
        tagline: tagline.trim(),
        footerDisclaimer: footerDisclaimer.trim(),
      });
      onLetterheadSaved?.(saved);
      setMessage("Clinic letterhead and doctor profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
      <h2 className="text-lg font-bold text-slate-900 mb-1">Clinic & Doctor Profile Settings</h2>
      <p className="text-xs text-slate-500 mb-5">
        Letterhead on printed Rx and GST invoices uses this clinic&apos;s name, address, GSTIN, UPI, seal, and signature — not Lumera seed branding.
      </p>

      {error && <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}
      {message && <div className="mb-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2">{message}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <label className="block text-xs font-semibold text-slate-600">
          Doctor name
          <div className="relative mt-1">
            <Award className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300" value={doctorName} onChange={(e) => setDoctorName(e.target.value)} />
          </div>
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Clinic name
          <div className="relative mt-1">
            <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300" value={clinicName} onChange={(e) => setClinicName(e.target.value)} />
          </div>
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Registration number
          <div className="relative mt-1">
            <ShieldCheck className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 font-mono" value={regNumber} onChange={(e) => setRegNumber(e.target.value)} />
          </div>
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Qualification
          <input className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300" value={qualification} onChange={(e) => setQualification(e.target.value)} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Speciality
          <select className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300" value={specialty} onChange={(e) => setSpecialty(e.target.value as PolyclinicSpecialty)}>
            {SPECIALTIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Consultation fee (₹)
          <div className="relative mt-1">
            <IndianRupee className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input type="number" className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300" value={consultationFee} onChange={(e) => setConsultationFee(Number(e.target.value))} />
          </div>
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Slot duration (minutes)
          <div className="relative mt-1">
            <Timer className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input type="number" className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300" value={slotDurationMinutes} onChange={(e) => setSlotDurationMinutes(Number(e.target.value))} />
          </div>
        </label>
        <label className="block text-xs font-semibold text-slate-600 md:col-span-2">
          OPD hours
          <div className="relative mt-1">
            <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300" value={opdTiming} onChange={(e) => setOpdTiming(e.target.value)} />
          </div>
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Rx template
          <select className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300" value={rxTemplate} onChange={(e) => setRxTemplate(e.target.value as "classic" | "compact" | "detailed")}>
            <option value="classic">Classic letterhead</option>
            <option value="compact">Compact OPD slip</option>
            <option value="detailed">Detailed clinical Rx</option>
          </select>
        </label>
        <div className="text-xs font-semibold text-slate-600">
          Digital signature
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setSignatureUrl(typeof reader.result === "string" ? reader.result : "");
              reader.readAsDataURL(file);
            }}
          />
          <button type="button" onClick={() => fileRef.current?.click()} className="mt-1 w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-slate-300 text-slate-600">
            <Upload className="w-4 h-4" /> {signatureUrl ? "Replace signature" : "Upload signature"}
          </button>
          {signatureUrl && (
            <div className="mt-2 h-12 bg-slate-50 rounded border flex items-center justify-center">
              <img src={signatureUrl} alt="Signature" className="max-h-10 object-contain" />
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 pt-5 border-t border-slate-200">
        <h3 className="text-sm font-bold text-slate-900 mb-1">Clinic letterhead</h3>
        <p className="text-[11px] text-slate-500 mb-3">
          Shown on printed prescriptions and invoices. Saved via <span className="font-mono">PATCH /api/tenant/letterhead</span>.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <label className="block text-xs font-semibold text-slate-600 md:col-span-2">
            Address
            <div className="relative mt-1">
              <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, building, area" />
            </div>
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            City
            <input className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City, state, PIN" />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Phone
            <input className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Email
            <input className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300" value={clinicEmail} onChange={(e) => setClinicEmail(e.target.value)} />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            GSTIN
            <input className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 font-mono uppercase" value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="Clinic GSTIN" />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            UPI ID
            <input className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 font-mono" value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="clinic@bank" />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Clinic registration ID
            <input className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 font-mono" value={regId} onChange={(e) => setRegId(e.target.value)} />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Website
            <input className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Tagline
            <input className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300" value={tagline} onChange={(e) => setTagline(e.target.value)} />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Seal text
            <div className="relative mt-1">
              <Stamp className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300" value={sealText} onChange={(e) => setSealText(e.target.value)} />
            </div>
          </label>
          <label className="block text-xs font-semibold text-slate-600 md:col-span-2">
            Footer disclaimer
            <textarea className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-xs" rows={2} value={footerDisclaimer} onChange={(e) => setFooterDisclaimer(e.target.value)} />
          </label>
        </div>
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={busy}
        className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
      >
        {busy ? "Saving..." : <><Save className="w-4 h-4" /> Save profile</>}
      </button>
      <p className="text-[11px] text-slate-400 mt-3 flex items-center gap-1">
        <PenLine className="w-3 h-3" /> Practice type was set during onboarding and can be changed by completing setup again from this page after selecting type on the original wizard if needed.
      </p>
    </div>
  );
};

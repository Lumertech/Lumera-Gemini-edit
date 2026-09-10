import React, { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  UserCheck,
  Search,
  UserPlus,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  CreditCard,
  ArrowRight,
} from 'lucide-react';
import { Patient, Doctor, Appointment } from '../types';
import {
  BRIDGE_DOWN_MESSAGE,
  BACK_TO_PRACTICE_SIMPLE,
  LINK_ABHA_CTA,
  LINKED_SANDBOX_CHIP,
  NHA_SANDBOX_BADGE,
  NHA_SANDBOX_NOTICE,
  OTP_ACCEPTED_NOTICE,
  OTP_FAILED_MESSAGE,
  PRACTICE_SIMPLE_ABHA_LATER,
  SIMULATOR_BADGE,
  abhaStatusChip,
  ageFromDob,
  findMatchingPatient,
  generateAbhaSandboxOtp,
  genderFromAbdm,
  linkAbhaBodyFromVerify,
  requireAbdmBridgeReady,
  verifyAbhaSandboxOtp,
  type AbhaSandboxVerifyResponse,
  type ClinicalHandoffView,
  type LinkAbhaRequest,
  type LinkAbhaResponse,
  type OnboardingPath,
} from '../lib/patientOnboarding';

interface ReceptionProps {
  patients: Patient[];
  doctors: Doctor[];
  appointments: Appointment[];
  onSelectPatient: (patient: Patient) => void;
  onAddNewPatient: (patient: Patient) => void | Promise<Patient | void>;
  onCheckInPatient: (patient: Patient, doctor: Doctor, type: string) => void | Promise<void>;
  onSwitchToConsultation: () => void;
  onStartConsult?: (patient: Patient) => void;
  firstRunHint?: boolean;
  openRxAfterSave?: boolean;
  onLinkAbha?: (body: LinkAbhaRequest) => Promise<LinkAbhaResponse>;
  onHandoff?: (patient: Patient, view: ClinicalHandoffView) => void;
}

export const Reception: React.FC<ReceptionProps> = ({
  patients,
  doctors,
  appointments: _appointments,
  onSelectPatient,
  onAddNewPatient,
  onCheckInPatient,
  onSwitchToConsultation,
  onStartConsult,
  firstRunHint = false,
  openRxAfterSave = false,
  onLinkAbha,
  onHandoff,
}) => {
  const [path, setPath] = useState<OnboardingPath>('practice-simple');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Patient[]>(patients);

  const [aadhaarNumber, setAadhaarNumber] = useState('');
  const [otpSentTxnId, setOtpSentTxnId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [isGeneratingOtp, setIsGeneratingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [otpAccepted, setOtpAccepted] = useState<AbhaSandboxVerifyResponse | null>(null);
  const [sandboxOtpHint, setSandboxOtpHint] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    age: 35,
    gender: 'Male' as 'Male' | 'Female' | 'Other',
    address: '',
    selectedDoctorId: doctors[0]?.id || '',
    consultationType: 'Walk-in Consultation',
    issueToken: true,
  });

  const [savingIntake, setSavingIntake] = useState(false);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [handoffPatient, setHandoffPatient] = useState<Patient | null>(null);
  const [confirmMatch, setConfirmMatch] = useState<Patient | null>(null);
  const [useExistingConfirmed, setUseExistingConfirmed] = useState(false);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(patients);
      return;
    }
    const q = searchQuery.toLowerCase();
    const filtered = patients.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.phone.includes(q) ||
        p.uhid.toLowerCase().includes(q) ||
        (p.abhaAddress && p.abhaAddress.toLowerCase().includes(q)) ||
        (p.abhaNumber && p.abhaNumber.includes(q))
    );
    setSearchResults(filtered);
  }, [searchQuery, patients]);

  const liveMatch = useMemo(
    () =>
      findMatchingPatient(patients, {
        phone: formData.phone,
        abhaNumber: otpAccepted?.abhaNumber,
      }),
    [patients, formData.phone, otpAccepted?.abhaNumber]
  );

  useEffect(() => {
    if (!liveMatch) {
      setConfirmMatch(null);
      setUseExistingConfirmed(false);
      return;
    }
    setConfirmMatch(liveMatch);
  }, [liveMatch?.id]);

  useEffect(() => {
    if (path !== 'abha-sandbox') {
      setBridgeError(null);
      return;
    }
    let cancelled = false;
    void requireAbdmBridgeReady()
      .then(() => {
        if (!cancelled) setBridgeError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setBridgeError(err instanceof Error ? err.message : BRIDGE_DOWN_MESSAGE);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const resetAbhaFlow = () => {
    setOtpAccepted(null);
    setOtpSentTxnId(null);
    setAadhaarNumber('');
    setOtpCode('');
    setSandboxOtpHint(null);
    setOtpError(null);
  };

  const handleGenerateOtp = async () => {
    const clean = aadhaarNumber.replace(/\D/g, '');
    if (clean.length !== 12) {
      setOtpError('Enter a 12-digit Aadhaar number for the NHA sandbox OTP.');
      return;
    }
    setOtpError(null);
    setIsGeneratingOtp(true);
    try {
      const data = await generateAbhaSandboxOtp(clean);
      setOtpSentTxnId(data.txnId);
      setOtpCode('');
      setSandboxOtpHint(data.testOtp || null);
      setOtpAccepted(null);
    } catch (err: unknown) {
      setOtpError(err instanceof Error ? err.message : BRIDGE_DOWN_MESSAGE);
      setOtpSentTxnId(null);
      setOtpAccepted(null);
      setSandboxOtpHint(null);
    } finally {
      setIsGeneratingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpSentTxnId || !otpCode) {
      setOtpError('Enter the 6-digit OTP from the NHA sandbox.');
      return;
    }
    setOtpError(null);
    setIsVerifyingOtp(true);
    try {
      const data = await verifyAbhaSandboxOtp(otpSentTxnId, otpCode);
      setOtpAccepted(data);
      setFormData((prev) => ({
        ...prev,
        name: data.profile.name,
        phone: data.profile.mobile,
        gender: genderFromAbdm(data.profile.gender),
        address: data.profile.address || prev.address,
        age: ageFromDob(data.profile.dob) ?? prev.age,
      }));
    } catch (err: unknown) {
      setOtpAccepted(null);
      setOtpError(err instanceof Error ? err.message : OTP_FAILED_MESSAGE);
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const finishHandoff = (saved: Patient) => {
    onSelectPatient(saved);
    setHandoffPatient(saved);
    if (openRxAfterSave && onStartConsult) {
      onStartConsult(saved);
      return;
    }
  };

  const goHandoff = (view: ClinicalHandoffView) => {
    const patient = handoffPatient;
    if (!patient) return;
    onSelectPatient(patient);
    if (onHandoff) {
      onHandoff(patient, view);
      return;
    }
    if (view === 'rx' && onStartConsult) onStartConsult(patient);
    else onSwitchToConsultation();
  };

  const handleCompleteIntake = async () => {
    if (!formData.name.trim() || !formData.phone.trim()) {
      setIntakeError('Please fill out patient name and phone number');
      return;
    }

    if (confirmMatch && !useExistingConfirmed) {
      setIntakeError(`This phone or ABHA already has a chart (${confirmMatch.name} · ${confirmMatch.uhid}). Confirm to use that patientId.`);
      return;
    }

    const doctor = doctors.find((d) => d.id === formData.selectedDoctorId) || doctors[0];
    setSavingIntake(true);
    setIntakeError(null);

    try {
      let saved: Patient;
      if (path === 'abha-sandbox') {
        if (bridgeError) throw new Error(bridgeError);
        if (!otpAccepted) throw new Error('Complete NHA sandbox OTP before linking ABHA.');
        const body = linkAbhaBodyFromVerify(otpAccepted, {
          patientId: confirmMatch?.id,
          phone: formData.phone,
          txnId: otpSentTxnId || undefined,
        });
        if (!onLinkAbha) {
          throw new Error('ABHA link is unavailable. Use practice-simple intake, or retry Link ABHA (NHA sandbox).');
        }
        const result = await onLinkAbha(body);
        saved = result.patient;
      } else {
        const draft: Patient = {
          id: confirmMatch?.id || '',
          uhid: confirmMatch?.uhid || '',
          name: formData.name,
          age: formData.age,
          gender: formData.gender,
          phone: formData.phone,
          bloodGroup: 'B+',
          allergies: ['None known'],
          chronicConditions: [],
          emergencyContact: formData.phone,
          address: formData.address,
          lastVisit: 'Today',
        };
        saved = (await onAddNewPatient(draft)) || draft;
        if (!saved.id) {
          throw new Error('Could not save patient');
        }
      }

      if (formData.issueToken && doctor) {
        await onCheckInPatient(saved, doctor, formData.consultationType);
      }

      finishHandoff(saved);
      resetAbhaFlow();
      setPath('practice-simple');
      setFormData({
        name: '',
        phone: '',
        age: 35,
        gender: 'Male',
        address: '',
        selectedDoctorId: doctors[0]?.id || '',
        consultationType: 'Walk-in Consultation',
        issueToken: true,
      });
      setConfirmMatch(null);
      setUseExistingConfirmed(false);
    } catch (err: unknown) {
      setIntakeError(err instanceof Error ? err.message : 'Could not save patient. Please try again.');
    } finally {
      setSavingIntake(false);
    }
  };

  const abhaBlocked = path === 'abha-sandbox' && Boolean(bridgeError);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 font-manrope">OPD Reception</h1>
            {path === 'abha-sandbox' && (
              <>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                  {NHA_SANDBOX_BADGE}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                  {SIMULATOR_BADGE}
                </span>
              </>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {firstRunHint
              ? 'Practice-simple default: name, phone, age/sex. Saving writes a durable chart and an optional Waiting OPD token.'
              : 'Practice-simple is the default landing. Link ABHA is an optional NHA sandbox step on the same patientId.'}
          </p>
        </div>

        {path === 'practice-simple' ? (
          <button
            type="button"
            onClick={() => setPath('abha-sandbox')}
            className="self-start px-3 py-2 text-xs font-semibold rounded-lg border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 flex items-center gap-1.5"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{LINK_ABHA_CTA}</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-white text-amber-800 border border-amber-200">
              {NHA_SANDBOX_BADGE}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              resetAbhaFlow();
              setPath('practice-simple');
            }}
            className="self-start px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          >
            {BACK_TO_PRACTICE_SIMPLE}
          </button>
        )}
      </div>

      {path === 'abha-sandbox' && (
        <div className="bg-slate-900 text-white rounded-xl p-5 border border-slate-700 shadow-md">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-5 h-5 text-amber-300" />
            <span className="text-xs font-bold uppercase tracking-wider text-amber-200">{LINK_ABHA_CTA}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-400/30">
              {NHA_SANDBOX_BADGE}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-200 border border-white/20">
              {SIMULATOR_BADGE}
            </span>
          </div>
          <p className="text-xs text-slate-300 mb-4">{NHA_SANDBOX_NOTICE}</p>

          {abhaBlocked ? (
            <div className="p-3 bg-rose-500/20 border border-rose-400/40 text-rose-100 text-xs rounded flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{bridgeError}</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {!otpSentTxnId ? (
                <>
                  <input
                    type="text"
                    maxLength={12}
                    value={aadhaarNumber}
                    onChange={(e) => setAadhaarNumber(e.target.value)}
                    placeholder="12-digit Aadhaar (sandbox)"
                    className="bg-black/30 border border-white/20 text-white placeholder-slate-400 text-xs px-3 py-2 rounded-lg font-mono w-52"
                  />
                  <button
                    type="button"
                    onClick={() => void handleGenerateOtp()}
                    disabled={isGeneratingOtp || aadhaarNumber.replace(/\D/g, '').length < 12}
                    className="px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isGeneratingOtp ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                    Generate OTP
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="OTP"
                    className="bg-black/40 border border-amber-400/50 text-amber-100 text-xs px-3 py-2 rounded-lg font-mono font-bold w-28"
                  />
                  <button
                    type="button"
                    onClick={() => void handleVerifyOtp()}
                    disabled={isVerifyingOtp}
                    className="px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isVerifyingOtp ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Verify OTP
                  </button>
                  <button type="button" onClick={resetAbhaFlow} className="text-slate-300 hover:text-white p-2 text-xs">
                    Cancel
                  </button>
                  {sandboxOtpHint && (
                    <span className="text-[10px] text-amber-200/80">
                      {NHA_SANDBOX_BADGE} test OTP: <span className="font-mono font-bold">{sandboxOtpHint}</span>
                    </span>
                  )}
                </>
              )}
            </div>
          )}

          {otpError && (
            <div className="mt-3 p-2 bg-rose-500/20 border border-rose-400/40 text-rose-200 text-xs rounded flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{otpError}</span>
            </div>
          )}

          {otpAccepted && (
            <div className="mt-4 p-3 bg-amber-500/15 border border-amber-400/40 rounded-lg text-xs">
              <div className="font-bold text-amber-200">{otpAccepted.profile.name}</div>
              <div className="text-amber-100/80 font-mono text-[11px] mt-0.5">
                ABHA {otpAccepted.abhaNumber}
                {otpAccepted.abhaAddress ? ` · ${otpAccepted.abhaAddress}` : ''}
              </div>
              <p className="mt-2 text-amber-100/90">{OTP_ACCEPTED_NOTICE}</p>
            </div>
          )}
        </div>
      )}

      {path === 'practice-simple' && (
        <p className="text-xs text-slate-500 px-1">{PRACTICE_SIMPLE_ABHA_LATER}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <UserPlus className="w-5 h-5 text-blue-600" />
            <h3 className="font-bold text-sm text-slate-900">
              {patients.length === 0 ? 'Add your first patient' : 'Patient intake'}
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-600 font-medium mb-1">Patient Full Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Anita Rao"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-slate-600 font-medium mb-1">Mobile Number *</label>
              <input
                type="text"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+91 98234 55667"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-slate-600 font-medium mb-1">Age (Years)</label>
              <input
                type="number"
                value={formData.age}
                onChange={(e) => setFormData({ ...formData, age: parseInt(e.target.value, 10) || 0 })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-slate-600 font-medium mb-1">Gender</label>
              <select
                value={formData.gender}
                onChange={(e) => setFormData({ ...formData, gender: e.target.value as 'Male' | 'Female' | 'Other' })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-slate-600 font-medium mb-1">Assign Doctor</label>
              <select
                value={formData.selectedDoctorId}
                onChange={(e) => setFormData({ ...formData, selectedDoctorId: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {doctors.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.name} — {doc.specialty}
                  </option>
                ))}
              </select>
            </div>
            <label className="sm:col-span-2 flex items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                checked={formData.issueToken}
                onChange={(e) => setFormData({ ...formData, issueToken: e.target.checked })}
              />
              Issue Waiting OPD token
            </label>
          </div>

          {confirmMatch && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs space-y-2">
              <p className="text-amber-900">
                Matching chart: <strong>{confirmMatch.name}</strong> ({confirmMatch.uhid}). Same tenant phone/ABHA — link instead of creating a duplicate.
              </p>
              <button
                type="button"
                onClick={() => setUseExistingConfirmed(true)}
                className="px-3 py-1.5 bg-amber-700 text-white rounded-md font-semibold"
              >
                {useExistingConfirmed ? 'Using existing patientId' : 'Use existing chart'}
              </button>
            </div>
          )}

          {intakeError && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{intakeError}</span>
            </div>
          )}

          <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
            <button
              type="button"
              onClick={() => void handleCompleteIntake()}
              disabled={savingIntake || abhaBlocked || (path === 'abha-sandbox' && !otpAccepted)}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-2 disabled:opacity-60"
            >
              {savingIntake ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              <span>
                {savingIntake
                  ? 'Saving…'
                  : path === 'abha-sandbox'
                    ? 'Link ABHA & continue'
                    : formData.issueToken
                      ? 'Save chart & issue token'
                      : 'Save chart'}
              </span>
            </button>
          </div>
        </div>

        <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm text-slate-900">Clinic patients</h3>
              <p className="text-xs text-slate-500">Same tenant list — search is optional after intake handoff</p>
            </div>
            <span className="text-xs font-mono text-slate-500">{searchResults.length} patients</span>
          </div>

          {handoffPatient && (
            <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-xs space-y-2">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-emerald-700" />
                <strong className="text-slate-900">
                  Selected {handoffPatient.name} ({handoffPatient.uhid})
                </strong>
                {abhaStatusChip(handoffPatient).linked && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                    {LINKED_SANDBOX_CHIP}
                  </span>
                )}
              </div>
              <p className="text-slate-600">Continue on the clinical thread without searching again.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => goHandoff('queue')} className="px-3 py-1.5 bg-white border border-slate-200 rounded-md font-semibold text-slate-800">
                  OPD Queue
                </button>
                <button type="button" onClick={() => goHandoff('rx')} className="px-3 py-1.5 bg-blue-600 text-white rounded-md font-semibold">
                  Smart Rx
                </button>
                <button type="button" onClick={() => goHandoff('billing')} className="px-3 py-1.5 bg-white border border-slate-200 rounded-md font-semibold text-slate-800">
                  Bill
                </button>
              </div>
            </div>
          )}

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, UHID, ABHA, or phone"
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
            {searchResults.length === 0 && (
              <div className="p-6 text-center border border-dashed border-slate-200 rounded-lg bg-slate-50">
                <UserPlus className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-800">No patients in this clinic yet</p>
                <p className="text-xs text-slate-500 mt-1">Use practice-simple intake to register the first patient.</p>
              </div>
            )}
            {searchResults.map((p) => {
              const chip = abhaStatusChip(p);
              return (
                <div
                  key={p.id}
                  className="p-3.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/30 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <strong className="font-bold text-slate-900 text-sm">{p.name}</strong>
                      <span className="text-slate-500 font-mono text-[11px]">{p.uhid}</span>
                      {chip.linked ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                          {LINKED_SANDBOX_CHIP}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-50 text-slate-600 border border-slate-200">
                          No ABHA
                        </span>
                      )}
                    </div>
                    <div className="text-slate-500 flex items-center gap-3 text-[11px]">
                      <span>
                        {p.age} Yrs / {p.gender}
                      </span>
                      <span>•</span>
                      <span>{p.phone}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectPatient(p);
                      setHandoffPatient(p);
                      if (onStartConsult) onStartConsult(p);
                      else onSwitchToConsultation();
                    }}
                    className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold flex items-center gap-1"
                  >
                    <span>Start Consult</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

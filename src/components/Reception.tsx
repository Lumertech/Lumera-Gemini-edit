import React, { useState, useEffect } from 'react';
import { apiFetchResponse } from '../api/http';
import { formatINR } from '../lib/currency.ts';
import { 
  QrCode, 
  ShieldCheck, 
  UserCheck, 
  Search, 
  UserPlus, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Clock, 
  Phone, 
  Calendar, 
  User, 
  Sparkles, 
  Building2, 
  BadgeCheck, 
  CreditCard,
  ArrowRight,
  Camera,
  Upload,
  X,
  FileText
} from 'lucide-react';
import { Patient, Doctor, Appointment, isAbhaLinked } from '../types';
import type { SpecialtyWorkflowPack } from '../lib/specialtyWorkflow';
import { PatientRecordModal } from './PatientRecordModal';
import {
  inferHouseholdHolderName,
  matchingPhoneProfiles,
  phoneKey10,
  profileKindBadge,
} from '../lib/sharedMobile';

interface ReceptionProps {
  patients: Patient[];
  doctors: Doctor[];
  appointments: Appointment[];
  onSelectPatient: (patient: Patient) => void;
  onAddNewPatient: (patient: Patient) => void | Promise<Patient | void>;
  onCheckInPatient: (patient: Patient, doctor: Doctor, type: string) => void | Promise<void>;
  onSwitchToConsultation: () => void;
  onStartConsult?: (patient: Patient) => void;
  canStartConsult?: boolean;
  firstRunHint?: boolean;
  openRxAfterSave?: boolean;
  workflow?: SpecialtyWorkflowPack;
  intakeName?: string;
  intakePhone?: string;
}

function defaultRelationshipForWorkflow(workflow?: SpecialtyWorkflowPack): string {
  if (workflow?.rxModule === 'Veterinary') return 'Pet';
  if (workflow?.rxModule === 'Pediatrics') return 'Child';
  return 'Self';
}

const REGISTERING_FOR_OPTIONS = [
  { value: 'Self', label: 'Self' },
  { value: 'Pet', label: "Pet (Owner's Mobile)" },
  { value: 'Child', label: "Child (Parent's Mobile)" },
  { value: 'Family Member', label: 'Family Member' },
  { value: 'Friend / Caregiver', label: 'Friend / Caregiver' },
] as const;

export const Reception: React.FC<ReceptionProps> = ({
  patients,
  doctors,
  appointments,
  onSelectPatient,
  onAddNewPatient,
  onCheckInPatient,
  onSwitchToConsultation,
  onStartConsult,
  canStartConsult = false,
  firstRunHint = false,
  openRxAfterSave = false,
  workflow,
  intakeName = "",
  intakePhone = "",
}) => {
  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Patient[]>(patients);

  // Aadhaar OTP Verification State
  const [aadhaarNumber, setAadhaarNumber] = useState('');
  const [otpSentTxnId, setOtpSentTxnId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [isGeneratingOtp, setIsGeneratingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [verificationSuccess, setVerificationSuccess] = useState<{
    abhaNumber: string;
    abhaAddress: string;
    name: string;
    gender: string;
    dob: string;
    mobile: string;
  } | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);

  // QR Scanner Modal State
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrSimulating, setQrSimulating] = useState(false);

  // Intake Form State (New or Verified Patient)
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    age: workflow?.rxModule === 'Veterinary' ? 3 : workflow?.rxModule === 'Pediatrics' ? 5 : 35,
    dateOfBirth: '',
    gender: 'Male' as 'Male' | 'Female' | 'Other',
    bloodGroup: 'B+',
    address: '',
    emergencyContact: '',
    relationshipToHolder: defaultRelationshipForWorkflow(workflow),
    primaryContactName: '',
    createNewMember: false,
    selectedDoctorId: doctors[0]?.id || '',
    consultationType: workflow?.consultTypeDefault || 'Walk-in Consultation',
    extra: {} as Record<string, string>,
  });

  const [savingIntake, setSavingIntake] = useState(false);
  const [checkingInPeerId, setCheckingInPeerId] = useState<string | null>(null);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [selectedRecordPatient, setSelectedRecordPatient] = useState<Patient | null>(null);

  useEffect(() => {
    setFormData((prev) => {
      const nextRel = defaultRelationshipForWorkflow(workflow);
      if (prev.name || prev.phone) return prev;
      return {
        ...prev,
        relationshipToHolder: nextRel,
        age: workflow?.rxModule === 'Veterinary' ? 3 : workflow?.rxModule === 'Pediatrics' ? 5 : prev.age,
        consultationType: workflow?.consultTypeDefault || prev.consultationType,
      };
    });
  }, [workflow?.rxModule, workflow?.consultTypeDefault]);

  useEffect(() => {
    const next = intakeName.trim();
    if (!next) return;
    setFormData((prev) => ({ ...prev, name: next }));
  }, [intakeName]);

  useEffect(() => {
    const nextPhone = intakePhone.trim();
    if (!nextPhone) return;
    const peers = matchingPhoneProfiles(patients, nextPhone);
    const holder = inferHouseholdHolderName(peers);
    const peerAddress = peers.find((p) => p.address)?.address || '';
    const defaultRel =
      workflow?.rxModule === 'Veterinary'
        ? 'Pet'
        : workflow?.rxModule === 'Pediatrics'
          ? 'Child'
          : 'Family Member';
    setFormData((prev) => ({
      ...prev,
      name: '',
      phone: nextPhone,
      relationshipToHolder: prev.relationshipToHolder === 'Self' ? defaultRel : prev.relationshipToHolder,
      primaryContactName: holder || prev.primaryContactName,
      emergencyContact: holder || prev.emergencyContact,
      address: peerAddress || prev.address,
      createNewMember: true,
      extra: {
        ...prev.extra,
        ...(holder ? { ownerName: holder } : {}),
      },
    }));
  }, [intakePhone, patients, workflow?.rxModule]);

  const phoneMatches = matchingPhoneProfiles(patients, formData.phone);
  const phoneCounts = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const p of patients) {
      const k = phoneKey10(p.phone);
      if (k.length >= 10) map.set(k, (map.get(k) || 0) + 1);
    }
    return map;
  }, [patients]);

  // Filter patients on search
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
        phoneKey10(p.phone).includes(q.replace(/\D/g, '') || '__none__') ||
        p.uhid.toLowerCase().includes(q) ||
        (p.primaryContactName && p.primaryContactName.toLowerCase().includes(q)) ||
        (p.ownerName && p.ownerName.toLowerCase().includes(q)) ||
        (p.emergencyContact && p.emergencyContact.toLowerCase().includes(q)) ||
        (p.species && p.species.toLowerCase().includes(q)) ||
        (p.breed && p.breed.toLowerCase().includes(q)) ||
        (p.abhaAddress && p.abhaAddress.toLowerCase().includes(q)) ||
        (p.abhaNumber && p.abhaNumber.includes(q))
    );
    setSearchResults(filtered);
  }, [searchQuery, patients]);

  // Step 1: Generate Aadhaar OTP
  const handleGenerateOtp = async () => {
    const clean = aadhaarNumber.replace(/\D/g, '');
    if (clean.length !== 12) {
      setOtpError('Please enter a valid 12-digit Aadhaar number');
      return;
    }

    setOtpError(null);
    setIsGeneratingOtp(true);
    try {
      const res = await apiFetchResponse('/api/abdm/v3/registration/aadhaar/generateOtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aadhaar: clean }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate OTP');
      }

      setOtpSentTxnId(data.txnId);
      // Only pre-fill when the backend explicitly echoes a dev/sandbox test
      // OTP (non-production only). In a real deployment `data.testOtp` is
      // absent and the receptionist must enter the OTP the patient reads
      // off their own phone.
      setOtpCode(data.testOtp || '');
    } catch (err: any) {
      setOtpError(err.message || 'Error generating Aadhaar OTP');
    } finally {
      setIsGeneratingOtp(false);
    }
  };

  // Step 2: Verify Aadhaar OTP & Issue ABHA
  const handleVerifyOtp = async () => {
    if (!otpSentTxnId || !otpCode) {
      setOtpError('Please enter the 6-digit OTP');
      return;
    }

    setOtpError(null);
    setIsVerifyingOtp(true);
    try {
      const res = await apiFetchResponse('/api/abdm/v3/registration/aadhaar/verifyOTP', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txnId: otpSentTxnId,
          otp: otpCode,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Invalid OTP');
      }

      setVerificationSuccess({
        abhaNumber: data.abhaNumber,
        abhaAddress: data.abhaAddress,
        name: data.profile.name,
        gender: data.profile.gender === 'M' ? 'Male' : data.profile.gender === 'F' ? 'Female' : 'Other',
        dob: data.profile.dob,
        mobile: data.profile.mobile,
      });

      // Pre-fill intake form with official Aadhaar demographic data
      setFormData((prev) => ({
        ...prev,
        name: data.profile.name,
        phone: data.profile.mobile,
        gender: data.profile.gender === 'M' ? 'Male' : data.profile.gender === 'F' ? 'Female' : 'Other',
        address: data.profile.address || prev.address,
        age: data.profile.dob ? (new Date().getFullYear() - parseInt(data.profile.dob.split('-')[0])) : prev.age,
      }));
    } catch (err: any) {
      setOtpError(err.message || 'OTP verification failed');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  // Scan or Select Sample ABHA QR Card
  const handleSampleQrScan = (sample: {
    name: string;
    abhaNumber: string;
    abhaAddress: string;
    phone: string;
    gender: 'Male' | 'Female';
    age: number;
    address: string;
  }) => {
    setQrSimulating(true);
    setTimeout(() => {
      setVerificationSuccess({
        abhaNumber: sample.abhaNumber,
        abhaAddress: sample.abhaAddress,
        name: sample.name,
        gender: sample.gender,
        dob: `${2026 - sample.age}-01-01`,
        mobile: sample.phone,
      });

      setFormData((prev) => ({
        ...prev,
        name: sample.name,
        phone: sample.phone,
        gender: sample.gender,
        age: sample.age,
        address: sample.address,
      }));

      setQrSimulating(false);
      setShowQrModal(false);
    }, 400);
  };

  // Complete Intake & Check-in
  const handleCompleteIntake = async () => {
    if (!formData.name.trim() || !formData.phone.trim()) {
      setIntakeError('Please fill out patient name and phone number');
      return;
    }

    const doctor = doctors.find((d) => d.id === formData.selectedDoctorId) || doctors[0];
    const generatedUHID = `LUM-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const keptExtra = Object.entries(formData.extra).filter(
      ([key, value]) => !["species", "breed", "ownerName"].includes(key) && String(value || "").trim()
    );
    const speciesVal =
      String(formData.extra.species || "").trim() ||
      (formData.relationshipToHolder === 'Pet' ? 'dog' : '');
    const resolvedRel = speciesVal ? 'Pet' : formData.relationshipToHolder || 'Self';
    const holderName = String(
      formData.primaryContactName ||
        formData.extra.ownerName ||
        (resolvedRel !== 'Self' ? inferHouseholdHolderName(phoneMatches) : '') ||
        ''
    ).trim();
    const ownerName = String(formData.extra.ownerName || (resolvedRel === 'Pet' ? holderName : '')).trim();
    const shouldForceNewMember =
      Boolean(formData.createNewMember) ||
      (phoneMatches.length > 0 &&
        (resolvedRel !== 'Self' ||
          !phoneMatches.some(
            (m) => m.name.trim().toLowerCase() === formData.name.trim().toLowerCase()
          )));
    const newPatient: Patient = {
      id: `pat-${Date.now()}`,
      uhid: generatedUHID,
      name: formData.name,
      age: formData.age,
      dateOfBirth: formData.dateOfBirth,
      species: speciesVal,
      breed: formData.extra.breed || "",
      ownerName,
      relationshipToHolder: resolvedRel,
      primaryContactName: holderName,
      createNewMember: shouldForceNewMember,
      gender: formData.gender,
      phone: formData.phone,
      bloodGroup: formData.bloodGroup,
      allergies: ['None known'],
      chronicConditions: keptExtra.map(([k, v]) => `${k}: ${v}`),
      emergencyContact: holderName || ownerName || formData.emergencyContact || formData.phone,
      address: formData.address || '',
      lastVisit: 'Today',
      abhaNumber: verificationSuccess?.abhaNumber || '',
      abhaAddress: verificationSuccess?.abhaAddress || '',
      kycStatus: verificationSuccess ? 'LINKED_SANDBOX' : 'PENDING',
      hfrId: verificationSuccess ? 'HFR-IN-8829104' : '', // local stub facility id; API labels it pending without NHA creds
    };

    setSavingIntake(true);
    setIntakeError(null);
    try {
      const saved = (await onAddNewPatient(newPatient)) || newPatient;
      await onCheckInPatient(saved, doctor, formData.consultationType);
      onSelectPatient(saved);
      if (openRxAfterSave && canStartConsult && onStartConsult) {
        onStartConsult(saved);
      }

      setVerificationSuccess(null);
      setOtpSentTxnId(null);
      setAadhaarNumber('');
      setFormData({
        name: '',
        phone: '',
        age: workflow?.rxModule === 'Veterinary' ? 3 : workflow?.rxModule === 'Pediatrics' ? 5 : 35,
        dateOfBirth: '',
        gender: 'Male',
        bloodGroup: 'B+',
        address: '',
        emergencyContact: '',
        relationshipToHolder: defaultRelationshipForWorkflow(workflow),
        primaryContactName: '',
        createNewMember: false,
        selectedDoctorId: doctors[0]?.id || '',
        consultationType: workflow?.consultTypeDefault || 'Walk-in Consultation',
        extra: {},
      });
    } catch (err: any) {
      setIntakeError(err?.message || 'Could not save patient. Please try again.');
    } finally {
      setSavingIntake(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 font-manrope">
              {workflow?.receptionLabel || 'OPD Reception & ABHA Intake Desk (sandbox)'}
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
              <BadgeCheck className="w-3.5 h-3.5" /> ABHA (sandbox)
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {firstRunHint
              ? 'Register the first patient for this clinic. Saving writes a durable chart and a Waiting OPD token — both survive refresh.'
              : 'Patient registration with ABHA QR scanning and Aadhaar e-KYC (local stub — not government-registry KYC).'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowQrModal(true)}
            className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all flex items-center gap-2"
          >
            <QrCode className="w-4 h-4" />
            <span>Scan ABHA QR Code (sandbox)</span>
          </button>
        </div>
      </div>

      {/* Aadhaar e-KYC Verification & ABHA Bar */}
      <div className="bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 text-white rounded-xl p-5 border border-purple-500/30 shadow-md">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center text-purple-300">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-purple-200">
                  Aadhaar e-KYC & ABHA (local stub)
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 font-mono">
                  Sandbox v3
                </span>
              </div>
              <p className="text-xs text-purple-200/80 mt-0.5">
                Instant identity validation, 14-digit ABHA issuance, and automated DHIS {formatINR(20)} incentive entitlement.
              </p>
            </div>
          </div>

          {/* Inline OTP Workflow */}
          <div className="flex flex-wrap items-center gap-2">
            {!otpSentTxnId ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={12}
                  value={aadhaarNumber}
                  onChange={(e) => setAadhaarNumber(e.target.value)}
                  placeholder="Enter 12-digit Aadhaar #"
                  className="bg-black/30 border border-white/20 text-white placeholder-purple-300/50 text-xs px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 font-mono w-48"
                />
                <button
                  onClick={handleGenerateOtp}
                  disabled={isGeneratingOtp || aadhaarNumber.length < 12}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isGeneratingOtp ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>Generate OTP</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 animate-fade-in">
                <div className="relative">
                  <input
                    type="text"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="Enter OTP (123456)"
                    className="bg-black/40 border border-emerald-400/50 text-emerald-300 placeholder-emerald-500/50 text-xs px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400 font-mono font-bold w-36"
                  />
                  <span className="absolute -top-2 right-2 px-1 text-[9px] bg-emerald-600 text-white rounded font-mono">
                    Sandbox: 123456
                  </span>
                </div>
                <button
                  onClick={handleVerifyOtp}
                  disabled={isVerifyingOtp}
                  className="px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isVerifyingOtp ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  <span>Verify & Issue ABHA (sandbox)</span>
                </button>
                <button
                  onClick={() => {
                    setOtpSentTxnId(null);
                    setAadhaarNumber('');
                  }}
                  className="text-purple-300 hover:text-white p-2 text-xs"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        {otpError && (
          <div className="mt-3 p-2 bg-rose-500/20 border border-rose-400/40 text-rose-200 text-xs rounded flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{otpError}</span>
          </div>
        )}

        {verificationSuccess && (
          <div className="mt-4 p-3 bg-emerald-500/20 border border-emerald-400/40 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 animate-fade-in text-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <span className="font-bold text-emerald-300">
                  Aadhaar e-KYC linked (sandbox): {verificationSuccess.name}
                </span>
                <span className="block text-emerald-200/80 font-mono text-[11px]">
                  ABHA (sandbox): {verificationSuccess.abhaNumber} • {verificationSuccess.abhaAddress}
                </span>
              </div>
            </div>
            <span className="px-2.5 py-1 bg-emerald-500/30 text-emerald-200 rounded font-semibold text-[11px] border border-emerald-400/30">
              ABHA (sandbox)
            </span>
          </div>
        )}
      </div>

      {/* Main Grid: Registration Form (Left) & Active Intake Queue / Search (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 6 Cols: OPD Intake & Token Dispenser Form */}
        <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-purple-600" />
              <h3 className="font-bold text-sm text-slate-900">
                {patients.length === 0 ? 'Add your first patient' : 'Patient Intake & Token Generation'}
              </h3>
            </div>
            {verificationSuccess && (
              <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                Auto-filled from ABHA KYC (local stub)
              </span>
            )}
          </div>

          <div className="space-y-2 border-b border-slate-100 pb-3" data-testid="reception-registering-for">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Registering For (Shared Mobile Supported)
            </span>
            <div className="flex flex-wrap gap-1.5">
              {REGISTERING_FOR_OPTIONS.map((opt) => {
                const active = formData.relationshipToHolder === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      const holder = inferHouseholdHolderName(phoneMatches);
                      setFormData((prev) => ({
                        ...prev,
                        relationshipToHolder: opt.value,
                        primaryContactName:
                          opt.value === 'Self'
                            ? ''
                            : prev.primaryContactName || prev.extra.ownerName || holder,
                        createNewMember: opt.value !== 'Self' && phoneMatches.length > 0 ? true : prev.createNewMember,
                        extra: {
                          ...prev.extra,
                          ...(opt.value === 'Pet' && !prev.extra.species ? { species: 'dog' } : {}),
                        },
                      }));
                    }}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                      active
                        ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-purple-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-600 font-medium mb-1">
                {formData.relationshipToHolder === 'Pet'
                  ? 'Pet Name *'
                  : formData.relationshipToHolder === 'Child'
                    ? 'Child Full Name *'
                    : 'Patient Full Name *'}
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={
                  formData.relationshipToHolder === 'Pet'
                    ? 'e.g. Bruno / Mochi'
                    : formData.relationshipToHolder === 'Child'
                      ? 'e.g. Reyansh Gupta'
                      : 'e.g. Rajiv Saxena'
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">
                {formData.relationshipToHolder === 'Pet'
                  ? "Pet Parent's Mobile *"
                  : formData.relationshipToHolder === 'Child'
                    ? "Parent's Mobile *"
                    : 'Mobile Number *'}
              </label>
              <input
                type="text"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+91 98234 55667"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {formData.relationshipToHolder !== 'Self' && (
              <div className="sm:col-span-2">
                <label className="block text-slate-600 font-medium mb-1">
                  {formData.relationshipToHolder === 'Pet'
                    ? 'Pet Parent / Owner Full Name *'
                    : formData.relationshipToHolder === 'Child'
                      ? 'Parent / Guardian Full Name *'
                      : 'Primary Account Holder / Caregiver Name *'}
                </label>
                <input
                  type="text"
                  value={formData.primaryContactName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFormData((prev) => ({
                      ...prev,
                      primaryContactName: val,
                      emergencyContact: val,
                      extra:
                        prev.relationshipToHolder === 'Pet' || workflow?.rxModule === 'Veterinary'
                          ? { ...prev.extra, ownerName: val }
                          : prev.extra,
                    }));
                  }}
                  placeholder={
                    formData.relationshipToHolder === 'Pet'
                      ? 'e.g. Rahul Verma'
                      : formData.relationshipToHolder === 'Child'
                        ? 'e.g. Neha Gupta'
                        : 'e.g. Rajiv Saxena'
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            )}

            {formData.relationshipToHolder === 'Pet' && workflow?.rxModule !== 'Veterinary' && (
              <>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Species</label>
                  <select
                    value={formData.extra.species || 'dog'}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        extra: { ...prev.extra, species: e.target.value },
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                  >
                    <option value="dog">Dog</option>
                    <option value="cat">Cat</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Breed</label>
                  <input
                    type="text"
                    value={formData.extra.breed || ''}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        extra: { ...prev.extra, breed: e.target.value },
                      }))
                    }
                    placeholder="Indie, Golden Retriever, Persian..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>
              </>
            )}

            {phoneMatches.length > 0 && (
              <div
                data-testid="shared-mobile-recognition-card"
                className="sm:col-span-2 rounded-xl border border-amber-300 bg-amber-50/70 p-3.5 space-y-2.5"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-amber-950">
                      {phoneMatches.length > 1
                        ? `Shared Mobile Recognized — ${phoneMatches.length} profiles on this number`
                        : 'Existing Profile Found on This Mobile Number'}
                    </p>
                    <p className="text-[11px] text-amber-800">
                      Check in an existing pet, child, or family member directly, or add a separate profile without overwriting existing charts.
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid="register-new-member-on-phone"
                    onClick={() => {
                      const holder = inferHouseholdHolderName(phoneMatches);
                      const peerAddress = phoneMatches.find((p) => p.address)?.address || '';
                      const nextRel =
                        formData.relationshipToHolder === 'Self'
                          ? workflow?.rxModule === 'Veterinary'
                            ? 'Pet'
                            : workflow?.rxModule === 'Pediatrics'
                              ? 'Child'
                              : 'Family Member'
                          : formData.relationshipToHolder;
                      const matchesExistingName = phoneMatches.some(
                        (p) => p.name.trim().toLowerCase() === formData.name.trim().toLowerCase()
                      );
                      setFormData((prev) => ({
                        ...prev,
                        name: matchesExistingName ? '' : prev.name,
                        relationshipToHolder: nextRel,
                        primaryContactName: holder || prev.primaryContactName,
                        emergencyContact: holder || prev.emergencyContact,
                        address: peerAddress || prev.address,
                        createNewMember: true,
                        extra: {
                          ...prev.extra,
                          ...(holder && (nextRel === 'Pet' || workflow?.rxModule === 'Veterinary')
                            ? { ownerName: holder }
                            : {}),
                        },
                      }));
                    }}
                    className={`shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
                      formData.createNewMember
                        ? 'bg-blue-700 text-white border-blue-700'
                        : 'bg-white text-blue-800 border-blue-300 hover:bg-blue-50'
                    }`}
                  >
                    {formData.createNewMember
                      ? '✓ Adding Separate Profile on This Mobile'
                      : '+ Register New Pet / Child / Family / Friend on This Mobile'}
                  </button>
                </div>

                <div className="space-y-1.5">
                  {phoneMatches.map((peer) => {
                    const badge = profileKindBadge(peer);
                    const selectedDoctor =
                      doctors.find((d) => d.id === formData.selectedDoctorId) || doctors[0];
                    return (
                      <div
                        key={peer.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg bg-white border border-amber-200 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-900">
                              {badge.icon} {peer.name}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-medium">
                              {badge.label}
                            </span>
                            <span className="font-mono text-[10px] text-slate-500">{peer.uhid}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={checkingInPeerId === peer.id}
                            onClick={async () => {
                              if (!selectedDoctor) return;
                              setCheckingInPeerId(peer.id);
                              setIntakeError(null);
                              try {
                                await onCheckInPatient(peer, selectedDoctor, formData.consultationType);
                                onSelectPatient(peer);
                              } catch (err: any) {
                                setIntakeError(err?.message || 'Could not check in patient.');
                              } finally {
                                setCheckingInPeerId(null);
                              }
                            }}
                            className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold disabled:opacity-50"
                          >
                            {checkingInPeerId === peer.id ? 'Checking in…' : `Check In ${peer.name}`}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onSelectPatient(peer);
                              if (canStartConsult && onStartConsult) onStartConsult(peer);
                              else setSelectedRecordPatient(peer);
                            }}
                            className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 text-[11px] font-semibold"
                          >
                            Open Chart
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label className="block text-slate-600 font-medium mb-1" htmlFor="intake-dob">Date of birth</label>
              <input
                id="intake-dob"
                type="date"
                value={formData.dateOfBirth}
                onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">Age (Years)</label>
              <input
                type="number"
                value={formData.age}
                onChange={(e) => setFormData({ ...formData, age: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">Gender</label>
              <select
                value={formData.gender}
                onChange={(e) => setFormData({ ...formData, gender: e.target.value as any })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-slate-600 font-medium mb-1">Address / Pincode</label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Residential address"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <div className="sm:col-span-2 pt-2 border-t border-slate-100">
              <label className="block text-slate-600 font-medium mb-1">Assign Doctor & Department *</label>
              <select
                value={formData.selectedDoctorId}
                onChange={(e) => setFormData({ ...formData, selectedDoctorId: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {doctors.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.name} — {doc.specialty} ({formatINR(doc.consultationFee)})
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-slate-600 font-medium mb-1">Consultation Mode</label>
              <select
                value={formData.consultationType}
                onChange={(e) => setFormData({ ...formData, consultationType: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {(workflow?.consultTypes?.length
                  ? workflow.consultTypes
                  : ["Walk-in Consultation", "Scheduled Follow-up", "Emergency Triage"]
                ).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            {(workflow?.intakeFields || []).map((field) => (
              <div key={field.key} className="sm:col-span-2">
                <label className="block text-slate-600 font-medium mb-1">{field.label}</label>
                {field.type === "select" ? (
                  <select
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                    value={formData.extra[field.key] || ""}
                    onChange={(e) => setFormData({ ...formData, extra: { ...formData.extra, [field.key]: e.target.value } })}
                  >
                    <option value="">Select</option>
                    {(field.options || []).map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type === "number" ? "number" : "text"}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                    placeholder={field.placeholder}
                    value={formData.extra[field.key] || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFormData((prev) => ({
                        ...prev,
                        ...(field.key === 'ownerName' ? { primaryContactName: val, emergencyContact: val } : {}),
                        extra: { ...prev.extra, [field.key]: val },
                      }));
                    }}
                  />
                )}
              </div>
            ))}
          </div>

          {intakeError && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{intakeError}</span>
            </div>
          )}

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <div className="text-xs text-slate-500">
              Consultation Fee:{' '}
              <strong className="text-slate-900 font-mono">
                {formatINR(doctors.find((d) => d.id === formData.selectedDoctorId)?.consultationFee || 600)}
              </strong>
            </div>

            <button
              onClick={handleCompleteIntake}
              disabled={savingIntake}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all flex items-center gap-2 disabled:opacity-60"
            >
              {savingIntake ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              <span>{savingIntake ? 'Saving…' : 'Issue OPD Token & Check-In'}</span>
            </button>
          </div>
        </div>

        {/* Right 6 Cols: Patient Directory & Search with ABHA status */}
        <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm text-slate-900">Registered Patients & ABHA Status (sandbox)</h3>
              {/* honesty-allow: names the ABHA address field a receptionist can search, not a live-link badge */}
              <p className="text-xs text-slate-500">Search by ABHA address, UHID, owner/guardian, or phone</p>
            </div>
            <span className="text-xs font-mono text-slate-500">
              {searchResults.length} patients
            </span>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, owner/parent, breed, UHID, @abdm, or 91-XXXX..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          {/* Patient Cards List */}
          <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
            {searchResults.length === 0 && (
              <div className="p-6 text-center border border-dashed border-slate-200 rounded-lg bg-slate-50">
                <UserPlus className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-800">No patients in this clinic yet</p>
                <p className="text-xs text-slate-500 mt-1">
                  Use the intake form to register the first patient. They will appear here after save and after refresh.
                </p>
              </div>
            )}
            {searchResults.map((p) => {
              const isKyc = isAbhaLinked(p);
              const badge = profileKindBadge(p);
              const sharedCount = phoneCounts.get(phoneKey10(p.phone)) || 0;
              return (
                <div
                  key={p.id}
                  className="p-3.5 rounded-lg border border-slate-200 hover:border-purple-300 hover:bg-purple-50/30 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs group"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="font-bold text-slate-900 text-sm">
                        {badge.isPet ? `${badge.icon} ` : ''}{p.name}
                      </strong>
                      <span className="text-slate-500 font-mono text-[11px]">{p.uhid}</span>
                      {(badge.isPet || (p.relationshipToHolder && p.relationshipToHolder !== 'Self')) && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 text-sky-800 border border-sky-200">
                          {badge.icon} {badge.label}
                        </span>
                      )}
                      {sharedCount > 1 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          Shared Mobile ({sharedCount})
                        </span>
                      )}
                      {isKyc ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                          <BadgeCheck className="w-3 h-3" /> ABHA (sandbox)
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          KYC Pending
                        </span>
                      )}
                    </div>

                    <div className="text-slate-500 flex flex-wrap items-center gap-2 text-[11px]">
                      <span>{p.age} Yrs / {p.gender}</span>
                      <span>•</span>
                      <span>{p.phone}</span>
                      {p.abhaAddress && (
                        <>
                          <span>•</span>
                          <span className="font-mono text-purple-700 font-medium">{p.abhaAddress}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedRecordPatient(p)}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                      title="View Patient Record, History & Uploads"
                    >
                      <FileText className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Record & Files</span>
                    </button>
                    {canStartConsult && (
                    <button
                      onClick={() => {
                        onSelectPatient(p);
                        if (onStartConsult) onStartConsult(p);
                        else onSwitchToConsultation();
                      }}
                      className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <span>Start Consult</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ABHA QR Scanner Simulator Modal */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center">
                  <QrCode className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">ABHA QR Scanner (sandbox)</h3>
                  <p className="text-xs text-slate-500">Scan physical card or select simulated sandbox patient</p>
                </div>
              </div>
              <button
                onClick={() => setShowQrModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-xl p-6 text-center space-y-3">
              <Camera className="w-10 h-10 text-purple-600 mx-auto" />
              <div>
                <p className="text-sm font-semibold text-slate-800">Scan ABHA QR Code via Camera (sandbox)</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Point camera at the patient's Ayushman Bharat Health Card QR code
                </p>
              </div>
            </div>

            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block mb-2">
                Or Select Verified Sandbox Card to Simulate Scan:
              </span>
              <div className="space-y-2 text-xs">
                <button
                  disabled={qrSimulating}
                  onClick={() =>
                    handleSampleQrScan({
                      name: 'Rajiv Saxena',
                      abhaNumber: '91-4428-9102-3841',
                      abhaAddress: 'rajiv.saxena@abdm',
                      phone: '+91 98234 55667',
                      gender: 'Male',
                      age: 44,
                      address: 'A-502, Orchid Woods, Whitefield, Bengaluru',
                    })
                  }
                  className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-purple-400 hover:bg-purple-50 transition-all flex items-center justify-between"
                >
                  <div>
                    <div className="font-bold text-slate-900">Rajiv Saxena (44 Yrs / Male)</div>
                    <div className="text-slate-500 font-mono text-[11px]">
                      ABHA (sandbox): 91-4428-9102-3841 • rajiv.saxena@abdm
                    </div>
                  </div>
                  <span className="px-2 py-1 bg-emerald-100 text-emerald-800 font-semibold rounded text-[10px]">
                    Verified
                  </span>
                </button>

                <button
                  disabled={qrSimulating}
                  onClick={() =>
                    handleSampleQrScan({
                      name: 'Priyanka Mukherjee',
                      abhaNumber: '91-7291-0384-9182',
                      abhaAddress: 'priyanka.m@abdm',
                      phone: '+91 98311 44556',
                      gender: 'Female',
                      age: 52,
                      address: '18/2, Gariahat Road, South Kolkata',
                    })
                  }
                  className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-purple-400 hover:bg-purple-50 transition-all flex items-center justify-between"
                >
                  <div>
                    <div className="font-bold text-slate-900">Priyanka Mukherjee (52 Yrs / Female)</div>
                    <div className="text-slate-500 font-mono text-[11px]">
                      ABHA (sandbox): 91-7291-0384-9182 • priyanka.m@abdm
                    </div>
                  </div>
                  <span className="px-2 py-1 bg-emerald-100 text-emerald-800 font-semibold rounded text-[10px]">
                    Verified
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Patient Record, History & Uploads Modal */}
      <PatientRecordModal
        patient={selectedRecordPatient}
        isOpen={Boolean(selectedRecordPatient)}
        onClose={() => setSelectedRecordPatient(null)}
      />
    </div>
  );
};

import React, { useState, useEffect } from 'react';
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
  X
} from 'lucide-react';
import { Patient, Doctor, Appointment, PolyclinicSpecialty } from '../types';

interface ReceptionProps {
  patients: Patient[];
  doctors: Doctor[];
  appointments: Appointment[];
  onSelectPatient: (patient: Patient) => void;
  onAddNewPatient: (patient: Patient) => void;
  onCheckInPatient: (patient: Patient, doctor: Doctor, type: string) => void;
  onSwitchToConsultation: () => void;
}

export const Reception: React.FC<ReceptionProps> = ({
  patients,
  doctors,
  appointments,
  onSelectPatient,
  onAddNewPatient,
  onCheckInPatient,
  onSwitchToConsultation
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
    age: 35,
    gender: 'Male' as 'Male' | 'Female' | 'Other',
    bloodGroup: 'B+',
    address: '',
    emergencyContact: '',
    selectedDoctorId: doctors[0]?.id || '',
    consultationType: 'Walk-in Consultation',
  });

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
        p.uhid.toLowerCase().includes(q) ||
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
      const res = await fetch('/api/abdm/v3/registration/aadhaar/generateOtp', {
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
      const res = await fetch('/api/abdm/v3/registration/aadhaar/verifyOTP', {
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
  const handleCompleteIntake = () => {
    if (!formData.name.trim() || !formData.phone.trim()) {
      alert('Please fill out patient name and phone number');
      return;
    }

    const doctor = doctors.find((d) => d.id === formData.selectedDoctorId) || doctors[0];
    const generatedUHID = `LUM-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    const newPatient: Patient = {
      id: `pat-${Date.now()}`,
      uhid: generatedUHID,
      name: formData.name,
      age: formData.age,
      gender: formData.gender,
      phone: formData.phone,
      bloodGroup: formData.bloodGroup,
      allergies: ['None known'],
      chronicConditions: [],
      emergencyContact: formData.phone,
      address: formData.address || 'Bengaluru, India',
      lastVisit: 'Today',
      abhaNumber: verificationSuccess?.abhaNumber || '91-4428-9102-3841',
      abhaAddress: verificationSuccess?.abhaAddress || `${formData.name.toLowerCase().replace(/[^a-z]/g, '.')}@abdm`,
      kycStatus: 'VERIFIED',
      hfrId: 'HFR-IN-8829104',
    };

    onAddNewPatient(newPatient);
    onCheckInPatient(newPatient, doctor, formData.consultationType);
    onSelectPatient(newPatient);

    // Reset forms
    setVerificationSuccess(null);
    setOtpSentTxnId(null);
    setAadhaarNumber('');
    setFormData({
      name: '',
      phone: '',
      age: 35,
      gender: 'Male',
      bloodGroup: 'B+',
      address: '',
      emergencyContact: '',
      selectedDoctorId: doctors[0]?.id || '',
      consultationType: 'Walk-in Consultation',
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 font-manrope">
              OPD Reception & ABHA Intake Desk
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
              <BadgeCheck className="w-3.5 h-3.5" /> ABDM Fast-Track
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Seamless patient registration with Government ABHA QR scanning, instant Aadhaar e-KYC verification, and token generation.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowQrModal(true)}
            className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all flex items-center gap-2"
          >
            <QrCode className="w-4 h-4" />
            <span>Scan ABHA QR Code</span>
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
                  Government Aadhaar e-KYC & ABHA Registry
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 font-mono">
                  Sandbox v3
                </span>
              </div>
              <p className="text-xs text-purple-200/80 mt-0.5">
                Instant identity validation, 14-digit ABHA issuance, and automated DHIS ₹20 incentive entitlement.
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
                  <span>Verify & Issue ABHA</span>
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
                  Aadhaar e-KYC Verified: {verificationSuccess.name}
                </span>
                <span className="block text-emerald-200/80 font-mono text-[11px]">
                  ABHA: {verificationSuccess.abhaNumber} • {verificationSuccess.abhaAddress}
                </span>
              </div>
            </div>
            <span className="px-2.5 py-1 bg-emerald-500/30 text-emerald-200 rounded font-semibold text-[11px] border border-emerald-400/30">
              KYC-Verified ABHA Active
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
              <h3 className="font-bold text-sm text-slate-900">Patient Intake & Token Generation</h3>
            </div>
            {verificationSuccess && (
              <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                Auto-filled from Government KYC
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-600 font-medium mb-1">Patient Full Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Rajiv Saxena"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">Mobile Number *</label>
              <input
                type="text"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+91 98234 55667"
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
                    {doc.name} — {doc.specialty} (₹{doc.consultationFee})
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
                <option value="Walk-in Consultation">Walk-in Consultation</option>
                <option value="Scheduled Follow-up">Scheduled Follow-up</option>
                <option value="Emergency Triage">Emergency Triage</option>
              </select>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <div className="text-xs text-slate-500">
              Consultation Fee:{' '}
              <strong className="text-slate-900 font-mono">
                ₹{doctors.find((d) => d.id === formData.selectedDoctorId)?.consultationFee || 600}
              </strong>
            </div>

            <button
              onClick={handleCompleteIntake}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all flex items-center gap-2"
            >
              <CreditCard className="w-4 h-4" />
              <span>Issue OPD Token & Check-In</span>
            </button>
          </div>
        </div>

        {/* Right 6 Cols: Patient Directory & Search with ABHA status */}
        <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm text-slate-900">Registered Patients & ABHA Status</h3>
              <p className="text-xs text-slate-500">Search by ABHA address, UHID, or phone</p>
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
              placeholder="Search by name, UHID, @abdm, or 91-XXXX..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          {/* Patient Cards List */}
          <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
            {searchResults.map((p) => {
              const isKyc = p.kycStatus === 'VERIFIED' || Boolean(p.abhaNumber);
              return (
                <div
                  key={p.id}
                  className="p-3.5 rounded-lg border border-slate-200 hover:border-purple-300 hover:bg-purple-50/30 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs group"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <strong className="font-bold text-slate-900 text-sm">{p.name}</strong>
                      <span className="text-slate-500 font-mono text-[11px]">{p.uhid}</span>
                      {isKyc ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                          <BadgeCheck className="w-3 h-3" /> KYC-Verified ABHA
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          KYC Pending
                        </span>
                      )}
                    </div>

                    <div className="text-slate-500 flex items-center gap-3 text-[11px]">
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
                      onClick={() => {
                        onSelectPatient(p);
                        onSwitchToConsultation();
                      }}
                      className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1"
                    >
                      <span>Start Consult</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
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
                  <h3 className="font-bold text-base text-slate-900">ABDM Government QR Scanner</h3>
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
                <p className="text-sm font-semibold text-slate-800">Scan ABHA QR Code via Camera</p>
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
                      ABHA: 91-4428-9102-3841 • rajiv.saxena@abdm
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
                      ABHA: 91-7291-0384-9182 • priyanka.m@abdm
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
    </div>
  );
};

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
import { Patient, Doctor, Appointment, isAbhaLinked } from '../types';
import type { SpecialtyWorkflowPack } from '../lib/specialtyWorkflow';

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
  workflow?: SpecialtyWorkflowPack;
}

export const Reception: React.FC<ReceptionProps> = ({
  patients,
  doctors,
  appointments,
  onSelectPatient,
  onAddNewPatient,
  onCheckInPatient,
  onSwitchToConsultation,
  onStartConsult,
  firstRunHint = false,
  openRxAfterSave = false,
  workflow,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Patient[]>(patients);
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
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrSimulating, setQrSimulating] = useState(false);
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
    extra: {} as Record<string, string>,
  });
  const [savingIntake, setSavingIntake] = useState(false);
  const [intakeError, setIntakeError] = useState<string | null>(null);
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
      setOtpCode(data.testOtp || '');
    } catch (err: any) {
      setOtpError(err.message || 'Error generating Aadhaar OTP');
    } finally {
      setIsGeneratingOtp(false);
    }
  };
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
  const handleCompleteIntake = async () => {
    if (!formData.name.trim() || !formData.phone.trim()) {
      setIntakeError('Please fill out patient name and phone number');
      return;
    }
    const doctor = doctors.find((d) => d.id === formData.selectedDoctorId) || doctors[0];
    const generatedUHID = `LUM-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const newPatient: Patient = {
      id: `pat-${Date.now()}`,
      uhid: generatedUHID,
      name: formData.name,
      age: formData.age,
      gender: formData.gender,
      phone: formData.phone,
      bloodGroup: formData.bloodGroup,
      allergies: ['None known'],
      chronicConditions: Object.entries(formData.extra)
        .filter(([, v]) => String(v || "").trim())
        .map(([k, v]) => `${k}: ${v}`),
      emergencyContact: formData.emergencyContact || formData.phone,
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
      if (openRxAfterSave && onStartConsult) {
        onStartConsult(saved);
      }
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
    <div className="space-y-6">PLACEHOLDER_RECEPTION_TAIL</div>
  );
};

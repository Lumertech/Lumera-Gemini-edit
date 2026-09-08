import React, { useState } from 'react';
import { 
  Users, 
  Volume2, 
  Clock, 
  Activity, 
  Plus, 
  CheckCircle, 
  CheckCircle2,
  ArrowRight, 
  HeartPulse, 
  FileText, 
  Receipt, 
  Stethoscope, 
  Search,
  X,
  ShieldCheck,
  User,
  Phone,
  Mail,
  MapPin,
  Copy,
  Check,
  ExternalLink,
  ChevronRight,
  Info,
  SlidersHorizontal,
  LayoutList,
  LayoutGrid,
  Sparkles,
  AlertCircle
} from 'lucide-react';
import { Appointment, Vitals, Patient, Doctor } from '../types';

interface QueueBoardProps {
  appointments: Appointment[];
  doctors: Doctor[];
  patients: Patient[];
  onUpdateStatus: (appointmentId: string, status: Appointment['status']) => void;
  onUpdateVitals: (appointmentId: string, vitals: Vitals) => void;
  onStartConsultation: (appointment: Appointment) => void;
  onOpenBill: (appointment: Appointment) => void;
  onAddNewToken: (newToken: Partial<Appointment>) => void;
}

export const QueueBoard: React.FC<QueueBoardProps> = ({
  appointments,
  doctors,
  patients,
  onUpdateStatus,
  onUpdateVitals,
  onStartConsultation,
  onOpenBill,
  onAddNewToken,
}) => {
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [callingToken, setCallingToken] = useState<Appointment | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [drawerData, setDrawerData] = useState<{ appointment: Appointment; patient: Patient } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  
  // Vitals modal state
  const [vitalsModalAppointment, setVitalsModalAppointment] = useState<Appointment | null>(null);
  const [bpSys, setBpSys] = useState<number>(120);
  const [bpDia, setBpDia] = useState<number>(80);
  const [heartRate, setHeartRate] = useState<number>(76);
  const [temp, setTemp] = useState<number>(98.6);
  const [spO2, setSpO2] = useState<number>(99);
  const [weight, setWeight] = useState<number>(68);
  const [height, setHeight] = useState<number>(165);
  const [bloodSugar, setBloodSugar] = useState<number>(110);

  // New Token Modal state
  const [showNewTokenModal, setShowNewTokenModal] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState(patients[0]?.id || '');
  const [selectedDoctorId, setSelectedDoctorId] = useState(doctors[0]?.id || '');
  const [consultType, setConsultType] = useState<Appointment['type']>('New Consultation');

  // Helper to resolve detailed patient profile from appointment
  const getPatientForAppointment = (apt: Appointment): Patient => {
    const found = patients.find(
      (p) => p.id === apt.patientId || p.uhid === apt.uhid || p.name.toLowerCase() === apt.patientName.toLowerCase()
    );
    if (found) return found;

    // Deterministic fallback with realistic ABDM profile
    return {
      id: apt.patientId || `p-${apt.id}`,
      name: apt.patientName,
      uhid: apt.uhid || `LUM-2026-0${100 + apt.tokenNumber}`,
      age: apt.age || 44,
      gender: (apt.gender as any) || 'Male',
      phone: apt.patientPhone || '+91 98234 55667',
      email: `${apt.patientName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@gmail.com`,
      bloodGroup: 'B+',
      abhaAddress: apt.abhaAddress || `${apt.patientName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@abdm`,
      abhaNumber: apt.abhaNumber || `91-4428-9102-${1000 + apt.tokenNumber}`,
      kycStatus: 'VERIFIED',
      allergies: ['No known drug allergies (NKDA)'],
      chronicConditions: ['Hypertension (Stage 1)'],
      emergencyContact: '+91 98112 33445',
      address: '74, Indiranagar 100 Feet Rd, Bengaluru, KA',
      vitals: apt.vitals,
    };
  };

  const filteredAppointments = appointments.filter((apt) => {
    if (filterStatus !== 'All' && apt.status !== filterStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = apt.patientName.toLowerCase().includes(q);
      const matchToken = apt.tokenNumber.toString().includes(q);
      const matchUhid = apt.uhid?.toLowerCase().includes(q);
      const matchDoctor = apt.doctorName?.toLowerCase().includes(q);
      const matchAbha = apt.abhaAddress?.toLowerCase().includes(q);
      return matchName || matchToken || matchUhid || matchDoctor || matchAbha;
    }
    return true;
  });

  const handleCallToken = (apt: Appointment) => {
    setCallingToken(apt);
    onUpdateStatus(apt.id, 'In Consultation');
    
    // Play subtle audio alert chime
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
      // Audio autoplay policy fallback
    }
  };

  const handleCallAndStartConsultation = (apt: Appointment) => {
    handleCallToken(apt);
    onStartConsultation(apt);
  };

  const handleOpenVitalsModal = (apt: Appointment) => {
    setVitalsModalAppointment(apt);
    if (apt.vitals) {
      setBpSys(apt.vitals.bloodPressureSystolic || 120);
      setBpDia(apt.vitals.bloodPressureDiastolic || 80);
      setHeartRate(apt.vitals.heartRate || 76);
      setTemp(apt.vitals.temperature || 98.6);
      setSpO2(apt.vitals.spO2 || 99);
      setWeight(apt.vitals.weightKg || 68);
      setHeight(apt.vitals.heightCm || 165);
      setBloodSugar(apt.vitals.bloodSugarRandom || 110);
    } else {
      setBpSys(120);
      setBpDia(80);
      setHeartRate(76);
      setTemp(98.6);
      setSpO2(99);
      setWeight(68);
      setHeight(165);
      setBloodSugar(110);
    }
  };

  const handleSaveVitals = () => {
    if (!vitalsModalAppointment) return;
    const bmiCalc = height > 0 ? parseFloat((weight / ((height / 100) * (height / 100))).toFixed(1)) : undefined;

    const newV: Vitals = {
      bloodPressureSystolic: bpSys,
      bloodPressureDiastolic: bpDia,
      heartRate: heartRate,
      temperature: temp,
      spO2: spO2,
      weightKg: weight,
      heightCm: height,
      bmi: bmiCalc,
      bloodSugarRandom: bloodSugar,
      recordedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      recordedBy: 'OPD Nurse',
    };

    onUpdateVitals(vitalsModalAppointment.id, newV);
    onUpdateStatus(vitalsModalAppointment.id, 'Waiting');
    setVitalsModalAppointment(null);
  };

  const handleCreateToken = () => {
    const pat = patients.find((p) => p.id === selectedPatientId) || patients[0];
    const doc = doctors.find((d) => d.id === selectedDoctorId) || doctors[0];
    const maxToken = appointments.reduce((max, a) => Math.max(max, a.tokenNumber), 0);

    const newApt: Partial<Appointment> = {
      id: 'apt-' + Date.now(),
      tokenNumber: maxToken + 1,
      patientId: pat.id,
      patientName: pat.name,
      patientPhone: pat.phone,
      uhid: pat.uhid,
      doctorId: doc.id,
      doctorName: doc.name,
      specialty: doc.specialty,
      date: new Date().toISOString().split('T')[0],
      timeSlot: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: consultType,
      status: 'Triage / Vitals',
      source: 'Walk-in',
      consultationFee: doc.consultationFee,
      isPaid: false,
    };

    onAddNewToken(newApt);
    setShowNewTokenModal(false);
  };

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Top Banner & Live Calling Display */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
              Live OPD Queue
            </span>
            <span className="text-xs text-slate-500 font-medium">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          </div>
          <h1 className="text-lg font-bold tracking-tight text-slate-900 mt-1">
            Patient Flow & Live Token Board
          </h1>
        </div>

        {/* Current Calling Token Display */}
        {callingToken ? (
          <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg flex items-center space-x-3.5">
            <div className="w-10 h-10 rounded-md bg-blue-600 text-white flex flex-col items-center justify-center font-black">
              <span className="text-[9px] uppercase tracking-wider text-blue-100">Token</span>
              <span className="text-base leading-none">#{callingToken.tokenNumber}</span>
            </div>
            <div>
              <span className="text-[10px] text-blue-700 uppercase font-bold flex items-center gap-1">
                <Volume2 className="w-3 h-3 text-blue-600" /> In Consultation:
              </span>
              <strong className="text-xs text-slate-900 block">{callingToken.patientName}</strong>
              <span className="text-[11px] text-slate-500">
                {callingToken.doctorName} • {callingToken.specialty}
              </span>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowNewTokenModal(true)}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm shadow-blue-100 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Issue New OPD Token</span>
          </button>
        )}
      </div>

      {/* Toolbar: Search, View Mode Toggle, Filter Tabs & New Token */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Search Bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by token #, patient name, ABHA, or doctor..."
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-600 focus:bg-white transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* View Toggle & New Token Action */}
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <div className="flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold transition-all ${
                  viewMode === 'list'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Compact List View (High volume scannable)"
              >
                <LayoutList className="w-3.5 h-3.5" />
                <span className="text-[11px]">List</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold transition-all ${
                  viewMode === 'grid'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Card Grid View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span className="text-[11px]">Cards</span>
              </button>
            </div>

            <button
              onClick={() => setShowNewTokenModal(true)}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm shadow-blue-200 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Issue Token</span>
            </button>
          </div>
        </div>

        {/* Filter Status Pills */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 overflow-x-auto text-xs">
          <div className="flex space-x-1">
            {['All', 'Waiting', 'Triage / Vitals', 'In Consultation', 'Completed'].map((st) => {
              const count = appointments.filter((a) => (st === 'All' ? true : a.status === st)).length;
              return (
                <button
                  key={st}
                  onClick={() => setFilterStatus(st)}
                  className={`px-3 py-1 rounded-md font-medium whitespace-nowrap transition-all text-xs ${
                    filterStatus === st
                      ? 'bg-blue-600 text-white shadow-xs font-semibold'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {st} <span className="opacity-80 font-mono text-[11px]">({count})</span>
                </button>
              );
            })}
          </div>

          <div className="text-[11px] text-slate-400 shrink-0 font-medium ml-2">
            Showing {filteredAppointments.length} tokens
          </div>
        </div>
      </div>

      {/* QUEUE DISPLAY: SCANNABLE LIST VIEW (DEFAULT) */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="divide-y divide-slate-100">
            {filteredAppointments.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No patient tokens found matching the current filter.
              </div>
            ) : (
              filteredAppointments.map((apt) => {
                const patient = getPatientForAppointment(apt);
                const isKyc = patient.kycStatus === 'VERIFIED' || Boolean(patient.abhaNumber);
                const isInConsult = apt.status === 'In Consultation';

                return (
                  <div
                    key={apt.id}
                    className={`p-3 sm:px-4 sm:py-2.5 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs hover:bg-slate-50/80 ${
                      isInConsult ? 'bg-blue-50/40 border-l-4 border-l-blue-600' : ''
                    }`}
                  >
                    {/* Left: Token Pill + Demographics + Inline ABHA Check */}
                    <div className="flex items-center space-x-3 min-w-0">
                      {/* Compact Token Pill */}
                      <div
                        className={`w-9 h-9 rounded-lg font-black flex flex-col items-center justify-center shrink-0 shadow-xs ${
                          isInConsult
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-900 text-white'
                        }`}
                      >
                        <span className="text-[8px] uppercase tracking-wider text-slate-300 font-normal">TKN</span>
                        <span className="text-xs leading-none font-bold">#{apt.tokenNumber}</span>
                      </div>

                      {/* Primary Patient Identifiers */}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            onClick={() => setDrawerData({ appointment: apt, patient })}
                            className="font-bold text-slate-900 text-sm hover:text-blue-600 text-left transition-colors truncate"
                          >
                            {apt.patientName}
                          </button>
                          
                          <span className="text-xs text-slate-500 font-medium">
                            • {patient.age}Y/{patient.gender ? patient.gender.charAt(0).toUpperCase() : 'M'}
                          </span>

                          {/* INLINE COMPACT VERIFIED ABHA INDICATOR */}
                          {isKyc && (
                            <span
                              title={`Government Verified ABHA: ${patient.abhaAddress || 'rajiv.saxena@abdm'}`}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0 cursor-help"
                            >
                              <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                              <span>ABHA</span>
                            </span>
                          )}
                        </div>

                        {/* Secondary metadata: Clinician & Slot & Vitals micro-chip */}
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                          <span>
                            {apt.doctorName} • <span className="text-blue-700 font-medium">{apt.specialty}</span> • {apt.timeSlot}
                          </span>

                          {apt.vitals && (
                            <>
                              <span className="text-slate-300">|</span>
                              <span className="text-slate-700 font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1">
                                <HeartPulse className="w-3 h-3 text-blue-600" />
                                <span>BP: {apt.vitals.bloodPressureSystolic}/{apt.vitals.bloodPressureDiastolic}</span>
                                <span>• HR: {apt.vitals.heartRate}</span>
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: Status Pill & Action Buttons */}
                    <div className="flex items-center justify-between md:justify-end gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                      {/* Status Pill */}
                      <span
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${
                          apt.status === 'In Consultation'
                            ? 'bg-blue-100 text-blue-800 font-bold animate-pulse'
                            : apt.status === 'Waiting'
                            ? 'bg-amber-100 text-amber-800'
                            : apt.status === 'Triage / Vitals'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {apt.status}
                      </span>

                      {/* Open Patient Profile Drawer */}
                      <button
                        onClick={() => setDrawerData({ appointment: apt, patient })}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 font-medium text-xs flex items-center gap-1 transition-colors cursor-pointer"
                        title="Open detailed patient profile drawer (ABHA, UHID, Contact, Vitals)"
                      >
                        <Info className="w-3.5 h-3.5 text-slate-500" />
                        <span className="hidden sm:inline">Profile</span>
                      </button>

                      {/* Vitals Quick Action */}
                      <button
                        onClick={() => handleOpenVitalsModal(apt)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 font-medium text-xs flex items-center gap-1 transition-colors cursor-pointer"
                        title="Record or update patient vitals"
                      >
                        <Activity className="w-3.5 h-3.5 text-blue-600" />
                        <span className="hidden sm:inline">Vitals</span>
                      </button>

                      {/* Billing Action */}
                      <button
                        onClick={() => onOpenBill(apt)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 font-medium text-xs flex items-center gap-1 transition-colors cursor-pointer"
                        title="View consultation bill & receipt"
                      >
                        <Receipt className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="hidden sm:inline">Bill</span>
                      </button>

                      {/* Primary Call & Start Consultation Button */}
                      <button
                        onClick={() => handleCallAndStartConsultation(apt)}
                        className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm shadow-blue-200 transition-all cursor-pointer whitespace-nowrap"
                        title="Call patient and launch Smart Rx Studio directly"
                      >
                        <Stethoscope className="w-3.5 h-3.5" />
                        <span>Start Consult</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* QUEUE DISPLAY: COMPACT CARDS GRID (ALTERNATIVE VIEW) */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredAppointments.map((apt) => {
            const patient = getPatientForAppointment(apt);
            const isKyc = patient.kycStatus === 'VERIFIED' || Boolean(patient.abhaNumber);
            const isInConsult = apt.status === 'In Consultation';

            return (
              <div
                key={apt.id}
                className={`bg-white rounded-xl border p-3.5 space-y-2.5 shadow-xs hover:shadow-sm transition-all ${
                  isInConsult
                    ? 'border-blue-400 ring-2 ring-blue-50 bg-blue-50/20'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Header: Token # & Demographics with inline ABHA check */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-slate-900 text-white font-bold flex flex-col items-center justify-center shrink-0">
                      <span className="text-[7px] uppercase tracking-wider text-slate-400 font-normal">TKN</span>
                      <span className="text-xs leading-none font-bold">#{apt.tokenNumber}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setDrawerData({ appointment: apt, patient })}
                          className="font-bold text-slate-900 text-xs hover:text-blue-600 text-left transition-colors truncate"
                        >
                          {apt.patientName}
                        </button>
                        {isKyc && (
                          <span title="ABHA Verified" className="text-emerald-600 shrink-0">
                            <CheckCircle2 className="w-3 h-3 fill-emerald-100" />
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-500 block">
                        {patient.age}Y/{patient.gender ? patient.gender.charAt(0).toUpperCase() : 'M'} • {apt.timeSlot}
                      </span>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                      apt.status === 'In Consultation'
                        ? 'bg-blue-100 text-blue-800 font-bold animate-pulse'
                        : apt.status === 'Waiting'
                        ? 'bg-amber-100 text-amber-800'
                        : apt.status === 'Triage / Vitals'
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {apt.status}
                  </span>
                </div>

                {/* Micro info bar */}
                <div className="flex items-center justify-between text-[11px] text-slate-500 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-100">
                  <span className="truncate">{apt.doctorName} • {apt.specialty}</span>
                  <button
                    onClick={() => setDrawerData({ appointment: apt, patient })}
                    className="text-blue-600 font-semibold hover:underline shrink-0 ml-1 text-[10px]"
                  >
                    View ABHA
                  </button>
                </div>

                {/* Primary Action Button */}
                <div className="flex items-center gap-1.5 pt-1">
                  <button
                    onClick={() => handleCallAndStartConsultation(apt)}
                    className="flex-1 py-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-1 shadow-xs transition-all cursor-pointer"
                  >
                    <Stethoscope className="w-3.5 h-3.5" />
                    <span>Start Consult</span>
                  </button>

                  <button
                    onClick={() => handleOpenVitalsModal(apt)}
                    className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors"
                    title="Record Vitals"
                  >
                    <Activity className="w-3.5 h-3.5 text-blue-600" />
                  </button>

                  <button
                    onClick={() => onOpenBill(apt)}
                    className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors"
                    title="Billing"
                  >
                    <Receipt className="w-3.5 h-3.5 text-emerald-600" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 2. SLIDE-OUT PATIENT PROFILE DRAWER */}
      {drawerData && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          {/* Backdrop */}
          <div
            onClick={() => setDrawerData(null)}
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
          />

          {/* Slide-out Drawer Panel */}
          <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-md bg-white shadow-2xl flex flex-col border-l border-slate-200">
              {/* Drawer Header */}
              <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-600 text-white font-black flex flex-col items-center justify-center">
                    <span className="text-[8px] uppercase tracking-wider text-blue-200">TKN</span>
                    <span className="text-xs leading-none">#{drawerData.appointment.tokenNumber}</span>
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                      {drawerData.patient.name}
                      {drawerData.patient.kycStatus === 'VERIFIED' && (
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      )}
                    </h2>
                    <p className="text-[11px] text-slate-400">
                      {drawerData.patient.age} Yrs • {drawerData.patient.gender} • Blood Group: {drawerData.patient.bloodGroup || 'B+'}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setDrawerData(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Drawer Body (Scrollable) */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
                {/* ABDM & ABHA National Health ID Strip */}
                <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-emerald-800 font-bold text-xs">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span>Ayushman Bharat Health Account (ABDM)</span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white">
                      KYC Verified
                    </span>
                  </div>

                  {/* ABHA Address */}
                  <div className="bg-white p-2.5 rounded-lg border border-emerald-200 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                        ABHA Address
                      </span>
                      <strong className="text-slate-900 font-mono text-xs">
                        {drawerData.patient.abhaAddress || `${drawerData.patient.name.toLowerCase().replace(/\s+/g, '.')}@abdm`}
                      </strong>
                    </div>
                    <button
                      onClick={() =>
                        copyToClipboard(
                          drawerData.patient.abhaAddress || `${drawerData.patient.name.toLowerCase().replace(/\s+/g, '.')}@abdm`,
                          'abha'
                        )
                      }
                      className="p-1 text-slate-400 hover:text-emerald-700 transition-colors"
                      title="Copy ABHA Address"
                    >
                      {copiedField === 'abha' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {/* 14-Digit ABHA Number */}
                  <div className="bg-white p-2.5 rounded-lg border border-emerald-200 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                        ABHA Number (14-Digit National ID)
                      </span>
                      <strong className="text-slate-900 font-mono text-xs">
                        {drawerData.patient.abhaNumber || '91-4428-9102-3841'}
                      </strong>
                    </div>
                    <button
                      onClick={() =>
                        copyToClipboard(drawerData.patient.abhaNumber || '91-4428-9102-3841', 'abhaNum')
                      }
                      className="p-1 text-slate-400 hover:text-emerald-700 transition-colors"
                      title="Copy ABHA Number"
                    >
                      {copiedField === 'abhaNum' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* System Identifiers & Contact */}
                <div className="space-y-2">
                  <h3 className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                    Registration &amp; Contact Details
                  </h3>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">Clinic UHID:</span>
                      <span className="font-mono font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                        {drawerData.patient.uhid || drawerData.appointment.uhid}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">Contact Phone:</span>
                      <span className="font-semibold text-slate-800 flex items-center gap-1">
                        <Phone className="w-3 h-3 text-blue-600" />
                        {drawerData.patient.phone}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">Email:</span>
                      <span className="text-slate-700 flex items-center gap-1 font-mono">
                        <Mail className="w-3 h-3 text-slate-400" />
                        {drawerData.patient.email || `${drawerData.patient.name.toLowerCase().replace(/\s+/g, '.')}@gmail.com`}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">Emergency Contact:</span>
                      <span className="text-slate-700 font-medium">
                        {drawerData.patient.emergencyContact || '+91 98112 33445'}
                      </span>
                    </div>

                    <div className="pt-1 border-t border-slate-200/80 flex items-start gap-1 text-[11px] text-slate-500">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span>{drawerData.patient.address || 'Indiranagar, Bengaluru, Karnataka, India'}</span>
                    </div>
                  </div>
                </div>

                {/* Vitals Breakdown */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-800 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      <HeartPulse className="w-3.5 h-3.5 text-blue-600" />
                      <span>Active Triage Vitals</span>
                    </h3>
                    <button
                      onClick={() => handleOpenVitalsModal(drawerData.appointment)}
                      className="text-blue-600 font-bold hover:underline text-[11px]"
                    >
                      Update Vitals
                    </button>
                  </div>

                  {drawerData.appointment.vitals ? (
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-slate-50 p-2 rounded-lg border border-slate-200 text-center">
                        <span className="text-[10px] text-slate-400 uppercase font-bold block">BP</span>
                        <strong className="text-xs text-slate-900 font-mono">
                          {drawerData.appointment.vitals.bloodPressureSystolic}/{drawerData.appointment.vitals.bloodPressureDiastolic}
                        </strong>
                        <span className="text-[9px] text-slate-400 block">mmHg</span>
                      </div>

                      <div className="bg-slate-50 p-2 rounded-lg border border-slate-200 text-center">
                        <span className="text-[10px] text-slate-400 uppercase font-bold block">Heart Rate</span>
                        <strong className="text-xs text-slate-900 font-mono">
                          {drawerData.appointment.vitals.heartRate}
                        </strong>
                        <span className="text-[9px] text-slate-400 block">bpm</span>
                      </div>

                      <div className="bg-slate-50 p-2 rounded-lg border border-slate-200 text-center">
                        <span className="text-[10px] text-slate-400 uppercase font-bold block">SpO2</span>
                        <strong className="text-xs text-slate-900 font-mono">
                          {drawerData.appointment.vitals.spO2}%
                        </strong>
                        <span className="text-[9px] text-slate-400 block">Room Air</span>
                      </div>

                      <div className="bg-slate-50 p-2 rounded-lg border border-slate-200 text-center">
                        <span className="text-[10px] text-slate-400 uppercase font-bold block">Temp</span>
                        <strong className="text-xs text-slate-900 font-mono">
                          {drawerData.appointment.vitals.temperature || 98.6}°F
                        </strong>
                        <span className="text-[9px] text-slate-400 block">Oral</span>
                      </div>

                      <div className="bg-slate-50 p-2 rounded-lg border border-slate-200 text-center">
                        <span className="text-[10px] text-slate-400 uppercase font-bold block">Weight</span>
                        <strong className="text-xs text-slate-900 font-mono">
                          {drawerData.appointment.vitals.weightKg || 68} kg
                        </strong>
                        <span className="text-[9px] text-slate-400 block">BMI: {drawerData.appointment.vitals.bmi || 24.2}</span>
                      </div>

                      <div className="bg-slate-50 p-2 rounded-lg border border-slate-200 text-center">
                        <span className="text-[10px] text-slate-400 uppercase font-bold block">Blood Sugar</span>
                        <strong className="text-xs text-slate-900 font-mono">
                          {drawerData.appointment.vitals.bloodSugarRandom || 110}
                        </strong>
                        <span className="text-[9px] text-slate-400 block">mg/dL (RBS)</span>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-center">
                      <p className="text-slate-500 text-xs mb-2">No triage vitals recorded for this visit yet.</p>
                      <button
                        onClick={() => handleOpenVitalsModal(drawerData.appointment)}
                        className="px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-md font-semibold text-xs hover:bg-blue-100"
                      >
                        Record Vitals Now
                      </button>
                    </div>
                  )}
                </div>

                {/* Clinical Context & Allergies */}
                <div className="space-y-2">
                  <h3 className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                    Clinical Alerts &amp; History
                  </h3>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Known Allergies:</span>
                      <p className="font-medium text-slate-800 mt-0.5">
                        {drawerData.patient.allergies?.join(', ') || 'No known drug allergies (NKDA)'}
                      </p>
                    </div>
                    <div className="pt-2 border-t border-slate-200/80">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Chronic Conditions:</span>
                      <p className="font-medium text-slate-800 mt-0.5">
                        {drawerData.patient.chronicConditions?.join(', ') || 'None reported'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Consultation Details */}
                <div className="bg-blue-50/60 border border-blue-200/80 rounded-xl p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-medium">Assigned Clinician:</span>
                    <strong className="text-slate-900">{drawerData.appointment.doctorName}</strong>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-medium">Department / Slot:</span>
                    <span className="text-blue-700 font-semibold">{drawerData.appointment.specialty} • {drawerData.appointment.timeSlot}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-medium">Booking Source:</span>
                    <span className="text-slate-700 font-medium">{drawerData.appointment.source}</span>
                  </div>
                </div>
              </div>

              {/* Drawer Footer Actions */}
              <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-2 shrink-0">
                <button
                  onClick={() => {
                    const apt = drawerData.appointment;
                    setDrawerData(null);
                    handleCallAndStartConsultation(apt);
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm shadow-blue-200 transition-all cursor-pointer"
                >
                  <Stethoscope className="w-4 h-4" />
                  <span>Start Consultation in Smart Rx Studio</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      const apt = drawerData.appointment;
                      setDrawerData(null);
                      onOpenBill(apt);
                    }}
                    className="py-2 px-3 rounded-lg border border-slate-300 hover:bg-white text-slate-700 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Receipt className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Open Bill</span>
                  </button>

                  <button
                    onClick={() => {
                      handleCallToken(drawerData.appointment);
                    }}
                    className="py-2 px-3 rounded-lg border border-slate-300 hover:bg-white text-slate-700 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Volume2 className="w-3.5 h-3.5 text-blue-600" />
                    <span>Call Chime</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Record Vitals Modal */}
      {vitalsModalAppointment && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-5 space-y-4 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2 text-blue-700">
                <HeartPulse className="w-4 h-4" />
                <h3 className="font-bold text-sm text-slate-900">
                  Triage Vitals Check - {vitalsModalAppointment.patientName} (Token #{vitalsModalAppointment.tokenNumber})
                </h3>
              </div>
              <button
                onClick={() => setVitalsModalAppointment(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Blood Pressure Systolic (mmHg)</label>
                <input
                  type="number"
                  value={bpSys}
                  onChange={(e) => setBpSys(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-md p-1.5 font-mono font-bold text-slate-800 focus:ring-1 focus:ring-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Blood Pressure Diastolic (mmHg)</label>
                <input
                  type="number"
                  value={bpDia}
                  onChange={(e) => setBpDia(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-md p-1.5 font-mono font-bold text-slate-800 focus:ring-1 focus:ring-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Pulse / Heart Rate (bpm)</label>
                <input
                  type="number"
                  value={heartRate}
                  onChange={(e) => setHeartRate(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-md p-1.5 font-mono font-bold text-slate-800 focus:ring-1 focus:ring-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Body Temperature (°F)</label>
                <input
                  type="number"
                  step="0.1"
                  value={temp}
                  onChange={(e) => setTemp(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-md p-1.5 font-mono font-bold text-slate-800 focus:ring-1 focus:ring-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Oxygen Saturation SpO2 (%)</label>
                <input
                  type="number"
                  value={spO2}
                  onChange={(e) => setSpO2(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-md p-1.5 font-mono font-bold text-slate-800 focus:ring-1 focus:ring-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Random Blood Sugar (mg/dL)</label>
                <input
                  type="number"
                  value={bloodSugar}
                  onChange={(e) => setBloodSugar(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-md p-1.5 font-mono font-bold text-slate-800 focus:ring-1 focus:ring-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Weight (kg)</label>
                <input
                  type="number"
                  step="0.5"
                  value={weight}
                  onChange={(e) => setWeight(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-md p-1.5 font-mono font-bold text-slate-800 focus:ring-1 focus:ring-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Height (cm)</label>
                <input
                  type="number"
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-md p-1.5 font-mono font-bold text-slate-800 focus:ring-1 focus:ring-blue-600 focus:outline-none"
                />
              </div>
            </div>

            {/* Calculated BMI */}
            <div className="bg-slate-50 p-2.5 rounded-md border border-slate-200 flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">Calculated BMI:</span>
              <strong className="text-slate-900 font-mono">
                {height > 0 ? (weight / ((height / 100) * (height / 100))).toFixed(1) : '--'} kg/m²
              </strong>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => setVitalsModalAppointment(null)}
                className="px-3.5 py-1.5 rounded-md text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveVitals}
                className="px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm"
              >
                Save Vitals & Send to Queue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Token Modal */}
      {showNewTokenModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-blue-600" /> Issue OPD Queue Token
              </h3>
              <button onClick={() => setShowNewTokenModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">Select Patient:</label>
                <select
                  value={selectedPatientId}
                  onChange={(e) => setSelectedPatientId(e.target.value)}
                  className="w-full border border-slate-200 rounded-md p-2 text-xs font-semibold text-slate-800 bg-white"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.uhid}) - {p.phone}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">Consulting Doctor / OPD:</label>
                <select
                  value={selectedDoctorId}
                  onChange={(e) => setSelectedDoctorId(e.target.value)}
                  className="w-full border border-slate-200 rounded-md p-2 text-xs font-semibold text-slate-800 bg-white"
                >
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.specialty} • ₹{d.consultationFee})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">Consultation Type:</label>
                <select
                  value={consultType}
                  onChange={(e) => setConsultType(e.target.value as any)}
                  className="w-full border border-slate-200 rounded-md p-2 text-xs font-semibold text-slate-800 bg-white"
                >
                  <option value="New Consultation">New Consultation</option>
                  <option value="Follow-up">Follow-up Review</option>
                  <option value="Report Review">Lab Report Review</option>
                  <option value="Emergency">Emergency</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => setShowNewTokenModal(false)}
                className="px-3.5 py-1.5 rounded-md text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateToken}
                className="px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm"
              >
                Issue Token & Print Slip
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

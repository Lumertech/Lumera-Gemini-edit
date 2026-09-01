import React, { useState } from 'react';
import { 
  Users, 
  Volume2, 
  Clock, 
  Activity, 
  Plus, 
  CheckCircle, 
  ArrowRight, 
  HeartPulse, 
  FileText, 
  Receipt, 
  Stethoscope, 
  Search,
  X
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

  const filteredAppointments = appointments.filter((apt) => {
    if (filterStatus === 'All') return true;
    return apt.status === filterStatus;
  });

  const handleCallToken = (apt: Appointment) => {
    setCallingToken(apt);
    onUpdateStatus(apt.id, 'In Consultation');
    
    // Play subtle audio alert if available
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
      // Audio autoplay policy
    }
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

      {/* Filter Tabs & Quick Metrics */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-2.5 rounded-lg border border-slate-200 shadow-sm">
        <div className="flex space-x-1 overflow-x-auto w-full sm:w-auto text-xs">
          {['All', 'Waiting', 'Triage / Vitals', 'In Consultation', 'Completed'].map((st) => {
            const count = appointments.filter((a) => (st === 'All' ? true : a.status === st)).length;
            return (
              <button
                key={st}
                onClick={() => setFilterStatus(st)}
                className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap transition-all ${
                  filterStatus === st
                    ? 'bg-blue-600 text-white shadow-xs font-semibold'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {st} ({count})
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setShowNewTokenModal(true)}
          className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-all flex items-center gap-1.5 self-end sm:self-auto shadow-xs"
        >
          <Plus className="w-3.5 h-3.5 text-blue-400" />
          <span>New Token</span>
        </button>
      </div>

      {/* Queue Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredAppointments.map((apt) => (
          <div
            key={apt.id}
            className={`bg-white rounded-xl border transition-all p-4 space-y-3 shadow-sm hover:shadow-md ${
              apt.status === 'In Consultation'
                ? 'border-blue-300 ring-2 ring-blue-50 bg-blue-50/20'
                : 'border-slate-200'
            }`}
          >
            {/* Card Header: Token & Status */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-md bg-slate-900 text-blue-300 font-bold flex flex-col items-center justify-center">
                  <span className="text-[8px] uppercase tracking-wider text-slate-400">TKN</span>
                  <span className="text-xs leading-none font-bold text-white">#{apt.tokenNumber}</span>
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-xs">{apt.patientName}</h3>
                  <span className="text-[10px] text-slate-400 font-mono">{apt.uhid}</span>
                </div>
              </div>

              <span
                className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
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

            {/* Doctor & Slot Info */}
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium text-[11px]">Doctor:</span>
                <strong className="text-slate-800 text-[11px]">{apt.doctorName}</strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium text-[11px]">Specialty / Slot:</span>
                <span className="text-blue-700 font-medium text-[11px]">{apt.specialty} • {apt.timeSlot}</span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-slate-400">Source:</span>
                <span className="text-slate-600 font-medium">{apt.source}</span>
              </div>
            </div>

            {/* Vitals Summary Strip */}
            {apt.vitals ? (
              <div className="bg-blue-50/60 p-2 rounded-lg border border-blue-200/80 text-xs flex items-center justify-between">
                <div className="flex items-center space-x-1 text-slate-800 text-[11px]">
                  <HeartPulse className="w-3 h-3 text-blue-600" />
                  <span className="font-semibold">BP: {apt.vitals.bloodPressureSystolic}/{apt.vitals.bloodPressureDiastolic}</span>
                  <span className="text-slate-400">|</span>
                  <span>HR: {apt.vitals.heartRate}</span>
                  <span className="text-slate-400">|</span>
                  <span>SpO2: {apt.vitals.spO2}%</span>
                </div>
                <button
                  onClick={() => handleOpenVitalsModal(apt)}
                  className="text-[10px] font-bold text-blue-700 hover:underline"
                >
                  Edit
                </button>
              </div>
            ) : (
              <button
                onClick={() => handleOpenVitalsModal(apt)}
                className="w-full py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                <Activity className="w-3 h-3 text-blue-600" />
                <span>Record Vitals & Triage</span>
              </button>
            )}

            {/* Actions Bar */}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
              <button
                onClick={() => handleCallToken(apt)}
                className="py-1.5 px-2.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs flex items-center justify-center gap-1 shadow-xs transition-all"
              >
                <Volume2 className="w-3 h-3 text-blue-400" />
                <span>Call Token</span>
              </button>

              <button
                onClick={() => onStartConsultation(apt)}
                className="py-1.5 px-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs flex items-center justify-center gap-1 shadow-sm shadow-blue-100 transition-all"
              >
                <Stethoscope className="w-3 h-3" />
                <span>Start Consult</span>
              </button>
            </div>
          </div>
        ))}
      </div>

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

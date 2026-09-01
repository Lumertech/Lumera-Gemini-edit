import React, { useState, useEffect } from 'react';
import { 
  Tv, 
  Volume2, 
  VolumeX, 
  Maximize2, 
  Minimize2, 
  QrCode, 
  UserCheck, 
  Clock, 
  Sparkles, 
  CheckCircle2, 
  Activity,
  Search,
  Building,
  UserPlus
} from 'lucide-react';
import { Appointment, Doctor, Patient } from '../types';

interface WaitingRoomKioskProps {
  appointments: Appointment[];
  doctors: Doctor[];
  patients: Patient[];
  onCheckInPatient?: (appointmentId: string) => void;
  onRegisterWalkIn?: (patientData: Partial<Patient>, doctorId: string) => void;
}

export const WaitingRoomKiosk: React.FC<WaitingRoomKioskProps> = ({
  appointments,
  doctors,
  patients,
  onCheckInPatient,
  onRegisterWalkIn,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [activeKioskTab, setActiveKioskTab] = useState<'display' | 'self_checkin'>('display');
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
  const [checkinInput, setCheckinInput] = useState('');
  const [checkinSuccessMsg, setCheckinSuccessMsg] = useState<string | null>(null);

  // Clock tick
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Announce token via Web Speech Synthesis API
  const announceToken = (token: number, patientName: string, doctorName: string, room: string) => {
    if (!voiceEnabled || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const text = `Token Number ${token}. ${patientName}. Please proceed to ${room}, with ${doctorName}.`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  };

  const handleSelfCheckin = () => {
    if (!checkinInput.trim()) return;
    const match = appointments.find(
      (a) =>
        a.uhid.toLowerCase().includes(checkinInput.toLowerCase()) ||
        a.patientPhone.includes(checkinInput) ||
        a.patientName.toLowerCase().includes(checkinInput.toLowerCase())
    );

    if (match) {
      if (onCheckInPatient) onCheckInPatient(match.id);
      setCheckinSuccessMsg(`Welcome ${match.patientName}! Checked in successfully. Token #${match.tokenNumber} allocated.`);
      announceToken(match.tokenNumber, match.patientName, match.doctorName, 'Room 102');
    } else {
      setCheckinSuccessMsg(`UHID/Phone ${checkinInput} not found. Created priority walk-in token #8.`);
    }
    setCheckinInput('');
  };

  const callingApts = appointments.filter((a) => a.status === 'In Progress' || a.status === 'Confirmed').slice(0, 3);
  const waitingApts = appointments.filter((a) => a.status === 'Waiting');

  return (
    <div className={`space-y-6 ${isFullscreen ? 'fixed inset-0 z-50 bg-slate-950 p-6 overflow-y-auto' : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6'}`}>
      {/* Kiosk Control Header Bar */}
      <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-5 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-teal-500/20 border border-teal-400/30 text-teal-400">
            <Tv className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-wide flex items-center gap-2">
              <span>Lumera Polyclinic & Rehabilitation TV Kiosk</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                LIVE Q-STREAM
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Waiting Area High-Definition Signage & Automated ABHA Digital Self-Registration
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-xl text-center font-mono font-bold text-teal-400 text-sm">
            {currentTime}
          </div>

          <div className="flex items-center bg-slate-800 border border-slate-700 rounded-xl p-1">
            <button
              onClick={() => setActiveKioskTab('display')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeKioskTab === 'display' ? 'bg-teal-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
              }`}
            >
              TV Board
            </button>
            <button
              onClick={() => setActiveKioskTab('self_checkin')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeKioskTab === 'self_checkin' ? 'bg-teal-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>ABHA Check-in</span>
            </button>
          </div>

          <button
            onClick={() => setVoiceEnabled(!voiceEnabled)}
            className={`p-2 rounded-xl border text-xs transition-all ${
              voiceEnabled
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
            title={voiceEnabled ? 'Voice Announcement Enabled' : 'Voice Muted'}
          >
            {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white transition-all"
            title="Toggle TV Fullscreen"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* VIEW 1: TV Live Queue Signage Board */}
      {activeKioskTab === 'display' && (
        <div className="space-y-6">
          {/* Top Now Serving Cards Grid */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
                <span>Currently In Consultation / Now Calling</span>
              </span>
              <span className="text-xs font-medium text-slate-500">Audio Chimes Enabled</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {appointments.slice(0, 3).map((apt, idx) => (
                <div
                  key={apt.id}
                  className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl p-5 border-2 border-emerald-500/50 shadow-xl relative overflow-hidden space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500 text-slate-950 uppercase tracking-wide">
                      Now Serving
                    </span>
                    <span className="font-mono text-sm text-slate-300">Room 10{idx + 1}</span>
                  </div>

                  <div className="flex items-baseline justify-between pt-1">
                    <div>
                      <span className="text-xs text-slate-400 block font-medium">Token Number</span>
                      <span className="text-4xl font-black font-mono tracking-tight text-emerald-400">
                        #{apt.tokenNumber < 10 ? `0${apt.tokenNumber}` : apt.tokenNumber}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => announceToken(apt.tokenNumber, apt.patientName, apt.doctorName, `Room 10${idx + 1}`)}
                      className="p-2 rounded-xl bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 hover:text-white border border-emerald-500/40 transition-all text-xs flex items-center gap-1"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Re-call</span>
                    </button>
                  </div>

                  <div className="border-t border-slate-700/80 pt-2.5 space-y-0.5">
                    <h3 className="font-bold text-base text-white truncate">{apt.patientName}</h3>
                    <p className="text-xs text-teal-300 font-medium">{apt.doctorName}</p>
                    <p className="text-[11px] text-slate-400">{apt.specialty}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Department Clinic Rooms Matrix */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <Building className="w-4 h-4 text-teal-600" />
                <span>Department Chambers & Doctor Availability</span>
              </h3>
              <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full">
                6 Specialist Chambers Active
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {doctors.map((doc, idx) => (
                <div
                  key={doc.id}
                  className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded-md bg-teal-100 dark:bg-teal-900 text-teal-800 dark:text-teal-200 font-mono font-bold text-xs">
                      Room 10{idx + 1}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Available
                    </span>
                  </div>

                  <div>
                    <h4 className="font-bold text-xs text-slate-900 dark:text-white">{doc.name}</h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{doc.specialty}</p>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-200 dark:border-slate-700">
                    <span>Queue: <strong>{appointments.filter((a) => a.doctorId === doc.id).length} Patients</strong></span>
                    <span>Next: <strong>~10 mins</strong></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: Patient Self-Check-in & ABHA QR Scanner Kiosk */}
      {activeKioskTab === 'self_checkin' && (
        <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xl space-y-6 animate-in zoom-in-95 duration-150">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-teal-50 text-teal-600 mx-auto flex items-center justify-center shadow-xs">
              <QrCode className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Self-Service Check-In & ABHA Scanner</h2>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Scan your Ayushman Bharat Health Account (ABHA) QR code or enter your UHID / Mobile number to retrieve your token instantly.
            </p>
          </div>

          {/* Success Banner */}
          {checkinSuccessMsg && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-900 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div className="font-medium">{checkinSuccessMsg}</div>
            </div>
          )}

          {/* Simulated ABHA QR Scanner Box */}
          <div className="bg-slate-900 text-white rounded-2xl p-6 text-center space-y-3 relative overflow-hidden">
            <div className="w-48 h-48 mx-auto border-2 border-dashed border-teal-400 rounded-xl flex flex-col items-center justify-center p-4 relative">
              <div className="absolute inset-x-4 top-2 h-0.5 bg-teal-400 animate-bounce"></div>
              <QrCode className="w-16 h-16 text-teal-400 opacity-60" />
              <span className="text-[11px] text-teal-200 font-medium mt-2">Hold ABHA QR Card Here</span>
            </div>
            <p className="text-xs text-slate-400">Camera Active: Auto-detecting NHA ABHA Health Card</p>
          </div>

          {/* Manual Search Form */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-slate-700">Or Check In via UHID / Phone Number:</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={checkinInput}
                onChange={(e) => setCheckinInput(e.target.value)}
                placeholder="e.g. LUM-2026-0106 or 9895012399..."
                className="flex-1 text-xs text-slate-800 p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-teal-500 font-medium"
              />
              <button
                type="button"
                onClick={handleSelfCheckin}
                className="px-5 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold shadow-md transition-all flex items-center gap-1.5"
              >
                <UserCheck className="w-4 h-4" />
                <span>Check In</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

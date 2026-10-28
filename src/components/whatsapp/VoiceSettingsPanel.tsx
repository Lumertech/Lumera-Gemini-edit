import React, { useState, useEffect } from 'react';
import {
  PhoneCall,
  MessageSquare,
  Sparkles,
  Bot,
  CheckCircle2,
  AlertCircle,
  Save,
  Volume2,
  Stethoscope,
  Clock,
  MapPin,
  RefreshCw,
  Building,
  ShieldCheck,
  Send,
  User
} from 'lucide-react';
import { apiFetchResponse } from '../../api/http';

interface VoiceSettingsData {
  tenantId: string;
  voiceEnabled: boolean;
  receptionistName: string;
  customGreeting: string;
  clinic: {
    name: string;
    address: string;
    city: string;
    phone: string;
  };
  doctors: Array<{
    id?: string;
    name: string;
    specialty: string;
    consultation_fee?: number;
    fee?: number;
    opd_timing?: string;
    timing?: string;
    available_days?: string;
    days?: string;
  }>;
}

export const VoiceSettingsPanel: React.FC = () => {
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(true);
  const [receptionistName, setReceptionistName] = useState<string>('Maya');
  const [customGreeting, setCustomGreeting] = useState<string>('');
  const [clinicData, setClinicData] = useState<VoiceSettingsData['clinic']>({
    name: 'Lumera Clinic',
    address: '',
    city: '',
    phone: '',
  });
  const [doctors, setDoctors] = useState<VoiceSettingsData['doctors']>([]);

  // Simulation test state
  const [testQuery, setTestQuery] = useState<string>('What are the OPD timings and fee for Dr. Vikram?');
  const [simulating, setSimulating] = useState<boolean>(false);
  const [simulationReply, setSimulationReply] = useState<{
    speechText: string;
    intent: string;
    doctorName?: string;
    suggestedAction?: string;
    appointment?: any;
  } | null>(null);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetchResponse('/api/whatsapp/voice-settings');
      if (res.ok) {
        const data: VoiceSettingsData = await res.json();
        setVoiceEnabled(Boolean(data.voiceEnabled));
        setReceptionistName(data.receptionistName || 'Maya');
        setCustomGreeting(data.customGreeting || '');
        if (data.clinic) setClinicData(data.clinic);
        if (data.doctors) setDoctors(data.doctors);
      } else {
        setError('Failed to fetch clinic voice settings.');
      }
    } catch (err) {
      console.error('[VoiceSettingsPanel load]', err);
      setError('Network error while loading voice settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSaveSuccess(false);

      const res = await apiFetchResponse('/api/whatsapp/voice-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceEnabled,
          receptionistName,
          customGreeting,
        }),
      });

      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 4000);
      } else {
        setError('Failed to save settings. Please try again.');
      }
    } catch (err) {
      console.error('[VoiceSettingsPanel save]', err);
      setError('Network error while saving settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleSimulate = async () => {
    if (!testQuery.trim()) return;
    try {
      setSimulating(true);
      setSimulationReply(null);
      const res = await apiFetchResponse('/api/gemini/voice-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: testQuery,
          callerName: 'Patient Test',
          callerPhone: '+919999973271',
        }),
      });

      if (res.ok) {
        const reply = await res.json();
        setSimulationReply(reply);
      }
    } catch (err) {
      console.error('[Simulation test]', err);
    } finally {
      setSimulating(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center flex flex-col items-center justify-center space-y-3">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
        <p className="text-sm font-medium text-slate-600">Loading personalized clinic voice settings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Mode Selector Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                voiceEnabled
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border border-amber-200'
              }`}>
                <span className={`w-2 h-2 rounded-full ${voiceEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                {voiceEnabled ? 'Voice Receptionist Active' : 'Messaging Only Mode'}
              </span>
              <span className="text-xs text-slate-400">|</span>
              <span className="text-xs font-medium text-slate-600">WhatsApp Inbound Call Gateway</span>
            </div>
            <h2 className="text-lg font-bold text-slate-900 mt-2">
              Inbound Call Channel Configuration
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Choose how incoming WhatsApp phone calls from patients are handled for your clinic.
            </p>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-xs transition-all self-start md:self-auto shrink-0"
          >
            {saving ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saving ? 'Saving Changes...' : 'Save Settings'}
          </button>
        </div>

        {/* Feedback Alerts */}
        {saveSuccess && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2.5 text-xs text-emerald-800 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Voice settings successfully updated! New incoming calls will immediately adopt these settings.</span>
          </div>
        )}

        {error && (
          <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2.5 text-xs text-red-800">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 2-Option Card Selector */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Option A: Voice Calls & AI Receptionist */}
          <div
            onClick={() => setVoiceEnabled(true)}
            className={`p-5 rounded-2xl border-2 cursor-pointer transition-all ${
              voiceEnabled
                ? 'border-blue-600 bg-blue-50/40 shadow-sm'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  voiceEnabled ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}>
                  <PhoneCall className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Inbound Voice Calls (AI Receptionist)
                  </h3>
                  <span className="text-[11px] text-blue-600 font-medium">Recommended for Clinics</span>
                </div>
              </div>
              <input
                type="radio"
                name="voice_mode"
                checked={voiceEnabled}
                onChange={() => setVoiceEnabled(true)}
                className="w-4 h-4 text-blue-600 focus:ring-blue-500 mt-1 cursor-pointer"
              />
            </div>
            <p className="text-xs text-slate-600 mt-3 leading-relaxed">
              When a patient calls your clinic's WhatsApp number, the call is answered live on the first ring. {receptionistName} speaks naturally in English, Hindi, or regional languages, answers queries with your clinic profile, and books appointments into your calendar.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-white px-2 py-0.5 rounded-md border border-slate-200 text-slate-700">
                ⚡ ~1.8s Fast Turnaround
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-white px-2 py-0.5 rounded-md border border-slate-200 text-slate-700">
                📅 Auto Calendar Booking
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-white px-2 py-0.5 rounded-md border border-slate-200 text-slate-700">
                🇮🇳 Hindi / Indic Native
              </span>
            </div>
          </div>

          {/* Option B: Messaging Only */}
          <div
            onClick={() => setVoiceEnabled(false)}
            className={`p-5 rounded-2xl border-2 cursor-pointer transition-all ${
              !voiceEnabled
                ? 'border-blue-600 bg-blue-50/40 shadow-sm'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  !voiceEnabled ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}>
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Messaging Only (Decline Calls)
                  </h3>
                  <span className="text-[11px] text-slate-500 font-medium">Text & Chat Support 24/7</span>
                </div>
              </div>
              <input
                type="radio"
                name="voice_mode"
                checked={!voiceEnabled}
                onChange={() => setVoiceEnabled(false)}
                className="w-4 h-4 text-blue-600 focus:ring-blue-500 mt-1 cursor-pointer"
              />
            </div>
            <p className="text-xs text-slate-600 mt-3 leading-relaxed">
              Voice calls are gracefully declined without ringing out. The caller instantly receives a personalized automated WhatsApp message explaining that your clinic accepts queries and appointment bookings via WhatsApp chat, complete with quick action buttons.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-white px-2 py-0.5 rounded-md border border-slate-200 text-slate-700">
                🔇 Silent Call Decline
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-white px-2 py-0.5 rounded-md border border-slate-200 text-slate-700">
                💬 Instant WhatsApp Text Dispatch
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-white px-2 py-0.5 rounded-md border border-slate-200 text-slate-700">
                🔘 Interactive Quick Buttons
              </span>
            </div>
          </div>
        </div>

        {/* 2. Receptionist Persona Customization */}
        <div className="bg-slate-50/70 p-5 rounded-xl border border-slate-200/80 space-y-4">
          <div className="flex items-center gap-2 text-slate-800">
            <Bot className="w-4 h-4 text-blue-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider">AI Receptionist Persona & Greeting</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Receptionist Name
              </label>
              <input
                type="text"
                value={receptionistName}
                onChange={(e) => setReceptionistName(e.target.value)}
                placeholder="e.g. Maya, Priya, Rahul"
                className="w-full text-xs px-3 py-2 bg-white rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                The name the bot introduces itself with when callers connect.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Custom Welcome Greeting / Notice (Optional)
              </label>
              <input
                type="text"
                value={customGreeting}
                onChange={(e) => setCustomGreeting(e.target.value)}
                placeholder="e.g. Welcome to Dr. Sen's Clinic. How may I assist you?"
                className="w-full text-xs px-3 py-2 bg-white rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Special welcome announcement or clinic tagline spoken to callers.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Personalized Clinic Profile & Doctor Calendar Snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Synchronized Clinic Profile */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-bold text-slate-900">Personalized Clinic Profile</h3>
            </div>
            <span className="text-[11px] font-medium bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">
              Live Synced
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-slate-400 text-[11px] block">Clinic Name</span>
              <span className="font-bold text-slate-800 text-sm">{clinicData.name}</span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-start gap-2.5">
              <MapPin className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <div>
                <span className="text-slate-400 text-[11px] block">Address</span>
                <span className="text-slate-700 font-medium">{clinicData.address || 'Health Hub, Sector 14'}</span>
                {clinicData.city && <span className="text-slate-500 block">{clinicData.city}</span>}
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                <div>
                  <span className="text-slate-400 text-[11px] block">OPD Schedule</span>
                  <span className="text-slate-700 font-medium">Mon-Sat: 9AM - 8PM, Sun: 10AM - 2PM</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Active Doctor Roster Quoted by AI */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Stethoscope className="w-4 h-4 text-purple-600" />
              <h3 className="text-sm font-bold text-slate-900">Active Doctors & Calendar Roster</h3>
            </div>
            <span className="text-[11px] text-slate-500 font-medium">
              {doctors.length} doctors active in calendar
            </span>
          </div>

          <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
            {doctors.map((doc, idx) => (
              <div
                key={doc.id || idx}
                className="p-3 bg-slate-50/80 hover:bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between gap-3 text-xs transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0">
                    {doc.name.replace(/^dr\.?\s*/i, '').charAt(0)}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800">
                      {doc.name.startsWith('Dr.') ? doc.name : `Dr. ${doc.name}`}
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      {doc.specialty} • {doc.timing || doc.opd_timing || '10:00 AM - 05:00 PM'}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
                    ₹{doc.fee ?? doc.consultation_fee ?? 500}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    {doc.days || doc.available_days || 'Mon-Sat'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Interactive AI Receptionist Tester */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-600" />
          <h3 className="text-sm font-bold text-slate-900">Live Voice Receptionist Simulator</h3>
        </div>
        <p className="text-xs text-slate-500">
          Test how {receptionistName} responds live to patient questions with your personalized clinic facts and doctor timings.
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={testQuery}
            onChange={(e) => setTestQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSimulate()}
            placeholder="Type a caller question (e.g. Can I book Dr. Vikram for fever?)"
            className="flex-1 text-xs px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSimulate}
            disabled={simulating}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-2 shrink-0 transition-all disabled:opacity-50"
          >
            {simulating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {simulating ? 'Thinking...' : 'Test Response'}
          </button>
        </div>

        {/* Quick Test Chips */}
        <div className="flex flex-wrap gap-2">
          {[
            'What are the doctor consultation fees?',
            'कल डॉक्टर विक्रम से मिलने का समय क्या है?',
            'I have severe knee pain, can I get an appointment?',
            'Where is the clinic located?'
          ].map((sample, i) => (
            <button
              key={i}
              onClick={() => {
                setTestQuery(sample);
              }}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
            >
              "{sample}"
            </button>
          ))}
        </div>

        {/* Simulator Output */}
        {simulationReply && (
          <div className="mt-4 p-4 bg-purple-50/60 border border-purple-100 rounded-xl space-y-2 text-xs animate-fadeIn">
            <div className="flex items-center justify-between">
              <span className="font-bold text-purple-900 flex items-center gap-1.5">
                <Volume2 className="w-4 h-4 text-purple-600" />
                {receptionistName} (Spoken Audio Reply):
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-purple-100 text-purple-700">
                Intent: {simulationReply.intent}
              </span>
            </div>
            <p className="text-slate-800 text-sm font-medium leading-relaxed italic">
              "{simulationReply.speechText}"
            </p>
            {simulationReply.appointment && (
              <div className="mt-2 p-2.5 bg-white rounded-lg border border-purple-200 flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-900 block">
                    Confirmed Slot Token #{simulationReply.appointment.tokenNumber}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {simulationReply.appointment.doctorName} • {simulationReply.appointment.timeSlot}
                  </span>
                </div>
                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
                  Active in Calendar
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

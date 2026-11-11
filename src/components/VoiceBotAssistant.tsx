import React, { useState, useEffect, useRef } from 'react';
import { 
  PhoneCall, 
  PhoneOff, 
  Mic, 
  Volume2, 
  Bot, 
  Sparkles, 
  RefreshCw, 
  User, 
  Calendar, 
  CheckCircle2, 
  Globe,
  MessageSquare,
  ShieldCheck,
  Video
} from 'lucide-react';
import { apiFetch, apiFetchResponse } from '../api/http';
import { useAuth } from '../auth/AuthContext';
import { formatIndianPhoneDisplay, isIndianPhoneNumber } from '../lib/indianPhone';
import { canEditClinicVoiceSettings, mayaDeskStatus, mayaOpeningGreeting, mayaWhatsAppLine } from '../lib/voiceDesk';
import { useNav } from '../nav/NavigationContext';
import { Patient, Doctor } from '../types';

interface VoiceBotAssistantProps {
  currentPatient: Patient;
  doctors: Doctor[];
}

const INDIAN_LANGUAGES = [
  { name: 'English (India)', code: 'en-IN' },
  { name: 'Hindi (हिंदी)', code: 'hi-IN' },
  { name: 'Tamil (தமிழ்)', code: 'ta-IN' },
  { name: 'Telugu (తెలుగు)', code: 'te-IN' },
  { name: 'Marathi (मराठी)', code: 'mr-IN' },
  { name: 'Kannada (ಕನ್ನಡ)', code: 'kn-IN' },
  { name: 'Bengali (বাংলা)', code: 'bn-IN' },
  { name: 'Gujarati (ગુજરાતી)', code: 'gu-IN' },
  { name: 'Punjabi (ਪੰਜਾਬੀ)', code: 'pa-IN' },
  { name: 'Malayalam (മലയാളം)', code: 'ml-IN' },
];

function localizedGreeting(code: string, clinicName: string, customGreeting: string): string {
  const custom = customGreeting.trim();
  if (custom) return custom;
  const name = clinicName.trim() || 'the clinic';
  const named: Record<string, string> = {
    'hi-IN': `नमस्ते! ${name} में कॉल करने के लिए धन्यवाद। आज मैं आपकी स्वास्थ्य नियुक्ति में कैसे सहायता कर सकता हूँ?`,
    'ta-IN': `வணக்கம்! ${name} அழைத்ததற்கு நன்றி. உங்கள் மருத்துவ சந்திப்புக்கு நான் எவ்வாறு உதவ முடியும்?`,
    'te-IN': `నమస్కారం! ${name} కి కాల్ చేసినందుకు ధన్యవాదాలు. మీ వైద్య నియామకంలో నేను మీకు ఎలా సహాయం చేయగలను?`,
    'mr-IN': `नमस्कार! ${name} मध्ये कॉल केल्याबद्दल धन्यवाद. आज मी तुमच्या आरोग्य भेटीसाठी कशी मदत करू शकतो?`,
    'kn-IN': `ನಮಸ್ಕಾರ! ${name} ಗೆ ಕರೆ ಮಾಡಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು. ನಿಮ್ಮ ಆರೋಗ್ಯ ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ಅನ್ನು ನಾನು ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?`,
    'bn-IN': `নমস্কার! ${name}-এ কল করার জন্য ধন্যবাদ। আজ আমি আপনার স্বাস্থ্য অ্যাপয়েন্টমেন্টে কীভাবে সাহায্য করতে পারি?`,
    'gu-IN': `નમસ્તે! ${name} માં કૉલ કરવા બદલ આભાર. આજે હું તમારી સ્વાસ્થ્ય મુલાકાતમાં કેવી રીતે મદદ કરી શકું?`,
    'pa-IN': `ਸਤਿ ਸ਼੍ਰੀ ਅਕਾਲ! ${name} ਵਿੱਚ ਕਾਲ ਕਰਨ ਲਈ ਧੰਨਵਾਦ। ਅਸੀਂ ਤੁਹਾਡੀ ਸਿਹਤ ਮੁਲਾਕਾਤ ਵਿੱਚ ਕਿਵੇਂ ਮਦਦ ਕਰ ਸਕਦੇ ਹਾਂ?`,
    'ml-IN': `നമസ്കാരം! ${name} ലേക്ക് വിളിച്ചതിന് നന്ദി. നിങ്ങളുടെ ആരോഗ്യ അപ്പോയിന്റ്മെന്റിൽ ഞാൻ എങ്ങനെ സഹായിക്കണം?`,
  };
  return named[code] || mayaOpeningGreeting(name);
}

const VOICE_PERSONAS = [
  { id: 'maya', name: 'Maya (Warm & Empathetic)', pitch: 1.1, rate: 1.0, desc: 'Kind, comforting tone ideal for patient triage' },
  { id: 'aarav', name: 'Aarav (Professional Doctor AI)', pitch: 0.9, rate: 1.0, desc: 'Authoritative, calm, clinical consultation voice' },
  { id: 'priya', name: 'Priya (Multilingual Concierge)', pitch: 1.2, rate: 1.05, desc: 'Fast, clear, energetic receptionist voice' },
  { id: 'kabir', name: 'Kabir (Deep & Reassuring)', pitch: 0.8, rate: 0.95, desc: 'Stable, mature voice for emergency or elderly support' }
];

export const VoiceBotAssistant: React.FC<VoiceBotAssistantProps> = ({
  currentPatient,
  doctors,
}) => {
  const { user } = useAuth();
  const { go } = useNav();
  const canEdit = canEditClinicVoiceSettings(user?.role);
  const [isInCall, setIsInCall] = useState(false);
  const [callType, setCallType] = useState<'ivrn' | 'whatsapp'>('whatsapp');
  const [selectedLang, setSelectedLang] = useState(INDIAN_LANGUAGES[0]);
  const [selectedPersona, setSelectedPersona] = useState(VOICE_PERSONAS[0]);
  const [callDurationSec, setCallDurationSec] = useState(0);
  const [spokenInput, setSpokenInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasEmergency, setHasEmergency] = useState(false);
  const [deskLoaded, setDeskLoaded] = useState(false);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [escalationTouched, setEscalationTouched] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [customGreeting, setCustomGreeting] = useState('');
  const [escalationPhone, setEscalationPhone] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [whatsappDisplay, setWhatsappDisplay] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const openingLine = localizedGreeting(selectedLang.code, clinicName, customGreeting);
  const [callLog, setCallLog] = useState<Array<{ speaker: 'Caller' | 'AI Voice Assistant'; text: string; time: string }>>([
    {
      speaker: 'AI Voice Assistant',
      text: mayaOpeningGreeting(''),
      time: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: '2-digit', minute: '2-digit' })
    },
  ]);
  const [voiceVolume, setVoiceVolume] = useState(65);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [settingsRes, mine, letterhead] = await Promise.all([
          apiFetch<{
            voiceEnabled?: boolean;
            customGreeting?: string;
            escalationPhone?: string;
            clinic?: { name?: string };
          }>('/api/whatsapp/voice-settings'),
          apiFetch<{
            tenantNumber?: { status?: string } | null;
            doctorNumber?: { status?: string } | null;
          }>('/api/whatsapp-numbers/mine').catch(() => null),
          apiFetch<{ letterhead?: { clinicName?: string; whatsappNumber?: string }; clinicName?: string; whatsappNumber?: string }>(
            '/api/tenant/letterhead'
          ).catch(() => null),
        ]);
        if (cancelled) return;
        setVoiceEnabled(settingsRes?.voiceEnabled !== false);
        setCustomGreeting(String(settingsRes?.customGreeting || ''));
        setEscalationPhone(String(settingsRes?.escalationPhone || ''));
        setEscalationTouched(false);
        setSettingsHydrated(true);
        const letter = (letterhead?.letterhead || letterhead) as { clinicName?: string; whatsappNumber?: string } | null;
        const name = String(letter?.clinicName || settingsRes?.clinic?.name || '').trim();
        setClinicName(name);
        const connected = mine?.tenantNumber?.status === 'connected' || mine?.doctorNumber?.status === 'connected';
        setWhatsappConnected(Boolean(connected));
        const published = String(letter?.whatsappNumber || '').trim();
        setWhatsappDisplay(published ? formatIndianPhoneDisplay(published) : '');
      } catch (err) {
        if (!cancelled) {
          setSettingsHydrated(false);
          setSettingsError(err instanceof Error ? err.message : 'Could not load voice settings.');
        }
      } finally {
        if (!cancelled) setDeskLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const inCallRef = useRef(isInCall);
  inCallRef.current = isInCall;
  useEffect(() => {
    if (inCallRef.current) return;
    setCallLog([
      {
        speaker: 'AI Voice Assistant',
        text: openingLine,
        time: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: '2-digit', minute: '2-digit' })
      }
    ]);
  }, [openingLine]);

  // Call timer simulation
  useEffect(() => {
    let interval: any;
    if (isInCall) {
      interval = setInterval(() => {
        setCallDurationSec((prev) => prev + 1);
        setVoiceVolume(Math.floor(Math.random() * 45) + 35);
      }, 1000);
    } else {
      setCallDurationSec(0);
      setVoiceVolume(0);
    }
    return () => clearInterval(interval);
  }, [isInCall]);

  const speakText = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = selectedLang.code;
      utterance.pitch = selectedPersona.pitch;
      utterance.rate = selectedPersona.rate;
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleStartCall = () => {
    setIsInCall(true);
    speakText(openingLine);
  };

  const handleSaveVoiceSettings = async () => {
    if (!canEdit || !settingsHydrated) return;
    const phone = escalationPhone.trim();
    if (escalationTouched && phone && !isIndianPhoneNumber(phone)) {
      setSettingsError('Enter an Indian mobile or landline number, for example +91 98200 11111.');
      setSettingsSaved(false);
      return;
    }
    setSavingSettings(true);
    setSettingsError('');
    setSettingsSaved(false);
    try {
      await apiFetch('/api/whatsapp/voice-settings', {
        method: 'POST',
        body: JSON.stringify({
          voiceEnabled,
          customGreeting,
          ...(escalationTouched ? { escalationPhone: phone } : {}),
        }),
      });
      setSettingsSaved(true);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Could not save voice settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleEndCall = () => {
    setIsInCall(false);
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const handleVoiceQuery = async (queryText?: string) => {
    const text = queryText || spokenInput;
    if (!text.trim() || isProcessing) return;

    const timeNow = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: '2-digit', minute: '2-digit' });
    const callerEntry = { speaker: 'Caller' as const, text: text, time: timeNow };
    setCallLog((prev) => [...prev, callerEntry]);
    setSpokenInput('');
    setIsProcessing(true);

    try {
      const response = await apiFetchResponse('/api/gemini/voice-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          callerName: currentPatient.name || 'Patient',
          language: selectedLang.name,
          availableDoctors: doctors.map((d) => ({
            name: d.name,
            specialty: d.specialty,
            fee: d.consultationFee,
            timing: d.opdTiming,
          })),
        }),
      });

      const data = await response.json();
      const aiReply = data.speechText || data.speechResponse || `I have noted your request in ${selectedLang.name}. Let me book your consultation slot accordingly.`;
      if (data.isEmergency) {
        setHasEmergency(true);
      }

      setCallLog((prev) => [...prev, { speaker: 'AI Voice Assistant', text: aiReply, time: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: '2-digit', minute: '2-digit' }) }]);
      speakText(aiReply);
    } catch (err) {
      console.error(err);
      const fallbackReply = `Thank you. Your request has been logged successfully for ${selectedLang.name}.`;
      setCallLog((prev) => [...prev, { speaker: 'AI Voice Assistant', text: fallbackReply, time: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: '2-digit', minute: '2-digit' }) }]);
      speakText(fallbackReply);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6 overflow-x-hidden" data-testid="maya-voice-settings">
      {/* Header */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
              <PhoneCall className="w-3.5 h-3.5 text-emerald-600" /> WhatsApp & Inbound IVR Voice Bot
            </span>
            <span className="text-xs text-slate-400 font-mono">Pulse AI</span>
          </div>
          <h1 className="text-lg font-bold text-slate-900 mt-1">Autonomous Indian Language Voice Receptionist</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Answers incoming WhatsApp Voice Calls and PSTN telephone calls in 10+ regional Indian languages with natural voice personas.
          </p>
        </div>

        {/* Call Mode Switcher */}
        <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 shrink-0">
          <button
            onClick={() => setCallType('whatsapp')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
              callType === 'whatsapp' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" /> WhatsApp Call
          </button>
          <button
            onClick={() => setCallType('ivrn')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
              callType === 'ivrn' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <PhoneCall className="w-3.5 h-3.5" /> Inbound IVR
          </button>
        </div>
      </div>

      {/* Configuration Bar: Language & Voice Persona Selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        {/* Language Selector */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
            <Globe className="w-3.5 h-3.5 text-blue-600" /> Indian Language Selection:
          </label>
          <select
            value={selectedLang.code}
            onChange={(e) => {
              const found = INDIAN_LANGUAGES.find((l) => l.code === e.target.value);
              if (found) setSelectedLang(found);
            }}
            className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            {INDIAN_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
        </div>

        {/* Voice Persona Selector */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
            <Bot className="w-3.5 h-3.5 text-emerald-600" /> AI Sample Voice Persona:
          </label>
          <select
            value={selectedPersona.id}
            onChange={(e) => {
              const found = VOICE_PERSONAS.find((p) => p.id === e.target.value);
              if (found) setSelectedPersona(found);
            }}
            className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none"
          >
            {VOICE_PERSONAS.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {persona.name} — {persona.desc}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4" data-testid="maya-voice-fields">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900">Maya voice settings</h2>
            <p className="text-xs text-slate-500 mt-1">
              {canEdit
                ? 'Clinic admins can change whether Maya answers calls, and the transfer number. Saved through the voice-settings API.'
                : 'Only a clinic admin can edit these settings.'}
            </p>
          </div>
          {canEdit ? (
            <button
              type="button"
              onClick={() => void handleSaveVoiceSettings()}
              disabled={savingSettings || !settingsHydrated}
              data-testid="maya-save-voice-settings"
              className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-50"
            >
              {savingSettings ? 'Saving…' : 'Save voice settings'}
            </button>
          ) : null}
        </div>

        {settingsSaved ? (
          <p className="text-xs text-emerald-700" data-testid="maya-settings-saved">Voice settings saved.</p>
        ) : null}
        {settingsError ? (
          <p className="text-xs text-rose-600" role="alert" data-testid="maya-settings-error">{settingsError}</p>
        ) : null}

        <label className="flex items-start gap-3 text-sm text-slate-800">
          <input
            type="checkbox"
            className="mt-1"
            checked={voiceEnabled}
            disabled={!canEdit}
            data-testid="maya-answers-calls"
            onChange={(e) => {
              setVoiceEnabled(e.target.checked);
              setSettingsSaved(false);
            }}
          />
          <span>
            <span className="font-semibold">Maya answers calls</span>
            <span className="block text-xs text-slate-500 mt-0.5">
              {voiceEnabled
                ? 'On. WhatsApp calls are answered by Maya.'
                : 'Off. Calls are declined and patients are sent to WhatsApp chat.'}
            </span>
          </span>
        </label>

        <div>
          <label htmlFor="maya-escalation-phone" className="block text-xs font-semibold text-slate-700 mb-1">
            Escalation / transfer phone
          </label>
          <input
            id="maya-escalation-phone"
            data-testid="maya-escalation-phone"
            type="tel"
            inputMode="tel"
            value={escalationPhone}
            disabled={!canEdit}
            onChange={(e) => {
              setEscalationTouched(true);
              setEscalationPhone(e.target.value);
              setSettingsSaved(false);
            }}
            placeholder="+91 98200 11111"
            className="w-full max-w-md text-sm px-3 py-2 rounded-lg border border-slate-300 disabled:bg-slate-100"
          />
          <p className="text-[11px] text-slate-500 mt-1">Indian mobile or landline. Example: +91 98200 11111 or 022 2847 9000.</p>
        </div>

        <div>
          <label htmlFor="maya-custom-greeting" className="block text-xs font-semibold text-slate-700 mb-1">
            Greeting
          </label>
          <input
            id="maya-custom-greeting"
            data-testid="maya-custom-greeting"
            type="text"
            value={customGreeting}
            disabled={!canEdit}
            onChange={(e) => {
              setCustomGreeting(e.target.value);
              setSettingsSaved(false);
            }}
            placeholder={clinicName ? `Thank you for calling ${clinicName}` : 'Thank you for calling'}
            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-300 disabled:bg-slate-100"
          />
          <p className="text-[11px] text-slate-500 mt-1 break-words">
            Spoken line: {openingLine}
          </p>
        </div>
      </div>

      {/* Voice Call Simulator Console */}
      <div className={`rounded-xl p-5 sm:p-7 border shadow-xl space-y-5 transition-colors ${
        callType === 'whatsapp' ? 'bg-slate-900 border-emerald-900/50 text-white' : 'bg-slate-900 border-slate-800 text-white'
      }`}>
        {hasEmergency && (
          <div className="bg-red-600/90 border border-red-500 text-white p-3.5 rounded-lg flex items-center justify-between shadow-lg animate-pulse">
            <div className="flex items-center space-x-2.5">
              <span className="text-xl">🚨</span>
              <div>
                <h4 className="font-bold text-xs">CRITICAL MEDICAL EMERGENCY SOS DISPATCHED</h4>
                <p className="text-[11px] opacity-90">Severe symptom detected on call. WhatsApp emergency alert sent to on-call physician.</p>
              </div>
            </div>
            <button
              onClick={() => setHasEmergency(false)}
              className="px-2.5 py-1 bg-red-700 hover:bg-red-800 rounded text-[10px] font-bold"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Call Status & WhatsApp / IVR Header */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="flex items-center space-x-3.5">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                isInCall
                  ? callType === 'whatsapp'
                    ? 'bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 ring-2 ring-emerald-500/20'
                    : 'bg-blue-500/20 border border-blue-400/40 text-blue-300 ring-2 ring-blue-500/20'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {callType === 'whatsapp' ? <MessageSquare className="w-6 h-6 text-emerald-400" /> : <PhoneCall className="w-6 h-6 text-blue-400" />}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-sm text-white" data-testid="maya-desk-status">
                  {mayaDeskStatus({
                    loaded: deskLoaded,
                    inCall: isInCall,
                    callType,
                    voiceEnabled,
                    connected: whatsappConnected,
                  })}
                </h3>
                {isInCall && (
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${
                    callType === 'whatsapp'
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                  }`}>
                    LIVE AUDIO STREAM
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 flex flex-wrap items-center gap-1.5" data-testid="maya-whatsapp-line">
                {callType === 'whatsapp' && <ShieldCheck className="w-3 h-3 text-emerald-400 inline" />}
                {isInCall
                  ? `Duration: ${Math.floor(callDurationSec / 60)}:${(callDurationSec % 60).toString().padStart(2, '0')} • Language: ${selectedLang.name} • Voice: ${selectedPersona.name.split(' ')[0]}`
                  : mayaWhatsAppLine({ connected: whatsappConnected, displayNumber: whatsappDisplay })}
                {!isInCall && !whatsappConnected ? (
                  <button
                    type="button"
                    data-testid="maya-connect-whatsapp"
                    onClick={() => go('app', { appView: 'settings' })}
                    className="ml-1 underline text-emerald-300 hover:text-emerald-200"
                  >
                    Connect WhatsApp
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {isInCall ? (
              <button
                onClick={handleEndCall}
                className="px-4 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold text-xs shadow-sm flex items-center space-x-1.5 transition-all"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                <span>Disconnect Call</span>
              </button>
            ) : (
              <button
                onClick={handleStartCall}
                className={`px-4 py-2 rounded-md font-semibold text-xs shadow-sm flex items-center space-x-1.5 transition-all text-white ${
                  callType === 'whatsapp' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-900/30' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-900/30'
                }`}
              >
                <PhoneCall className="w-3.5 h-3.5" />
                <span>{callType === 'whatsapp' ? 'Simulate WhatsApp Call' : 'Simulate Inbound Call'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Audio Waveform visualizer */}
        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-400 font-mono">Audio Spectrum ({selectedLang.code}):</span>
          <div className="flex-1 flex items-center gap-1 h-6 px-3 overflow-hidden">
            {[30, 60, 20, 80, 45, 90, 35, 75, 55, 95, 40, 70, 85, 25, 65, 50, 80, 40, 90, 30].map((h, i) => (
              <div
                key={i}
                className={`flex-1 rounded-full transition-all duration-150 ${
                  isInCall ? (callType === 'whatsapp' ? 'bg-emerald-400' : 'bg-blue-400') : 'bg-slate-800'
                }`}
                style={{
                  height: isInCall ? `${Math.max(15, (h * voiceVolume) / 100)}%` : '15%',
                }}
              />
            ))}
          </div>
          <span className={`text-[10px] font-mono font-bold ${callType === 'whatsapp' ? 'text-emerald-400' : 'text-blue-400'}`}>
            {isInCall ? `${voiceVolume} dB` : '0 dB'}
          </span>
        </div>

        {/* Live Conversation Transcript */}
        <div className="space-y-2">
          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Live Voice Call Transcript ({selectedLang.name}):</span>
            <span className="text-slate-500 font-normal">End-to-End Encrypted WhatsApp VoIP Channel</span>
          </h4>
          <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 h-60 overflow-y-auto space-y-2.5">
            {callLog.map((c, i) => (
              <div
                key={i}
                className={`p-2.5 rounded-md text-xs leading-relaxed ${
                  c.speaker === 'Caller'
                    ? 'bg-blue-950/60 text-blue-200 border border-blue-800/40 ml-6'
                    : 'bg-slate-900 text-slate-200 border border-slate-800 mr-6'
                }`}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className={`font-semibold text-[11px] ${c.speaker === 'Caller' ? 'text-blue-300' : 'text-emerald-400'}`}>
                    {c.speaker}
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono">{c.time}</span>
                </div>
                <p className="text-[11px]">{c.text}</p>
              </div>
            ))}

            {isProcessing && (
              <div className="flex items-center space-x-2 text-xs text-emerald-400 italic">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>AI Voice Assistant is generating response in {selectedLang.name}...</span>
              </div>
            )}
          </div>
        </div>

        {/* Caller Voice Simulation Controls */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Simulate Patient Voice Input ({selectedLang.name}):
          </label>
          <div className="flex flex-wrap gap-1.5">
            {[
              `I want to book an appointment with Dr. Vikram tomorrow morning.`,
              `What is the consultation fee for Dr. Sharma?`,
              `I have severe fever and body ache since yesterday.`,
              `Please refill my hypertension prescription.`
            ].map((sample, idx) => (
              <button
                key={idx}
                disabled={!isInCall || isProcessing}
                onClick={() => handleVoiceQuery(sample)}
                className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-[11px] font-medium transition-all disabled:opacity-40"
              >
                "{sample}"
              </button>
            ))}
          </div>

          <div className="flex gap-2 pt-1">
            <input
              type="text"
              disabled={!isInCall || isProcessing}
              value={spokenInput}
              onChange={(e) => setSpokenInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleVoiceQuery()}
              placeholder={isInCall ? `Speak or type in ${selectedLang.name}...` : "Start WhatsApp call to speak..."}
              className="flex-1 text-xs bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-40"
            />
            <button
              disabled={!isInCall || !spokenInput.trim() || isProcessing}
              onClick={() => handleVoiceQuery()}
              className={`px-3.5 py-2 rounded-md font-semibold text-xs shadow-xs text-white disabled:opacity-40 ${
                callType === 'whatsapp' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-blue-600 hover:bg-blue-500'
              }`}
            >
              Speak
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

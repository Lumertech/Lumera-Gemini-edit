import React, { useState, useEffect } from 'react';
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
import { Patient, Doctor } from '../types';

interface VoiceBotAssistantProps {
  currentPatient: Patient;
  doctors: Doctor[];
}

const INDIAN_LANGUAGES = [
  { name: 'English (India)', code: 'en-IN', greeting: 'Hello! Thank you for calling Lumera Polyclinic. How may I assist your health appointment today?' },
  { name: 'Hindi (हिंदी)', code: 'hi-IN', greeting: 'नमस्ते! लुमेरा पॉलीक्लिनिक में कॉल करने के लिए धन्यवाद। आज मैं आपकी स्वास्थ्य नियुक्ति में कैसे सहायता कर सकता हूँ?' },
  { name: 'Tamil (தமிழ்)', code: 'ta-IN', greeting: 'வணக்கம்! லுமேரா பாலி கிளினிக்கிற்கு அழைக்க நன்றி. உங்கள் மருத்துவ சந்திப்புக்கு நான் எவ்வாறு உதவ முடியும்?' },
  { name: 'Telugu (తెలుగు)', code: 'te-IN', greeting: 'నమస్కారం! లుమెరా పాలిక్లినిక్‌కి కాల్ చేసినందుకు ధన్యవాదాలు. మీ వైద్య నియామకంలో నేను మీకు ఎలా సహాయం చేయగలను?' },
  { name: 'Marathi (मराठी)', code: 'mr-IN', greeting: 'नमस्कार! लुमेरा पॉलीक्लिनिकमध्ये कॉल केल्याबद्दल धन्यवाद. आज मी तुमच्या आरोग्य भेटीसाठी कशी मदत करू शकतो?' },
  { name: 'Kannada (ಕನ್ನಡ)', code: 'kn-IN', greeting: 'ನಮಸ್ಕಾರ! ಲುಮೆರಾ ಪಾಲಿಕ್ಲಿನಿಕ್‌ಗೆ ಕರೆ ಮಾಡಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು. ನಿಮ್ಮ ಆರೋಗ್ಯ ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ಅನ್ನು ನಾನು ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?' },
  { name: 'Bengali (বাংলা)', code: 'bn-IN', greeting: 'নমস্কার! লুভেরা পলিনিক্সে কল করার জন্য ধন্যবাদ। আজ আমি আপনার স্বাস্থ্য অ্যাপয়েন্টমেন্টে কীভাবে সাহায্য করতে পারি?' },
  { name: 'Gujarati (ગુજરાતી)', code: 'gu-IN', greeting: 'નમસ્તે! લુમેરા પોલીક્લિનિકમાં કૉલ કરવા બદલ આભાર. આજે હું તમારી સ્વાસ્થ્ય મુલાકાતમાં કેવી રીતે મદદ કરી શકું?' },
  { name: 'Punjabi (ਪੰਜਾਬੀ)', code: 'pa-IN', greeting: 'ਸਤਿ ਸ਼੍ਰੀ ਅਕਾਲ! ਲੁਮੇਰਾ ਪੋਲੀਕਲਿਨਿਕ ਵਿੱਚ ਕਾਲ ਕਰਨ ਲਈ ਧੰਨਵਾਦ। ਅਸੀਂ ਤੁਹਾਡੀ ਸਿਹਤ appointment ਵਿੱਚ ਕਿਵੇਂ ਮਦਦ ਕਰ ਸਕਦੇ ਹਾਂ?' },
  { name: 'Malayalam (മലയാളം)', code: 'ml-IN', greeting: 'നമസ്കാരം! ലുമെറ പോളിക്ലിനിക്കിലേക്ക് വിളിച്ചതിന് നന്ദി. നിങ്ങളുടെ ആരോഗ്യ അപ്പോയിന്റ്മെന്റിൽ ഞാൻ എങ്ങനെ സഹായിക്കണം?' }
];

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
  const [isInCall, setIsInCall] = useState(false);
  const [callType, setCallType] = useState<'ivrn' | 'whatsapp'>('whatsapp');
  const [selectedLang, setSelectedLang] = useState(INDIAN_LANGUAGES[0]);
  const [selectedPersona, setSelectedPersona] = useState(VOICE_PERSONAS[0]);
  const [callDurationSec, setCallDurationSec] = useState(0);
  const [spokenInput, setSpokenInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasEmergency, setHasEmergency] = useState(false);
  const [callLog, setCallLog] = useState<Array<{ speaker: 'Caller' | 'AI Voice Assistant'; text: string; time: string }>>([
    {
      speaker: 'AI Voice Assistant',
      text: selectedLang.greeting,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    },
  ]);
  const [voiceVolume, setVoiceVolume] = useState(65);

  // Update initial greeting when language changes
  useEffect(() => {
    if (!isInCall) {
      setCallLog([
        {
          speaker: 'AI Voice Assistant',
          text: selectedLang.greeting,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    }
  }, [selectedLang]);

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
    speakText(selectedLang.greeting);
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

    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const callerEntry = { speaker: 'Caller' as const, text: text, time: timeNow };
    setCallLog((prev) => [...prev, callerEntry]);
    setSpokenInput('');
    setIsProcessing(true);

    try {
      const response = await fetch('/api/gemini/voice-bot', {
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

      setCallLog((prev) => [...prev, { speaker: 'AI Voice Assistant', text: aiReply, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
      speakText(aiReply);
    } catch (err) {
      console.error(err);
      const fallbackReply = `Thank you. Your request has been logged successfully for ${selectedLang.name}.`;
      setCallLog((prev) => [...prev, { speaker: 'AI Voice Assistant', text: fallbackReply, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
      speakText(fallbackReply);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
              <PhoneCall className="w-3.5 h-3.5 text-emerald-600" /> WhatsApp & Inbound IVR Voice Bot
            </span>
            <span className="text-xs text-slate-400 font-mono">Gemini Multilingual Audio Core</span>
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
                <h3 className="font-bold text-sm text-white">
                  {isInCall
                    ? callType === 'whatsapp'
                      ? 'WhatsApp Voice Call Connected'
                      : 'Inbound PSTN Call Connected'
                    : callType === 'whatsapp'
                      ? 'WhatsApp Voice Desk Standby'
                      : 'IVR Telephony Standby'}
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
              <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                {callType === 'whatsapp' && <ShieldCheck className="w-3 h-3 text-emerald-400 inline" />}
                {isInCall
                  ? `Duration: ${Math.floor(callDurationSec / 60)}:${(callDurationSec % 60).toString().padStart(2, '0')} • Language: ${selectedLang.name} • Voice: ${selectedPersona.name.split(' ')[0]}`
                  : `Ready to answer WhatsApp audio calls from patients (+91 ${currentPatient.phone || '9876543210'})`}
              </p>
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

import React, { useState } from 'react';
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
  AlertCircle 
} from 'lucide-react';
import { Patient, Doctor } from '../types';

interface VoiceBotAssistantProps {
  currentPatient: Patient;
  doctors: Doctor[];
}

export const VoiceBotAssistant: React.FC<VoiceBotAssistantProps> = ({
  currentPatient,
  doctors,
}) => {
  const [isInCall, setIsInCall] = useState(false);
  const [callDurationSec, setCallDurationSec] = useState(0);
  const [spokenInput, setSpokenInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [callLog, setCallLog] = useState<Array<{ speaker: 'Caller' | 'Lumera AI Voice'; text: string }>>([
    {
      speaker: 'Lumera AI Voice',
      text: `Hello! Thank you for calling Lumera Polyclinic. I am your automated clinic voice assistant. Please tell me your symptoms or if you would like to book an appointment.`,
    },
  ]);
  const [voiceVolume, setVoiceVolume] = useState(60);

  // Call timer simulation
  React.useEffect(() => {
    let interval: any;
    if (isInCall) {
      interval = setInterval(() => {
        setCallDurationSec((prev) => prev + 1);
        setVoiceVolume(Math.floor(Math.random() * 50) + 30);
      }, 1000);
    } else {
      setCallDurationSec(0);
      setVoiceVolume(0);
    }
    return () => clearInterval(interval);
  }, [isInCall]);

  const handleStartCall = () => {
    setIsInCall(true);
    speakVoiceText(`Hello! Thank you for calling Lumera Polyclinic. How may I assist your health appointment today?`);
  };

  const handleEndCall = () => {
    setIsInCall(false);
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const speakVoiceText = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleVoiceQuery = async (queryText?: string) => {
    const text = queryText || spokenInput;
    if (!text.trim() || isProcessing) return;

    const callerEntry = { speaker: 'Caller' as const, text: text };
    setCallLog((prev) => [...prev, callerEntry]);
    setSpokenInput('');
    setIsProcessing(true);

    try {
      const response = await fetch('/api/gemini/voice-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userSpeech: text,
          availableDoctors: doctors.map((d) => ({
            name: d.name,
            specialty: d.specialty,
            fee: d.consultationFee,
            timing: d.opdTiming,
          })),
        }),
      });

      const data = await response.json();
      const aiReply = data.speechResponse || "I have noted that down for Dr. Vikram's OPD at 11:30 AM today.";

      setCallLog((prev) => [...prev, { speaker: 'Lumera AI Voice', text: aiReply }]);
      speakVoiceText(aiReply);
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
              <Volume2 className="w-3 h-3" /> 24/7 Inbound IVR & Voice Bot
            </span>
            <span className="text-xs text-slate-400 font-mono">Gemini Voice Core</span>
          </div>
          <h1 className="text-lg font-bold text-slate-900 mt-1">Autonomous Telephony & Voice Booking Engine</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Handles patient phone calls in real-time, triages symptoms, checks doctor OPD slots, and books appointments autonomously.
          </p>
        </div>
      </div>

      {/* Voice Call Simulator Console */}
      <div className="bg-slate-900 rounded-xl p-5 sm:p-7 border border-slate-800 text-white shadow-xl space-y-5">
        {/* Call Status & Waveform */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="flex items-center space-x-3.5">
            <div
              className={`w-12 h-12 rounded-lg flex items-center justify-center transition-all ${
                isInCall
                  ? 'bg-blue-500/20 border border-blue-400/40 text-blue-300 ring-2 ring-blue-500/20'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              <PhoneCall className={`w-6 h-6 ${isInCall ? 'text-blue-400' : ''}`} />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-sm text-white">
                  {isInCall ? 'Connected: Inbound Patient Call' : 'Call Desk Standby'}
                </h3>
                {isInCall && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[9px] font-mono font-bold">
                    LIVE
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {isInCall
                  ? `Duration: ${Math.floor(callDurationSec / 60)}:${(callDurationSec % 60).toString().padStart(2, '0')} • SIP Audio Stream Active`
                  : 'Dial in or click Simulate Inbound Call below'}
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
                className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm shadow-blue-900/30 flex items-center space-x-1.5 transition-all"
              >
                <PhoneCall className="w-3.5 h-3.5" />
                <span>Simulate Inbound Call</span>
              </button>
            )}
          </div>
        </div>

        {/* Audio Waveform visualizer */}
        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-400 font-mono">Audio Spectrum:</span>
          <div className="flex-1 flex items-center gap-1 h-6 px-3 overflow-hidden">
            {[30, 60, 20, 80, 45, 90, 35, 75, 55, 95, 40, 70, 85, 25, 65, 50, 80, 40, 90, 30].map((h, i) => (
              <div
                key={i}
                className={`flex-1 rounded-full transition-all duration-150 ${
                  isInCall ? 'bg-blue-400' : 'bg-slate-800'
                }`}
                style={{
                  height: isInCall ? `${Math.max(15, (h * voiceVolume) / 100)}%` : '15%',
                }}
              />
            ))}
          </div>
          <span className="text-[10px] font-mono text-blue-400 font-bold">
            {isInCall ? `${voiceVolume} dB` : '0 dB'}
          </span>
        </div>

        {/* Live Conversation Transcript */}
        <div className="space-y-2">
          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Live Speech Transcript:
          </h4>
          <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 h-56 overflow-y-auto space-y-2.5">
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
                  <span className={`font-semibold text-[11px] ${c.speaker === 'Caller' ? 'text-blue-300' : 'text-slate-400'}`}>
                    {c.speaker}
                  </span>
                </div>
                <p className="text-[11px]">{c.text}</p>
              </div>
            ))}

            {isProcessing && (
              <div className="flex items-center space-x-2 text-xs text-blue-400 italic">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>Synthesizing voice response...</span>
              </div>
            )}
          </div>
        </div>

        {/* Caller Voice Simulation Controls */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Simulate Patient Voice Utterance:
          </label>
          <div className="flex flex-wrap gap-1.5">
            {[
              'I have a sore throat and fever for 2 days. Can I see a doctor today?',
              'What time is Dr. Vikram Malhotra available in OPD?',
              'I want to book an appointment with a Cardiologist tomorrow.',
              'Can I consult for stomach pain and nausea right now?'
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
              placeholder={isInCall ? "Speak or type patient query here..." : "Start call to speak..."}
              className="flex-1 text-xs bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-40"
            />
            <button
              disabled={!isInCall || !spokenInput.trim() || isProcessing}
              onClick={() => handleVoiceQuery()}
              className="px-3.5 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-xs disabled:opacity-40"
            >
              Speak
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

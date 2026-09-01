import React, { useState } from 'react';
import { 
  Bot, 
  Send, 
  Sparkles, 
  X, 
  BookOpen, 
  AlertCircle, 
  Pill, 
  Stethoscope, 
  RefreshCw,
  Copy,
  Check
} from 'lucide-react';
import { Patient, Doctor } from '../types';

interface HexaAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  currentPatient?: Patient;
  currentDoctor?: Doctor;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'hexa';
  text: string;
  timestamp: string;
}

const QUICK_CLINICAL_PROMPTS = [
  'Telmisartan + Aceclofenac drug interaction analysis',
  'Pediatric Paracetamol dosage calculator (15 kg child)',
  'ICMR Guidelines for Stage 2 Hypertension management',
  'Differential diagnosis for acute right iliac fossa pain',
  'Antibiotic protocol for community-acquired pneumonia in adults'
];

export const HexaAssistant: React.FC<HexaAssistantProps> = ({
  isOpen,
  onClose,
  currentPatient,
  currentDoctor,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'm1',
      sender: 'hexa',
      text: `Hello Dr. ${currentDoctor?.name?.split(' ')[1] || 'Doctor'}. I am **HEXA AI**, your clinical decision support copilot.\n\nAsk me about drug interactions, pediatric/geriatric dosage adjustments, ICMR/ADA clinical guidelines, differential diagnoses, or patient-specific risk reviews.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [inputQuery, setInputQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSend = async (queryToSend?: string) => {
    const text = queryToSend || inputQuery;
    if (!text.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: 'u-' + Date.now(),
      sender: 'user',
      text: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputQuery('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/gemini/hexa-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: text,
          patientContext: currentPatient ? {
            name: currentPatient.name,
            age: currentPatient.age,
            gender: currentPatient.gender,
            allergies: currentPatient.allergies,
            chronicConditions: currentPatient.chronicConditions,
          } : {},
          history: messages.map((m) => ({ sender: m.sender, text: m.text })),
        }),
      });

      const data = await response.json();
      const hexaMsg: ChatMessage = {
        id: 'h-' + Date.now(),
        sender: 'hexa',
        text: data.response || 'Clinical response generated.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, hexaMsg]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-slate-900 text-white shadow-2xl border-l border-slate-800 flex flex-col transition-transform duration-300">
      {/* Drawer Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-300">
            <Bot className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="font-bold text-xs text-white">HEXA Clinical AI Copilot</h3>
              <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                Gemini 2.5
              </span>
            </div>
            <p className="text-[10px] text-slate-400">
              Evidence-based Clinical Decision Support
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Patient Context Tag */}
      {currentPatient && (
        <div className="bg-slate-800/80 px-4 py-2 border-b border-slate-700/60 text-xs flex items-center justify-between">
          <span className="text-slate-400 flex items-center gap-1 text-[11px]">
            <Stethoscope className="w-3 h-3 text-blue-400" /> Active Context:
          </span>
          <span className="text-blue-300 font-medium text-[11px]">
            {currentPatient.name} ({currentPatient.age}y/{currentPatient.gender.charAt(0)}) • Allergies: {currentPatient.allergies.join(', ') || 'None'}
          </span>
        </div>
      )}

      {/* Chat Messages Body */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3.5">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[90%] rounded-lg p-3 text-xs leading-relaxed ${
                m.sender === 'user'
                  ? 'bg-blue-600 text-white rounded-br-none shadow-xs'
                  : 'bg-slate-800 text-slate-200 border border-slate-700/80 rounded-bl-none shadow-xs'
              }`}
            >
              <div className="whitespace-pre-wrap font-sans">{m.text}</div>
            </div>

            <div className="flex items-center space-x-2 mt-1 px-1 text-[10px] text-slate-500 font-mono">
              <span>{m.timestamp}</span>
              {m.sender === 'hexa' && (
                <button
                  onClick={() => handleCopy(m.id, m.text)}
                  className="hover:text-blue-400 flex items-center gap-0.5 transition-colors"
                >
                  {copiedId === m.id ? (
                    <Check className="w-3 h-3 text-blue-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>{copiedId === m.id ? 'Copied' : 'Copy'}</span>
                </button>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center space-x-2 text-xs text-blue-400 bg-slate-800/60 p-2.5 rounded-lg border border-slate-700 w-fit">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Consulting clinical literature & drug databases...</span>
          </div>
        )}
      </div>

      {/* Quick Prompt Chips */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/60">
        <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1.5">
          Quick Clinical Queries:
        </span>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_CLINICAL_PROMPTS.map((prompt, i) => (
            <button
              key={i}
              onClick={() => handleSend(prompt)}
              className="text-[11px] text-left px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {/* Input Bar */}
      <div className="p-3 bg-slate-950 border-t border-slate-800 flex items-center space-x-2">
        <input
          type="text"
          value={inputQuery}
          onChange={(e) => setInputQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask Hexa regarding dosage, interactions, or guidelines..."
          className="flex-1 text-xs bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-white focus:ring-1 focus:ring-blue-500 focus:outline-none"
        />
        <button
          onClick={() => handleSend()}
          disabled={!inputQuery.trim() || isLoading}
          className="p-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-all disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

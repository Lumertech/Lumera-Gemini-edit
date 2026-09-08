import React, { useState } from 'react';
import { 
  Send, 
  Sparkles, 
  X, 
  BookOpen, 
  AlertCircle, 
  Pill, 
  Stethoscope, 
  RefreshCw,
  Copy,
  Check,
  Zap,
  Info
} from 'lucide-react';
import { Patient, Doctor } from '../types';

export interface GeminiAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  currentPatient?: Patient;
  currentDoctor?: Doctor;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'gemini';
  text: string;
  timestamp: string;
  source?: string;
}

const QUICK_CLINICAL_PROMPTS = [
  'Telmisartan + Aceclofenac drug interaction analysis',
  'Pediatric Paracetamol dosage calculator (15 kg child)',
  'ICMR Guidelines for Stage 2 Hypertension management',
  'Differential diagnosis for acute right iliac fossa pain',
  'Antibiotic protocol for community-acquired pneumonia in adults',
  'Analyze active patient profile for drug contraindications'
];

export const GeminiAssistant: React.FC<GeminiAssistantProps> = ({
  isOpen,
  onClose,
  currentPatient,
  currentDoctor,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'm1',
      sender: 'gemini',
      text: `Hello Dr. ${currentDoctor?.name?.split(' ')[1] || 'Doctor'}. I am **Pulse AI**, an advanced enterprise clinical decision support copilot powered by Google Gemini.\n\nI provide real-time clinical decision support: cross-checking drug-drug interactions, pediatric/geriatric dosage adjustments, ICMR/ADA clinical guidelines, and patient-specific risk reviews.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      source: 'Pulse AI (Gemini 3.8 Flash)',
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
      const response = await fetch('/api/gemini/copilot', {
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
          history: messages.map((m) => ({ sender: m.sender === 'gemini' ? 'model' : 'user', text: m.text })),
        }),
      });

      const data = await response.json();
      const geminiMsg: ChatMessage = {
        id: 'g-' + Date.now(),
        sender: 'gemini',
        text: data.response || 'Clinical response generated.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        source: data.source || 'Gemini 3.8 Flash',
      };
      setMessages((prev) => [...prev, geminiMsg]);
    } catch (err) {
      console.error('Pulse AI copilot query error:', err);
      const errorMsg: ChatMessage = {
        id: 'g-' + Date.now(),
        sender: 'gemini',
        text: '⚠️ Unable to connect to Pulse AI Clinical Copilot. Please check your network connection and retry.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
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
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/20 via-indigo-500/20 to-blue-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300">
            <Sparkles className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="font-bold text-xs text-white">Pulse AI — Clinical Decision Support</h3>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-gradient-to-r from-purple-500/20 to-indigo-500/20 text-purple-300 border border-purple-500/30">
                Gemini 3.8 Flash
              </span>
            </div>
            <p className="text-[10px] text-slate-400">
              Evidence-based Clinical Decision Support powered by Google Gemini
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title="Close Pulse AI Copilot"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Patient Context Tag */}
      {currentPatient && (
        <div className="bg-slate-800/80 px-4 py-2 border-b border-slate-700/60 text-xs flex items-center justify-between">
          <span className="text-slate-400 flex items-center gap-1 text-[11px]">
            <Stethoscope className="w-3 h-3 text-cyan-400" /> Active Context:
          </span>
          <span className="text-cyan-300 font-medium text-[11px] truncate max-w-[280px]">
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
              className={`max-w-[92%] rounded-lg p-3 text-xs leading-relaxed ${
                m.sender === 'user'
                  ? 'bg-blue-600 text-white rounded-br-none shadow-xs'
                  : 'bg-slate-800/90 text-slate-200 border border-slate-700/80 rounded-bl-none shadow-xs'
              }`}
            >
              <div className="whitespace-pre-wrap font-sans">{m.text}</div>
            </div>

            <div className="flex items-center space-x-2 mt-1 px-1 text-[10px] text-slate-500 font-mono">
              <span>{m.timestamp}</span>
              {m.source && (
                <span className="text-cyan-400/80">via {m.source}</span>
              )}
              {m.sender === 'gemini' && (
                <button
                  onClick={() => handleCopy(m.id, m.text)}
                  className="hover:text-cyan-400 flex items-center gap-0.5 transition-colors"
                >
                  {copiedId === m.id ? (
                    <Check className="w-3 h-3 text-cyan-400" />
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
          <div className="flex items-center space-x-2 text-xs text-purple-300 bg-slate-800/60 p-2.5 rounded-lg border border-slate-700 w-fit">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-400" />
            <span>Consulting Pulse AI & Google Gemini clinical knowledge base...</span>
          </div>
        )}
      </div>

      {/* Quick Prompt Chips */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/60">
        <span className="text-[10px] text-slate-400 uppercase font-bold flex items-center gap-1 mb-1.5">
          <Zap className="w-3 h-3 text-purple-400" /> Quick Clinical Queries:
        </span>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_CLINICAL_PROMPTS.map((prompt, i) => (
            <button
              key={i}
              onClick={() => handleSend(prompt)}
              className="text-[11px] text-left px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition-colors"
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
          placeholder="Ask Pulse AI about drug interactions, pediatric dosage, or ICMR guidelines..."
          className="flex-1 text-xs bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-white placeholder-slate-500 focus:ring-1 focus:ring-purple-500 focus:outline-none"
        />
        <button
          onClick={() => handleSend()}
          disabled={!inputQuery.trim() || isLoading}
          className="p-2 rounded-md bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold transition-all disabled:opacity-50"
          title="Send to Pulse AI"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export const PulseAssistant = GeminiAssistant;
export type PulseAssistantProps = GeminiAssistantProps;

// Export as alias for backwards compatibility
export const HexaAssistant = GeminiAssistant;
export type HexaAssistantProps = GeminiAssistantProps;

import React, { useState } from 'react';
import { 
  Send, 
  Bot, 
  User, 
  Calendar, 
  FileText, 
  CheckCircle2, 
  Clock, 
  Download, 
  MessageSquare, 
  Smartphone, 
  Sparkles,
  PhoneCall
} from 'lucide-react';
import { Patient, Doctor } from '../types';

interface WhatsAppAssistantProps {
  currentPatient: Patient;
  doctors: Doctor[];
}

interface WAMessage {
  id: string;
  sender: 'bot' | 'user';
  text: string;
  time: string;
  buttons?: string[];
  media?: {
    type: 'pdf' | 'image';
    title: string;
  };
}

export const WhatsAppAssistant: React.FC<WhatsAppAssistantProps> = ({
  currentPatient,
  doctors,
}) => {
  const [messages, setMessages] = useState<WAMessage[]>([
    {
      id: 'w1',
      sender: 'bot',
      text: `Namaste ${currentPatient.name}! 🙏 Welcome to *Lumera Polyclinic WhatsApp Health Desk*.\n\nHow can we help you today?`,
      time: '10:15 AM',
      buttons: ['📅 Book Doctor Appointment', '💊 Refill / View Prescription', '🔬 Download Lab Reports', '⏰ Check Doctor Timings'],
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const handleSendMessage = (textToSend?: string) => {
    const text = textToSend || inputText;
    if (!text.trim()) return;

    const userMsg: WAMessage = {
      id: 'w-' + Date.now(),
      sender: 'user',
      text: text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setIsTyping(true);

    // Simulate smart clinical bot logic
    setTimeout(() => {
      let botResponse: WAMessage;
      const lower = text.toLowerCase();

      if (lower.includes('book') || lower.includes('appointment')) {
        botResponse = {
          id: 'w-bot-' + Date.now(),
          sender: 'bot',
          text: `We have slots available today for *Dr. Vikram Malhotra* (General Medicine, OPD 101) and *Dr. Rajesh Sharma* (Cardiology, OPD 201).\n\nPlease select your preferred doctor:`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          buttons: ['Dr. Vikram Malhotra (11:30 AM)', 'Dr. Rajesh Sharma (02:00 PM)', 'Pediatrics (Dr. Ananya Sen)'],
        };
      } else if (lower.includes('vikram') || lower.includes('11:30')) {
        botResponse = {
          id: 'w-bot-' + Date.now(),
          sender: 'bot',
          text: `✅ *Appointment Confirmed!* \n\nPatient: *${currentPatient.name}*\nUHID: *${currentPatient.uhid}*\nDoctor: *Dr. Vikram Malhotra*\nDate: *Today*\nTime: *11:30 AM*\nRoom: *OPD 101*\nToken: *#07*\n\nPlease arrive 10 minutes prior for vitals triage.`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          buttons: ['📍 Get Google Maps Location', '❌ Reschedule'],
        };
      } else if (lower.includes('prescription') || lower.includes('refill')) {
        botResponse = {
          id: 'w-bot-' + Date.now(),
          sender: 'bot',
          text: `Here is your latest verified digital prescription from *Dr. Vikram Malhotra* dated *${new Date().toLocaleDateString()}*.`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          media: {
            type: 'pdf',
            title: `Prescription_RX_2026_${currentPatient.uhid}.pdf`,
          },
          buttons: ['Order via Pharmacy Delivery', 'Ask a Medicine Question'],
        };
      } else if (lower.includes('lab') || lower.includes('report')) {
        botResponse = {
          id: 'w-bot-' + Date.now(),
          sender: 'bot',
          text: `Your recent lab tests (*Complete Blood Count & HbA1c*) have been validated by the pathologist.`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          media: {
            type: 'pdf',
            title: `Lab_Report_CBC_HbA1c_${currentPatient.uhid}.pdf`,
          },
          buttons: ['Book Doctor Review Call', 'Download All Previous Tests'],
        };
      } else {
        botResponse = {
          id: 'w-bot-' + Date.now(),
          sender: 'bot',
          text: `Thank you for your message. For immediate clinical emergencies, please dial our 24x7 desk at *+91 98765 43210* or visit our emergency suite.`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          buttons: ['📅 Book Doctor Appointment', '💊 View Prescription'],
        };
      }

      setMessages((prev) => [...prev, botResponse]);
      setIsTyping(false);
    }, 700);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Top Description */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
              <Smartphone className="w-3 h-3" /> WhatsApp Business API Engine
            </span>
            <span className="text-xs text-slate-400 font-mono">End-to-End Encrypted</span>
          </div>
          <h1 className="text-lg font-bold text-slate-900 mt-1">Automated Patient WhatsApp Health Assistant</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Automates appointment bookings, prescription downloads, token notifications, and lab reports over WhatsApp.
          </p>
        </div>
      </div>

      {/* WhatsApp Interface Simulation */}
      <div className="bg-slate-50 p-2 sm:p-5 rounded-2xl border border-slate-200 max-w-xl mx-auto shadow-md">
        {/* Phone Frame */}
        <div className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800 shadow-inner flex flex-col h-[600px]">
          {/* WhatsApp Header */}
          <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 text-white flex items-center justify-between shadow-xs">
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold shadow-xs">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-xs leading-tight text-white">Lumera Polyclinic Bot</h3>
                <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Online • Verified Health Account
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-2 text-slate-400">
              <PhoneCall className="w-4 h-4 cursor-pointer hover:text-white" />
            </div>
          </div>

          {/* Chat Messages Body */}
          <div className="flex-1 p-4 overflow-y-auto bg-slate-950 space-y-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg p-3 text-xs leading-relaxed ${
                    m.sender === 'user'
                      ? 'bg-blue-600 text-white rounded-br-none shadow-xs'
                      : 'bg-slate-800 text-slate-100 border border-slate-700/80 rounded-bl-none shadow-xs'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{m.text}</div>

                  {/* Media attachment preview */}
                  {m.media && (
                    <div className="mt-2.5 p-2 bg-slate-900 rounded-md border border-slate-700 flex items-center justify-between">
                      <div className="flex items-center space-x-2 text-red-400">
                        <FileText className="w-4 h-4" />
                        <span className="font-mono text-[11px] text-white truncate max-w-[150px]">
                          {m.media.title}
                        </span>
                      </div>
                      <button className="p-1 rounded bg-blue-600 text-white hover:bg-blue-500">
                        <Download className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Quick Action Buttons */}
                {m.buttons && (
                  <div className="flex flex-wrap gap-1.5 mt-2 max-w-[85%]">
                    {m.buttons.map((btn, i) => (
                      <button
                        key={i}
                        onClick={() => handleSendMessage(btn)}
                        className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-blue-900/80 text-blue-300 hover:text-white border border-blue-700/40 text-[11px] font-medium transition-all shadow-xs"
                      >
                        {btn}
                      </button>
                    ))}
                  </div>
                )}

                <span className="text-[10px] text-slate-500 mt-1 px-1 font-mono">{m.time}</span>
              </div>
            ))}

            {isTyping && (
              <div className="flex items-center space-x-1.5 text-xs text-blue-400 bg-slate-800 px-2.5 py-1.5 rounded-md w-fit">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:0.2s]"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:0.4s]"></span>
              </div>
            )}
          </div>

          {/* Message Input Footer */}
          <div className="p-2.5 bg-slate-900 border-t border-slate-800 flex items-center space-x-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Type a message or select an option above..."
              className="flex-1 text-xs bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={() => handleSendMessage()}
              disabled={!inputText.trim()}
              className="p-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-all disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

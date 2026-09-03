import React, { useState, useEffect, useRef } from 'react';
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
  PhoneCall,
  Mic,
  Volume2,
  Users,
  Shield,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  Search,
  Check,
  ChevronDown,
  Layers,
  Globe,
  Radio,
  ExternalLink,
  Eye,
  Lock,
  Unlock,
  CornerDownRight,
  SlidersHorizontal,
  Stethoscope
} from 'lucide-react';
import { Patient, Doctor } from '../types';
import { DocumentPreviewModal, DocumentPreviewData } from './whatsapp/DocumentPreviewModal';
import { OutboundTriggerPanel } from './whatsapp/OutboundTriggerPanel';

interface WhatsAppAssistantProps {
  currentPatient: Patient;
  doctors: Doctor[];
}

interface ConversationItem {
  id: string;
  patient_phone: string;
  patient_name: string;
  patient_uhid: string;
  last_message: string;
  last_message_time: string;
  unread_count: number;
  handover_mode: 'bot' | 'human';
  assigned_staff: string | null;
  tag: string | null;
}

interface ChatMessage {
  id: string;
  conversation_id: string;
  patient_phone: string;
  sender: 'bot' | 'user' | 'system';
  staff_name?: string | null;
  content: string;
  translated_content?: string | null;
  detected_language?: string | null;
  time_display: string;
  buttons?: string[] | null;
  media?: {
    type: 'pdf' | 'image';
    title: string;
    url?: string;
    size?: string;
    subtitle?: string;
    previewData?: any;
  } | null;
  status: string;
  created_at: string;
}

const SAMPLE_VOICE_PROMPTS = [
  {
    lang: 'Hindi (हिन्दी)',
    code: 'hi',
    text: 'नमस्ते डॉक्टर साहब, मेरी कमर में नीचे बहुत तेज दर्द हो रहा है और यह पैर तक खिंच रहा है। क्या मुझे फिजियोथेरेपी करवानी चाहिए?',
    label: 'Hindi: Severe Lower Back & Sciatica Complaint',
  },
  {
    lang: 'Marathi (मराठी)',
    code: 'mr',
    text: 'नमस्कार डॉक्टर, मला माझी कालची रक्त तपासणी रिपोर्ट मिळाली आहे. साखर थोडी जास्त दिसत आहे, कृपया काय करावे ते सांगा.',
    label: 'Marathi: Elevated Blood Sugar Report Query',
  },
  {
    lang: 'Kannada (ಕನ್ನಡ)',
    code: 'kn',
    text: 'ನಮಸ್ಕಾರ ವೈದ್ಯರೇ, ನನ್ನ ಕಾಲು ನೋವು ಕಡಿಮೆಯಾಗಿಲ್ಲ. ಮುಂದಿನ ಭೇಟಿಗಾಗಿ ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ಕಾಯ್ದಿರಿಸಲು ಸಹಾಯ ಮಾಡಿ.',
    label: 'Kannada: Persistent Leg Pain & Slot Request',
  },
  {
    lang: 'English (Indian Clinical)',
    code: 'en',
    text: 'Hello Dr. Siddharth, I have completed 5 sessions of cervical traction. The neck stiffness has reduced by 70%. Should I proceed with isometric exercises?',
    label: 'English: Post-Physiotherapy Rehab Progress Note',
  },
];

const CLINIC_STAFF_MEMBERS = [
  { name: 'Meera Sen', role: 'Front Desk Lead' },
  { name: 'Dr. Siddharth Varma', role: 'Physiotherapy & Rehab Head' },
  { name: 'Nurse Anjali Rao', role: 'OPD Triage Nurse' },
  { name: 'Vikram Mehta', role: 'Patient Relations' },
];

const CANNED_STAFF_REPLIES = [
  '✅ Your OPD token has been prioritized. Please approach Room 105.',
  '📋 Your signed digital prescription and invoice have been dispatched to your WhatsApp.',
  '🩺 Dr. Siddharth has reviewed your recent imaging. Please report for your clinical review.',
  '💊 We have notified the in-house pharmacy; your prescribed medications are ready for pickup.',
];

export const WhatsAppAssistant: React.FC<WhatsAppAssistantProps> = ({
  currentPatient,
  doctors,
}) => {
  // Navigation tabs: 'chat' (Patient Simulator), 'inbox' (Staff 2-Way Dashboard), 'outbound' (Trigger Engine)
  const [activeTab, setActiveTab] = useState<'chat' | 'inbox' | 'outbound'>('chat');

  // Conversations and active thread
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConvId, setActiveConvId] = useState<string>('conv-rajiv');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);

  // Active Staff Persona for Staff Dashboard
  const [currentStaff, setCurrentStaff] = useState<string>('Meera Sen (Front Desk)');

  // Input state
  const [inputText, setInputText] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [isTyping, setIsTyping] = useState<boolean>(false);

  // Document Preview Modal State
  const [previewDocument, setPreviewDocument] = useState<DocumentPreviewData | null>(null);

  // Voice Note Modal / State
  const [isRecordingAudio, setIsRecordingAudio] = useState<boolean>(false);
  const [voiceProcessing, setVoiceProcessing] = useState<boolean>(false);
  const [voiceResult, setVoiceResult] = useState<any>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // 1. Fetch conversations list
  const loadConversations = async () => {
    try {
      const res = await fetch('/api/whatsapp/conversations');
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  };

  // 2. Fetch messages for active conversation
  const loadMessages = async (convId: string) => {
    try {
      setLoadingMessages(true);
      const res = await fetch(`/api/whatsapp/messages/${convId}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setLoadingMessages(false);
      setTimeout(scrollToBottom, 100);
    }
  };

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (activeConvId) {
      loadMessages(activeConvId);
    }
  }, [activeConvId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const activeConversation = conversations.find((c) => c.id === activeConvId) || conversations[0];
  const activePatientPhone = activeConversation ? activeConversation.patient_phone : currentPatient.phone;
  const activePatientName = activeConversation ? activeConversation.patient_name : currentPatient.name;
  const isHumanHandover = activeConversation ? activeConversation.handover_mode === 'human' : false;

  // Handle Sending a Message (Patient or Staff)
  const handleSendMessage = async (textToSend?: string, overrideSender?: 'user' | 'bot') => {
    const content = textToSend || inputText;
    if (!content.trim()) return;

    const sender = overrideSender || (activeTab === 'inbox' ? 'bot' : 'user');
    const staffName = sender === 'bot' && isHumanHandover ? currentStaff : undefined;

    setIsSending(true);
    setInputText('');

    if (sender === 'user' && !isHumanHandover) {
      setIsTyping(true);
    }

    try {
      const res = await fetch('/api/whatsapp/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeConvId,
          patientPhone: activePatientPhone,
          patientName: activePatientName,
          sender,
          staffName,
          content,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Append sent message
        if (data.sentMessage) {
          setMessages((prev) => [
            ...prev,
            {
              id: data.sentMessage.id,
              conversation_id: activeConvId,
              patient_phone: activePatientPhone,
              sender: data.sentMessage.sender,
              staff_name: data.sentMessage.staffName,
              content: data.sentMessage.content,
              translated_content: data.sentMessage.translatedContent,
              detected_language: data.sentMessage.detectedLanguage,
              time_display: data.sentMessage.time,
              buttons: data.sentMessage.buttons,
              media: data.sentMessage.media,
              status: 'delivered',
              created_at: data.sentMessage.createdAt,
            },
          ]);
        }

        // If bot replied automatically
        if (data.botReply) {
          setTimeout(() => {
            setMessages((prev) => [
              ...prev,
              {
                id: data.botReply.id,
                conversation_id: activeConvId,
                patient_phone: activePatientPhone,
                sender: 'bot',
                content: data.botReply.content,
                time_display: data.botReply.time,
                buttons: data.botReply.buttons,
                media: data.botReply.media,
                status: 'delivered',
                created_at: new Date().toISOString(),
              },
            ]);
            setIsTyping(false);
          }, 600);
        } else {
          setIsTyping(false);
        }

        loadConversations();
      }
    } catch (err) {
      console.error('Failed to send WhatsApp message:', err);
      setIsTyping(false);
    } finally {
      setIsSending(false);
    }
  };

  // Toggle Human Handover Mode
  const handleToggleHandover = async () => {
    if (!activeConversation) return;
    const newMode = isHumanHandover ? 'bot' : 'human';
    try {
      const res = await fetch(`/api/whatsapp/conversations/${activeConvId}/handover`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: newMode,
          staffName: currentStaff,
        }),
      });

      if (res.ok) {
        await loadConversations();
        await loadMessages(activeConvId);
      }
    } catch (err) {
      console.error('Error toggling handover mode:', err);
    }
  };

  // Assign staff to conversation
  const handleAssignStaff = async (staffName: string) => {
    try {
      const res = await fetch(`/api/whatsapp/conversations/${activeConvId}/staff`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffName }),
      });
      if (res.ok) {
        loadConversations();
      }
    } catch (err) {
      console.error('Error assigning staff:', err);
    }
  };

  // Handle Quick Action Chip Click (Executes live EMR Query)
  const handleQuickAction = async (actionText: string) => {
    const q = actionText.toLowerCase();

    // If it's a PDF preview request
    if (q.includes('preview prescription') || q.includes('view prescription')) {
      try {
        const res = await fetch('/api/whatsapp/emr-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'get_prescription',
            patientPhone: activePatientPhone,
          }),
        });
        const data = await res.json();
        if (data.found) {
          setPreviewDocument({
            type: 'prescription',
            id: data.prescription.rxNumber || data.prescription.id,
            title: `Clinical Prescription - ${data.prescription.rxNumber}`,
            pdfUrl: data.prescription.pdfUrl,
            data: data.prescription,
          });
          return;
        }
      } catch (err) {
        console.error('Error fetching prescription preview:', err);
      }
    }

    if (q.includes('preview lab') || q.includes('view lab report') || q.includes('lab sheet')) {
      try {
        const res = await fetch('/api/whatsapp/emr-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'get_lab_reports',
            patientPhone: activePatientPhone,
          }),
        });
        const data = await res.json();
        if (data.found && data.reports.length > 0) {
          const rep = data.reports[0];
          setPreviewDocument({
            type: 'lab-report',
            id: rep.id,
            title: `Diagnostic Lab Sheet - ${rep.category}`,
            pdfUrl: rep.pdfUrl,
            data: rep,
          });
          return;
        }
      } catch (err) {
        console.error('Error fetching lab report preview:', err);
      }
    }

    if (q.includes('download pdf')) {
      // Default to prescription or lab pdf
      window.open(`/api/whatsapp/prescription/rx-101/pdf`, '_blank');
      return;
    }

    // Otherwise dispatch the message into the active conversation
    handleSendMessage(actionText, 'user');
  };

  // Handle Voice Note Simulation Submission
  const handleProcessVoiceNote = async (promptSample: (typeof SAMPLE_VOICE_PROMPTS)[0]) => {
    setVoiceProcessing(true);
    setVoiceResult(null);

    try {
      const res = await fetch('/api/whatsapp/voice-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientPhone: activePatientPhone,
          patientName: activePatientName,
          audioDurationSecs: 18,
          simulatedTranscript: promptSample.text,
          detectedLanguage: promptSample.code,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setVoiceResult(data);
        setIsRecordingAudio(false);
        // Reload messages to show the newly inserted transcribed voice note in chat
        await loadMessages(activeConvId);
        await loadConversations();
      }
    } catch (err) {
      console.error('Voice note error:', err);
    } finally {
      setVoiceProcessing(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      {/* 1. Header with Live EMR Status & Tabs */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              WhatsApp Cloud API Live
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
              <Layers className="w-3 h-3" /> SQLite EMR Sync (data/lumera.db)
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-purple-600" /> Gemini 2.5 Flash Multilingual NLU
            </span>
          </div>

          <h1 className="text-xl font-bold text-slate-900 mt-2">
            Lumera WhatsApp AI Suite & Dynamic Clinical Desk
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time integration connecting WhatsApp to SQLite appointments, clinical prescriptions, lab diagnostics, and human handover.
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200/80 self-start md:self-auto shrink-0">
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'chat'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            Patient WhatsApp View
          </button>
          <button
            onClick={() => setActiveTab('inbox')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'inbox'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            2-Way Staff Inbox
            {conversations.some((c) => c.handover_mode === 'human') && (
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('outbound')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'outbound'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Radio className="w-3.5 h-3.5 text-blue-600" />
            Outbound Triggers
          </button>
        </div>
      </div>

      {/* 2. TAB: OUTBOUND TRIGGER ENGINE */}
      {activeTab === 'outbound' && (
        <OutboundTriggerPanel
          activePatientName={activePatientName}
          activePatientPhone={activePatientPhone}
          onNotificationSent={() => loadMessages(activeConvId)}
        />
      )}

      {/* 3. TAB: CHAT OR 2-WAY STAFF INBOX */}
      {(activeTab === 'chat' || activeTab === 'inbox') && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Staff Multi-Agent Conversation List (Always visible in inbox, optional toggle in chat) */}
          <div className={`${activeTab === 'inbox' ? 'lg:col-span-4' : 'hidden lg:block lg:col-span-4'} bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[680px]`}>
            {/* Inbox Header */}
            <div className="p-3.5 bg-slate-900 text-white border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Users className="w-4 h-4 text-blue-400" />
                <span className="font-bold text-xs text-white uppercase tracking-wider">
                  Shared Clinic Inbox
                </span>
              </div>
              <button
                onClick={loadConversations}
                className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
                title="Refresh conversations"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Staff Persona Selector */}
            <div className="p-3 bg-slate-50 border-b border-slate-200">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Active Staff Responder
              </label>
              <select
                value={currentStaff}
                onChange={(e) => setCurrentStaff(e.target.value)}
                className="w-full text-xs font-semibold bg-white border border-slate-300 rounded-lg p-1.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {CLINIC_STAFF_MEMBERS.map((s, idx) => (
                  <option key={idx} value={`${s.name} (${s.role})`}>
                    {s.name} • {s.role}
                  </option>
                ))}
              </select>
            </div>

            {/* Conversations List Feed */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {conversations.map((conv) => {
                const isSelected = conv.id === activeConvId;
                const isHuman = conv.handover_mode === 'human';

                return (
                  <div
                    key={conv.id}
                    onClick={() => setActiveConvId(conv.id)}
                    className={`p-3.5 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-50/70 border-l-4 border-blue-600'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                          isHuman ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700'
                        }`}>
                          {conv.patient_name.charAt(0)}
                        </div>
                        <div>
                          <h4 className="font-bold text-xs text-slate-900 leading-tight">
                            {conv.patient_name}
                          </h4>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {conv.patient_phone} • {conv.patient_uhid}
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 font-mono block">
                          {conv.last_message_time}
                        </span>
                        {conv.unread_count > 0 && (
                          <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded-full bg-blue-600 text-white font-bold text-[10px]">
                            {conv.unread_count}
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-600 mt-2 line-clamp-1 italic">
                      "{conv.last_message}"
                    </p>

                    <div className="flex items-center gap-1.5 mt-2">
                      {isHuman ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1">
                          <Lock className="w-2.5 h-2.5" /> Staff Takeover
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                          <Bot className="w-2.5 h-2.5" /> AI Bot Active
                        </span>
                      )}

                      {conv.tag && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                          {conv.tag}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Inbox Footer Action */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 flex items-center justify-between">
              <span>{conversations.length} Active Patients in Desk</span>
              <button
                onClick={() => {
                  setActiveConvId('conv-rajiv');
                  loadMessages('conv-rajiv');
                }}
                className="text-blue-600 hover:text-blue-800 font-semibold"
              >
                Reset to Rajiv Saxena
              </button>
            </div>
          </div>

          {/* Right Column: Interactive WhatsApp Interface */}
          <div className={`${activeTab === 'inbox' ? 'lg:col-span-8' : 'lg:col-span-8 lg:mx-auto max-w-2xl w-full'}`}>
            <div className="bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 shadow-2xl flex flex-col h-[680px]">
              {/* WhatsApp Business Header */}
              <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 text-white flex items-center justify-between shadow-xs">
                <div className="flex items-center space-x-3">
                  <div className="relative">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold shadow-xs ${
                      isHumanHandover ? 'bg-amber-600 text-white' : 'bg-emerald-600 text-white'
                    }`}>
                      {isHumanHandover ? <Users className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                    </div>
                    <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-slate-900"></span>
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-xs sm:text-sm text-white">
                        {activePatientName}
                      </h3>
                      <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                        {activePatientPhone}
                      </span>
                    </div>

                    <div className="text-[10px] text-slate-300 flex items-center gap-2 mt-0.5">
                      {isHumanHandover ? (
                        <span className="text-amber-400 font-semibold flex items-center gap-1">
                          <Lock className="w-3 h-3" /> Staff Takeover Mode ({activeConversation?.assigned_staff || currentStaff})
                        </span>
                      ) : (
                        <span className="text-emerald-400 font-medium flex items-center gap-1">
                          <Bot className="w-3 h-3" /> Lumera AI Medical Assistant Active
                        </span>
                      )}
                      <span>•</span>
                      <span className="text-slate-400">UHID: {activeConversation?.patient_uhid || 'LUM-2026-0106'}</span>
                    </div>
                  </div>
                </div>

                {/* Handover Toggle Button & Action Tools */}
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleToggleHandover}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs ${
                      isHumanHandover
                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                    }`}
                    title="Switch between automated AI bot and human clinic staff"
                  >
                    {isHumanHandover ? (
                      <>
                        <Unlock className="w-3.5 h-3.5" /> Return to Bot
                      </>
                    ) : (
                      <>
                        <Lock className="w-3.5 h-3.5 text-amber-400" /> Take Over Chat
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => setIsRecordingAudio(!isRecordingAudio)}
                    className={`p-2 rounded-lg text-xs font-semibold transition-colors ${
                      isRecordingAudio
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-800 hover:bg-slate-700 text-purple-400'
                    }`}
                    title="Simulate Ambient Voice Note"
                  >
                    <Mic className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Ambient Voice Audio Simulation Tray */}
              {isRecordingAudio && (
                <div className="bg-slate-800 border-b border-slate-700 p-3.5 animate-in slide-in-from-top-2 duration-150">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-purple-300">
                      <Mic className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                      Ambient Voice & Multilingual Note Simulator (Gemini Flash)
                    </div>
                    <button
                      onClick={() => setIsRecordingAudio(false)}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      ✕ Close
                    </button>
                  </div>

                  <p className="text-[11px] text-slate-300 mb-2 leading-relaxed">
                    Test multilingual clinical audio processing. Select a patient voice sample below to transcribe, detect language, translate, and execute live EMR suggestions:
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {SAMPLE_VOICE_PROMPTS.map((sample, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleProcessVoiceNote(sample)}
                        disabled={voiceProcessing}
                        className="p-2 rounded-lg bg-slate-900 hover:bg-slate-950 border border-slate-700 text-left transition-all group disabled:opacity-50"
                      >
                        <div className="flex items-center justify-between text-[11px] font-bold text-purple-300 group-hover:text-purple-200">
                          <span>{sample.lang}</span>
                          <span className="text-[9px] bg-slate-800 text-slate-400 px-1 rounded">Audio 18s</span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1 line-clamp-1 italic">
                          "{sample.text}"
                        </p>
                      </button>
                    ))}
                  </div>

                  {voiceProcessing && (
                    <div className="mt-3 p-2 rounded bg-purple-950/60 border border-purple-800/80 text-purple-200 text-xs flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-400" />
                      Gemini processing audio waveform: Transcribing Devanagari script and generating English clinical summary...
                    </div>
                  )}
                </div>
              )}

              {/* Chat Message Scrollable Body */}
              <div className="flex-1 p-4 overflow-y-auto bg-slate-950 space-y-3.5">
                {loadingMessages && (
                  <div className="text-center py-6 text-xs text-slate-500 flex items-center justify-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading synchronized messages...
                  </div>
                )}

                {messages.map((m) => {
                  const isUser = m.sender === 'user';
                  const isSystem = m.sender === 'system';

                  if (isSystem) {
                    return (
                      <div key={m.id} className="flex justify-center my-2">
                        <div className="bg-slate-900 border border-slate-800 text-slate-400 rounded-full px-3 py-1 text-[10px] flex items-center gap-1.5 shadow-2xs">
                          <Shield className="w-3 h-3 text-blue-400" />
                          <span>{m.content}</span>
                          <span className="text-slate-600 font-mono">• {m.time_display}</span>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                    >
                      {/* Sender label for staff messages */}
                      {!isUser && m.staff_name && (
                        <span className="text-[10px] text-amber-400 font-bold mb-1 px-1 flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" /> {m.staff_name}
                        </span>
                      )}

                      <div
                        className={`max-w-[85%] rounded-2xl p-3.5 text-xs leading-relaxed ${
                          isUser
                            ? 'bg-blue-600 text-white rounded-br-xs shadow-xs'
                            : 'bg-slate-800/90 text-slate-100 border border-slate-700/80 rounded-bl-xs shadow-xs'
                        }`}
                      >
                        <div className="whitespace-pre-wrap">{m.content}</div>

                        {/* Translation pill if detected */}
                        {m.translated_content && m.detected_language && m.detected_language !== 'en' && (
                          <div className="mt-2 pt-2 border-t border-slate-700/60 text-[11px] text-purple-300">
                            <span className="font-bold flex items-center gap-1 text-[10px] text-purple-400 mb-0.5 uppercase tracking-wider">
                              <Globe className="w-2.5 h-2.5" /> English Translation ({m.detected_language.toUpperCase()}):
                            </span>
                            "{m.translated_content}"
                          </div>
                        )}

                        {/* Media PDF Attachment Preview Card */}
                        {m.media && (
                          <div className="mt-3 p-3 bg-slate-900 rounded-xl border border-slate-700/90 space-y-2">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center space-x-2">
                                <div className="p-2 bg-red-950/60 border border-red-800 text-red-400 rounded-lg">
                                  <FileText className="w-4 h-4" />
                                </div>
                                <div>
                                  <span className="font-bold text-xs text-white block truncate max-w-[200px]">
                                    {m.media.title}
                                  </span>
                                  <span className="text-[10px] text-slate-400 block">
                                    {m.media.subtitle || (m.media.size ? `Digital EMR Slip • ${m.media.size}` : 'Verified Medical Document')}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 pt-1 border-t border-slate-800">
                              <button
                                onClick={() => {
                                  const isRx = m.media?.title?.toLowerCase().includes('prescription') || m.media?.title?.toLowerCase().includes('rx');
                                  setPreviewDocument({
                                    type: isRx ? 'prescription' : 'lab-report',
                                    id: m.media?.title || 'doc-1',
                                    title: m.media?.title || 'Clinical Document',
                                    pdfUrl: m.media?.url || `/api/whatsapp/prescription/rx-101/pdf`,
                                    data: m.media?.previewData,
                                  });
                                }}
                                className="flex-1 py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors border border-slate-700"
                              >
                                <Eye className="w-3 h-3 text-blue-400" /> Preview Slip
                              </button>
                              <a
                                href={m.media.url || `/api/whatsapp/prescription/rx-101/pdf`}
                                target="_blank"
                                rel="noreferrer"
                                className="py-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold flex items-center gap-1 transition-colors"
                              >
                                <Download className="w-3 h-3" /> PDF
                              </a>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Interactive Quick Action Buttons */}
                      {m.buttons && m.buttons.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2 max-w-[85%]">
                          {m.buttons.map((btn, i) => (
                            <button
                              key={i}
                              onClick={() => handleQuickAction(btn)}
                              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-blue-900/90 text-blue-300 hover:text-white border border-blue-700/50 text-xs font-semibold transition-all shadow-xs flex items-center gap-1.5 active:scale-98"
                            >
                              <span>{btn}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      <span className="text-[10px] text-slate-500 mt-1 px-1 font-mono flex items-center gap-1">
                        <span>{m.time_display}</span>
                        {isUser && <span className="text-blue-400 font-bold">✓✓</span>}
                      </span>
                    </div>
                  );
                })}

                {isTyping && (
                  <div className="flex items-center space-x-1.5 text-xs text-blue-400 bg-slate-800 px-3 py-2 rounded-xl w-fit border border-slate-700">
                    <Bot className="w-3.5 h-3.5 text-blue-400 mr-1" />
                    <span>Lumera Bot is querying EMR database...</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:0.2s]"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:0.4s]"></span>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Staff Canned Quick Replies Tray (Active in Staff Takeover Mode) */}
              {isHumanHandover && (
                <div className="bg-slate-900 border-t border-slate-800 px-3 py-2 flex items-center gap-2 overflow-x-auto">
                  <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider shrink-0 flex items-center gap-1">
                    <CornerDownRight className="w-3 h-3" /> Canned:
                  </span>
                  {CANNED_STAFF_REPLIES.map((canned, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSendMessage(canned, 'bot')}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] whitespace-nowrap shrink-0 border border-slate-700/80 transition-colors"
                    >
                      {canned.slice(0, 38)}...
                    </button>
                  ))}
                </div>
              )}

              {/* Message Input Footer */}
              <div className="p-3 bg-slate-900 border-t border-slate-800 flex items-center space-x-2">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder={
                    isHumanHandover
                      ? `Type staff reply as ${currentStaff}...`
                      : 'Type patient message or click a quick action above...'
                  }
                  className="flex-1 text-xs bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />

                <button
                  onClick={() => handleSendMessage()}
                  disabled={!inputText.trim() || isSending}
                  className={`p-2.5 rounded-xl font-semibold transition-all disabled:opacity-40 flex items-center justify-center ${
                    isHumanHandover
                      ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                      : 'bg-blue-600 hover:bg-blue-500 text-white'
                  }`}
                  title="Send message"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Document Preview Modal (Prescription or Lab Report) */}
      <DocumentPreviewModal
        document={previewDocument}
        onClose={() => setPreviewDocument(null)}
      />
    </div>
  );
};

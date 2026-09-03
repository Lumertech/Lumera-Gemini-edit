import React, { useState, useEffect } from 'react';
import { 
  Bell, 
  Send, 
  Clock, 
  CheckCircle2, 
  FileText, 
  RefreshCw, 
  Calendar, 
  Radio, 
  AlertCircle,
  Sparkles,
  ChevronRight
} from 'lucide-react';

interface OutboundEvent {
  id: string;
  eventType: string;
  patientPhone: string;
  patientName: string;
  status: string;
  details: string;
  sentAt: string;
}

interface OutboundTriggerPanelProps {
  activePatientName: string;
  activePatientPhone: string;
  onNotificationSent?: () => void;
}

export const OutboundTriggerPanel: React.FC<OutboundTriggerPanelProps> = ({
  activePatientName,
  activePatientPhone,
  onNotificationSent,
}) => {
  const [events, setEvents] = useState<OutboundEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [customMsg, setCustomMsg] = useState('');

  const fetchEvents = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/whatsapp/outbound-events');
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch (err) {
      console.error('Failed to load outbound events:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const triggerEvent = async (eventType: string, customPayload: Record<string, any> = {}) => {
    try {
      setSending(eventType);
      setStatusMessage(null);

      const res = await fetch('/api/whatsapp/outbound-trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType,
          patientPhone: activePatientPhone,
          patientName: activePatientName,
          customPayload,
        }),
      });

      if (res.ok) {
        setStatusMessage(`Successfully dispatched ${eventType.replace(/_/g, ' ')} to WhatsApp!`);
        fetchEvents();
        if (onNotificationSent) onNotificationSent();
      } else {
        setStatusMessage('Error dispatching outbound notification');
      }
    } catch (err) {
      console.error('Error triggering notification:', err);
      setStatusMessage('Network error triggering notification');
    } finally {
      setSending(null);
      setTimeout(() => setStatusMessage(null), 4000);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-6">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            <Radio className="w-4 h-4 text-blue-600 animate-pulse" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-900">Outbound Automated Notification Engine</h3>
            <p className="text-xs text-slate-500">
              Live automated triggers connected to EMR state for {activePatientName} ({activePatientPhone})
            </p>
          </div>
        </div>

        <button
          onClick={fetchEvents}
          className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 text-xs flex items-center gap-1"
          title="Refresh trigger logs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {statusMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Action Trigger Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Trigger 1: Appointment Reminder */}
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-slate-50 transition-all flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <span className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                <Calendar className="w-4 h-4" />
              </span>
              <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                24h Prior
              </span>
            </div>
            <h4 className="font-bold text-xs text-slate-900 mt-2.5">Upcoming Slot Reminder</h4>
            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
              Dispatches OPD room, doctor details, arrival timing, and interactive confirmation chips.
            </p>
          </div>
          <button
            onClick={() => triggerEvent('appointment_reminder_24h')}
            disabled={sending !== null}
            className="w-full py-1.5 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
          >
            {sending === 'appointment_reminder_24h' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            Trigger 24h Reminder
          </button>
        </div>

        {/* Trigger 2: Post-Consultation Dispatch */}
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-slate-50 transition-all flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <span className="p-1.5 bg-emerald-100 text-emerald-700 rounded-lg">
                <FileText className="w-4 h-4" />
              </span>
              <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                Auto-Packet
              </span>
            </div>
            <h4 className="font-bold text-xs text-slate-900 mt-2.5">Post-Consultation Packet</h4>
            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
              Attaches doctor-signed prescription PDF, diagnostic invoice, and pharmacy home delivery link.
            </p>
          </div>
          <button
            onClick={() => triggerEvent('post_consultation_dispatch')}
            disabled={sending !== null}
            className="w-full py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
          >
            {sending === 'post_consultation_dispatch' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            Dispatch Clinical Packet
          </button>
        </div>

        {/* Trigger 3: Live Queue Alert */}
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-slate-50 transition-all flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <span className="p-1.5 bg-amber-100 text-amber-700 rounded-lg">
                <Bell className="w-4 h-4" />
              </span>
              <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                Real-Time OPD
              </span>
            </div>
            <h4 className="font-bold text-xs text-slate-900 mt-2.5">Live OPD Queue Alert</h4>
            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
              Pushes token status notification ("Next in Line") with instructions to report to Rehab Suite 105.
            </p>
          </div>
          <button
            onClick={() => triggerEvent('queue_token_update')}
            disabled={sending !== null}
            className="w-full py-1.5 px-3 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
          >
            {sending === 'queue_token_update' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            Send "Next in Line" Alert
          </button>
        </div>
      </div>

      {/* Trigger 4: Custom Message Dispatch */}
      <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 flex flex-col sm:flex-row gap-2 items-center">
        <input
          type="text"
          value={customMsg}
          onChange={(e) => setCustomMsg(e.target.value)}
          placeholder="Type custom clinic broadcast or announcement to patient's WhatsApp..."
          className="flex-1 w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          onClick={() => {
            if (!customMsg.trim()) return;
            triggerEvent('custom_broadcast', { message: customMsg });
            setCustomMsg('');
          }}
          disabled={!customMsg.trim() || sending !== null}
          className="w-full sm:w-auto px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shrink-0 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40"
        >
          <Send className="w-3.5 h-3.5" /> Send Broadcast
        </button>
      </div>

      {/* Outbound Event Logs Feed */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Live Outbound Event Delivery Log
          </span>
          <span className="text-[11px] text-slate-400">{events.length} dispatched events recorded</span>
        </div>

        <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 max-h-48 overflow-y-auto bg-white">
          {events.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-400">
              No outbound notification events dispatched yet. Trigger an action above to test delivery.
            </div>
          ) : (
            events.map((ev) => (
              <div key={ev.id} className="p-3 text-xs flex items-start justify-between hover:bg-slate-50 transition-colors">
                <div className="space-y-0.5 max-w-[75%]">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{ev.patientName}</span>
                    <span className="font-mono text-slate-500 text-[11px]">{ev.patientPhone}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {ev.status}
                    </span>
                  </div>
                  <p className="text-slate-600 text-[11px]">{ev.details}</p>
                </div>
                <div className="text-right text-[10px] text-slate-400 font-mono">
                  {new Date(ev.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

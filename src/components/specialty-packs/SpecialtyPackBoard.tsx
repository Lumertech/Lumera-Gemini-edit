import React, { useMemo, useState } from "react";
import { Calendar, FileText, Receipt, Sparkles } from "lucide-react";
import type { Appointment, Doctor, Patient } from "../../types";
import type { SpecialtyWorkflowPack } from "../../lib/specialtyWorkflow";
import type { NavView } from "../Navbar";

interface Props {
  pack: SpecialtyWorkflowPack;
  patients: Patient[];
  appointments: Appointment[];
  currentDoctor: Doctor;
  onSelectView: (view: NavView) => void;
  onSelectPatient: (patient: Patient) => void;
}

export const SpecialtyPackBoard: React.FC<Props> = ({
  pack,
  patients,
  appointments,
  currentDoctor,
  onSelectView,
  onSelectPatient,
}) => {
  const [note, setNote] = useState("");
  const [topic, setTopic] = useState("");
  const today = appointments.filter((a) => a.doctorId === currentDoctor.id || a.specialty === pack.rxModule);

  const copy = useMemo(() => {
    if (pack.kind === "physio") {
      return {
        title: "Physio session board",
        lead: "VAS, ROM, procedures, and home-exercise packages — not a GP medicines pad.",
        services: ["Initial assessment", "Rehab session", "Post-op protocol", "8-session package"],
        noteLabel: "Session / HEP plan",
        lens: "Exercises & procedures",
      };
    }
    if (pack.kind === "dental") {
      return {
        title: "Dental chair & odontogram",
        lead: "Tooth chart and chair procedures — not a GP Rx theatre.",
        services: ["Examination", "Scaling", "Restoration", "RCT review", "Extraction"],
        noteLabel: "Planned procedures",
        lens: "Dental materials & chart",
      };
    }
    if (pack.kind === "wellness") {
      return {
        title: "Wellness & salon book",
        lead: "Services and packages — not a medical chart. Book a treatment, then collect payment.",
        services: ["Hair spa", "Cut & style", "Facial", "Deep tissue massage", "Manicure / pedicure"],
        noteLabel: "Guest / product notes",
        lens: "Salon menu",
      };
    }
    if (pack.kind === "therapy") {
      return {
        title: "Therapy session desk",
        lead: "Counseling notes and plan. Medicines are not the default path.",
        services: ["Intake session", "CBT", "Supportive", "Couple / family"],
        noteLabel: "Session note",
        lens: "Session fees",
      };
    }
    return {
      title: "Consultant workspace",
      lead: "Meetings, briefs, invoices — not a clinic EMR.",
      services: ["Discovery call", "Advisory meeting", "Document review", "Retainer check-in"],
      noteLabel: "Meeting brief",
      lens: "Engagement fees",
    };
  }, [pack.kind]);

  return (
    <div className="max-w-5xl mx-auto space-y-4" data-testid={`specialty-pack-${pack.id}`}>
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-xs text-amber-900">
        {pack.sandboxNotice}
      </div>
      <div className="bg-white border rounded-2xl p-6 space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-slate-700" />
          <h1 className="text-xl font-bold text-slate-900">{copy.title}</h1>
        </div>
        <p className="text-sm text-slate-600">{copy.lead}</p>
        <p className="text-xs text-slate-500">
          Signed in as {currentDoctor.name} · {pack.practiceLine} · {pack.specialty}
        </p>
        <p className="text-[11px] font-semibold text-slate-700" data-testid="pack-workflow-lens">
          {copy.lens} · {pack.billingLabel} · {pack.queueSemantics}
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        {pack.ctas.map((cta) => (
          <button
            key={cta.id}
            type="button"
            onClick={() => onSelectView(cta.view as NavView)}
            className="text-left bg-white border rounded-xl p-4 hover:border-slate-400"
          >
            <div className="text-sm font-bold text-slate-900">{cta.label}</div>
            <p className="text-xs text-slate-600 mt-1">{cta.description}</p>
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white border rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-bold">{copy.noteLabel}</h2>
          <input
            className="w-full border rounded px-3 py-2 text-sm"
            placeholder={pack.kind === "consultant" ? "Topic" : "Context"}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <textarea
            className="w-full border rounded px-3 py-2 text-sm min-h-[120px]"
            placeholder={copy.noteLabel}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {copy.services.map((s) => (
              <span key={s} className="text-[11px] px-2 py-1 rounded bg-slate-100 text-slate-700">{s}</span>
            ))}
          </div>
        </div>
        <div className="bg-white border rounded-xl p-4 space-y-2">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Calendar className="w-4 h-4" /> Today
          </h2>
          {today.length === 0 && <p className="text-xs text-slate-500">No booked slots yet. Use guest/client intake or the calendar.</p>}
          {today.slice(0, 8).map((a) => (
            <button
              key={a.id}
              type="button"
              className="w-full text-left text-xs border rounded-lg px-3 py-2 hover:bg-slate-50"
              onClick={() => {
                const p = patients.find((x) => x.id === a.patientId);
                if (p) onSelectPatient(p);
              }}
            >
              <div className="font-semibold">{a.patientName}</div>
              <div className="text-slate-500">{a.timeSlot} · {a.type}</div>
            </button>
          ))}
          <div className="flex gap-2 pt-2">
            <button type="button" className="text-xs font-semibold text-blue-700 flex items-center gap-1" onClick={() => onSelectView("appointments")}>
              <Calendar className="w-3.5 h-3.5" /> Schedule
            </button>
            <button type="button" className="text-xs font-semibold text-blue-700 flex items-center gap-1" onClick={() => onSelectView("billing")}>
              <Receipt className="w-3.5 h-3.5" /> Invoice
            </button>
            <button type="button" className="text-xs font-semibold text-blue-700 flex items-center gap-1" onClick={() => onSelectView("reception")}>
              <FileText className="w-3.5 h-3.5" /> Intake
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from "react";
import {
  Calendar,
  Clock,
  IndianRupee,
  Users,
  Stethoscope,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { Appointment, AppUser, Doctor, Patient } from "../types";
import type { SpecialtyWorkflowPack } from "../lib/specialtyWorkflow";
import type { NavView } from "./Navbar";
import {
  formatHomeInr,
  greetingClinicName,
  greetingLine,
  homeMetrics,
  homeNudge,
  setupChecklist,
  setupProgress,
  showsSetupChecklist,
  whatsAppPillFromStatus,
  type VisitLite,
} from "../lib/clinicNav";
import { apiFetch } from "../api/http";

interface PracticeHomeProps {
  user: AppUser;
  pack: SpecialtyWorkflowPack;
  patients: Patient[];
  appointments: Appointment[];
  doctor: Doctor;
  canConsult: boolean;
  hasLogo: boolean;
  hasHoursAndFees: boolean;
  onOpen: (view: NavView) => void;
  onCheckInWalkIn?: () => void;
  onCheckIn?: (appointment: Appointment) => void;
  onReady?: (appointment: Appointment) => void;
  onStartConsult?: (appointment: Appointment) => void;
  onCreateBill?: (appointment: Appointment) => void;
}

function Kpi({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm px-4 py-4 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{label}</p>
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold text-slate-900 tabular-nums">{value}</p>
    </div>
  );
}

function Tile({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 min-w-0">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-2 text-sm text-slate-600 space-y-2">{children}</div>
    </section>
  );
}

function Action({ label, onClick, testId }: { label: string; onClick: () => void; testId?: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
    >
      {label}
    </button>
  );
}

export const PracticeHome: React.FC<PracticeHomeProps> = ({
  user,
  pack,
  patients,
  appointments,
  doctor,
  canConsult,
  hasLogo,
  hasHoursAndFees,
  onOpen,
  onCheckInWalkIn,
  onCheckIn,
  onReady,
  onStartConsult,
  onCreateBill,
}) => {
  const clinic = greetingClinicName(user.clinicName);
  const visits: VisitLite[] = appointments.map((row) => ({
    id: row.id,
    date: row.date,
    status: row.status,
    patientName: row.patientName,
    timeSlot: row.timeSlot,
    consultationFee: row.consultationFee,
    isPaid: row.isPaid,
    type: row.type,
  }));
  const metrics = homeMetrics(visits);
  const nudge = homeNudge(metrics, patients.length);
  const todayRows = appointments.filter((row) => row.date === metrics.today && row.status !== "Cancelled" && row.status !== "No-Show");
  const next = todayRows.find((row) => row.status === "Waiting" || row.status === "Triage / Vitals") || todayRows[0];
  const [whatsAppConnected, setWhatsAppConnected] = useState(false);
  const checks = setupChecklist({
    hasLogo,
    hasHoursAndFees,
    whatsAppConnected,
    patientCount: patients.length,
  });
  const progress = setupProgress(checks);
  const showSetup = showsSetupChecklist(user);
  const [setupOpen, setSetupOpen] = useState(!progress.complete);
  useEffect(() => {
    let cancelled = false;
    void apiFetch<{ tenantNumber?: { status?: string } | null }>("/api/whatsapp-numbers/mine")
      .then((data) => {
        const status = data?.tenantNumber?.status || "disconnected";
        if (!cancelled) setWhatsAppConnected(whatsAppPillFromStatus(status).state === "connected");
      })
      .catch(() => {
        if (!cancelled) setWhatsAppConnected(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user.tenantId]);

  const specialtyTiles = (() => {
    if (pack.kind === "physio") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Tile title="Today's sessions">
            <p>{metrics.todayAppointments} booked · {metrics.waiting + metrics.ready} checked in · {metrics.done} done</p>
            {next ? (
              <p className="text-slate-800">{next.patientName} · {next.timeSlot}</p>
            ) : (
              <p>No session booked.</p>
            )}
          </Tile>
          <Tile title="Packages running low">
            <p>Session packages are not tracked yet.</p>
          </Tile>
          <Tile title="Exercise logs">
            <p>Home exercise logs are not tracked yet.</p>
          </Tile>
          <Tile title="Outcome retests">
            <p>ODI, NDI, LEFS and PSFS are not tracked yet.</p>
          </Tile>
          <Tile title="Collections today">
            <p>Collected {formatHomeInr(metrics.todayCollected)}</p>
            <p>Pending {formatHomeInr(metrics.todayPending)}</p>
          </Tile>
        </div>
      );
    }
    if (pack.kind === "dental") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Tile title="Chair schedule">
            {todayRows.length === 0 ? <p>No chair booked today.</p> : todayRows.slice(0, 4).map((row) => (
              <p key={row.id}>{row.timeSlot} · {row.patientName}</p>
            ))}
          </Tile>
          <Tile title="Treatment plans">
            <p>Quoted and accepted plans are not tracked yet.</p>
          </Tile>
          <Tile title="Multi-visit work">
            <p>{todayRows.filter((row) => /rct|crown/i.test(row.type)).length} matching visits today.</p>
          </Tile>
          <Tile title="Lab work">
            <p>Crowns and aligners due back are not tracked yet.</p>
          </Tile>
          <Tile title="Recall">
            <p>Six-month recall is not tracked yet.</p>
          </Tile>
          <Tile title="Balances">
            <p>Collected {formatHomeInr(metrics.todayCollected)}</p>
            <p>Outstanding today {formatHomeInr(metrics.todayPending)}</p>
          </Tile>
        </div>
      );
    }
    if (pack.kind === "medical") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Tile title="OPD queue">
            <p>Waiting {metrics.waiting} · With doctor {metrics.withDoctor} · Done {metrics.done}</p>
          </Tile>
          <Tile title="Follow-ups today">
            <p>{metrics.followUps === 0 ? "None due today." : `${metrics.followUps} follow-up${metrics.followUps === 1 ? "" : "s"} on the book.`}</p>
            <button type="button" className="text-xs font-semibold text-blue-700" onClick={() => onOpen("appointments")}>
              Open appointments
            </button>
          </Tile>
          <Tile title="Lab reports">
            <p>No reports are waiting in this workspace.</p>
            <button type="button" className="text-xs font-semibold text-blue-700" onClick={() => onOpen("reports")}>
              Open labs
            </button>
          </Tile>
          <Tile title="Day end">
            <p>{metrics.done} completed · {formatHomeInr(metrics.todayCollected)} collected</p>
          </Tile>
        </div>
      );
    }
    return (
      <Tile title={pack.chartLabel}>
        <p>{todayRows.length === 0 ? "Nothing booked today." : `${todayRows.length} on today's book.`}</p>
      </Tile>
    );
  })();

  return (
    <div className="max-w-6xl mx-auto space-y-5 min-w-0" data-testid="practice-home">
      <div className="rounded-2xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-5 py-6 sm:px-8 sm:py-7 shadow-sm">
        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">{greetingLine(user.name)}</h2>
        <p className="mt-1 text-sm text-white/90">Here's what's happening at {clinic} today.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi label="Total appointments" value={String(metrics.totalAppointments)} tone="bg-blue-50 text-blue-600" icon={<Calendar className="w-4 h-4" />} />
        <Kpi label="Total clients" value={String(patients.length)} tone="bg-violet-50 text-violet-600" icon={<Users className="w-4 h-4" />} />
        <Kpi label="Today's appointments" value={String(metrics.todayAppointments)} tone="bg-orange-50 text-orange-600" icon={<Clock className="w-4 h-4" />} />
        <Kpi label="Total revenue" value={formatHomeInr(metrics.totalRevenue)} tone="bg-emerald-50 text-emerald-600" icon={<IndianRupee className="w-4 h-4" />} />
      </div>

      <section className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 sm:p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Stethoscope className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-900">OPD performance</h3>
          <span className="text-[11px] font-medium rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">{pack.specialty || pack.practiceLine}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-500">Today</p>
            <p className="text-xl font-semibold text-slate-900">{metrics.todayAppointments}</p>
            <p className="text-xs text-slate-500">{metrics.done} done · {metrics.waiting} scheduled</p>
          </div>
          <div className="rounded-xl bg-emerald-50/70 px-4 py-3">
            <p className="text-xs text-slate-500">This week</p>
            <p className="text-xl font-semibold text-slate-900">{metrics.weekAppointments}</p>
          </div>
          <div className="rounded-xl bg-violet-50/70 px-4 py-3">
            <p className="text-xs text-slate-500">This month</p>
            <p className="text-xl font-semibold text-slate-900">{metrics.monthAppointments}</p>
          </div>
          <div className="rounded-xl bg-emerald-50 px-4 py-3">
            <p className="text-xs text-slate-500">Monthly revenue</p>
            <p className="text-xl font-semibold text-slate-900">{formatHomeInr(metrics.monthRevenue)}</p>
          </div>
        </div>
        <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-sm text-amber-950" data-testid="home-nudge">
          {nudge}
        </div>
      </section>

      {next && (
        <section className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">Next visit</p>
            <p className="font-semibold text-slate-900 truncate">{next.patientName}</p>
            <p className="text-xs text-slate-500">{next.timeSlot} · {next.status === "Triage / Vitals" ? "Ready for doctor" : next.status}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {next.status !== "Waiting" && next.status !== "Triage / Vitals" && next.status !== "In Consultation" && onCheckIn && (
              <Action label="Check in" testId="home-check-in" onClick={() => onCheckIn(next)} />
            )}
            {next.status === "Waiting" && onReady && (
              <Action label="Ready for doctor" testId="home-ready" onClick={() => onReady(next)} />
            )}
            {canConsult && next.status === "Triage / Vitals" && onStartConsult && (
              <Action label="Start consult" testId="home-start-consult" onClick={() => onStartConsult(next)} />
            )}
            {!next.isPaid && onCreateBill && (next.status === "In Consultation" || next.status === "Completed") && (
              <Action label="Create bill" testId="home-create-bill" onClick={() => onCreateBill(next)} />
            )}
          </div>
        </section>
      )}

      {!next && onCheckInWalkIn && patients.length > 0 && (
        <div>
          <Action label={`Check in ${patients[0].name}`} testId="home-check-in" onClick={onCheckInWalkIn} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="text-xs font-semibold text-blue-700 px-2 py-1.5" onClick={() => onOpen("appointments")}>Appointments</button>
        <button type="button" className="text-xs font-semibold text-blue-700 px-2 py-1.5" onClick={() => onOpen("queue")}>OPD</button>
        <button type="button" className="text-xs font-semibold text-blue-700 px-2 py-1.5" onClick={() => onOpen("billing")}>Billing</button>
      </div>

      {specialtyTiles}

      <p className="text-xs text-slate-400">Signed in as {doctor.name}</p>

      {showSetup && (
        <section className="bg-white rounded-2xl border border-slate-200/80 shadow-sm" data-testid="setup-checklist">
          <button
            type="button"
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
            onClick={() => setSetupOpen((open) => !open)}
            aria-expanded={setupOpen}
          >
            <span className="text-sm font-semibold text-slate-900">
              Setup · {progress.done} of {progress.total}
            </span>
            {setupOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
          </button>
          {setupOpen && (
            <ul className="px-4 pb-4 space-y-2">
              {checks.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium text-slate-800">{item.label}</span>
                    <span className="block text-xs text-slate-500">{item.detail}</span>
                  </span>
                  <span className={`text-[11px] font-semibold shrink-0 ${item.done ? "text-emerald-700" : "text-slate-400"}`}>
                    {item.done ? "Done" : "Open"}
                  </span>
                </li>
              ))}
              <li>
                <button type="button" className="text-xs font-semibold text-blue-700" onClick={() => onOpen("settings")}>
                  Clinic settings
                </button>
              </li>
            </ul>
          )}
        </section>
      )}
    </div>
  );
};

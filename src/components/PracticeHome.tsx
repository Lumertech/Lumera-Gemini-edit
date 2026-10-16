import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Appointment, AppUser, Doctor, Patient } from "../types";
import type { SpecialtyWorkflowPack } from "../lib/specialtyWorkflow";
import type { NavView } from "./Navbar";
import {
  formatHomeInr,
  formatVisitTime,
  pickNextVisit,
  greetingClinicName,
  homeKpiCards,
  homeMetrics,
  homeNudge,
  opdTrend,
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

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm px-3 py-2.5 min-w-0" data-testid="home-kpi">
      <p className="text-xs text-slate-500 whitespace-nowrap">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
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
      className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
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
    source: row.source,
    createdAt: row.createdAt,
  }));
  const metrics = homeMetrics(visits);
  const nudge = homeNudge(metrics, patients.length);
  const todayRows = appointments.filter((row) => row.date === metrics.today && row.status !== "Cancelled" && row.status !== "No-Show");
  const next = pickNextVisit(appointments, metrics.today);
  const [whatsAppConnected, setWhatsAppConnected] = useState(false);
  const [branches, setBranches] = useState<Array<{ id: string; name?: string; address?: string }>>([]);
  const showBranches = user.role === "CLINIC_ADMIN" || user.role === "polyclinic_admin";
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

  useEffect(() => {
    if (!showBranches) return;
    let cancelled = false;
    void apiFetch<{ branches?: Array<{ id: string; name?: string; address?: string }> }>("/api/branches")
      .then((data) => {
        if (!cancelled) setBranches(data.branches || []);
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [showBranches, user.tenantId]);

  const timeLabel = next ? formatVisitTime(next) : "";
  const kpis = homeKpiCards(metrics, patients.length);
  const trend = opdTrend(metrics);

  const specialtyTiles = (() => {
    if (pack.kind === "physio") {
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Tile title="Today's sessions">
              {next ? <p className="text-slate-800">{next.patientName} · {timeLabel}</p> : <p>No session booked.</p>}
            </Tile>
            <Tile title="Still to collect">
              <p>Pending {formatHomeInr(metrics.todayPending)}</p>
            </Tile>
          </div>
          <section className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4" data-testid="physio-setup-empty">
            <h3 className="text-sm font-semibold text-slate-900">Session packages</h3>
            <p className="mt-1 text-sm text-slate-600">Packages, home exercise logs, and outcome retests are not set up.</p>
            <button type="button" className="mt-3 text-sm font-semibold text-blue-700" onClick={() => onOpen("settings")}>
              Set up session packages
            </button>
          </section>
        </div>
      );
    }
    if (pack.kind === "dental") {
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Tile title="Chair schedule">
              {todayRows.length === 0 ? <p>No chair booked today.</p> : todayRows.slice(0, 4).map((row) => (
                <p key={row.id}>{formatVisitTime(row)} · {row.patientName}</p>
              ))}
            </Tile>
            <Tile title="Balances">
              <p>Outstanding today {formatHomeInr(metrics.todayPending)}</p>
            </Tile>
          </div>
          <section className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4" data-testid="dental-setup-empty">
            <h3 className="text-sm font-semibold text-slate-900">Treatment plans</h3>
            <p className="mt-1 text-sm text-slate-600">Quoted plans, lab work, and six-month recall are not set up.</p>
            <button type="button" className="mt-3 text-sm font-semibold text-blue-700" onClick={() => onOpen("settings")}>
              Set up the chair list
            </button>
          </section>
        </div>
      );
    }
    if (pack.kind === "medical") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Tile title="With the doctor">
            <p>{metrics.withDoctor === 0 ? "No one is in consult." : `${metrics.withDoctor} in consult.`}</p>
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
            <p>Still to collect {formatHomeInr(metrics.todayPending)}</p>
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

  const nextAction = (() => {
    if (canConsult && next && onStartConsult && next.status !== "Completed") {
      return <Action label="Start consult" testId="home-start-consult" onClick={() => onStartConsult(next)} />;
    }
    if (canConsult && next && !next.isPaid && onCreateBill && next.status === "Completed") {
      return <Action label="Create bill" testId="home-create-bill" onClick={() => onCreateBill(next)} />;
    }
    if (!canConsult && next && onCheckIn && next.status !== "In Consultation" && next.status !== "Completed") {
      return <Action label="Check in" testId="home-check-in" onClick={() => onCheckIn(next)} />;
    }
    if (!canConsult && next && next.status === "Waiting" && onReady) {
      return <Action label="Ready for doctor" testId="home-ready" onClick={() => onReady(next)} />;
    }
    if (!next && !canConsult && onCheckInWalkIn && patients.length > 0) {
      return <Action label="Check in" testId="home-check-in" onClick={onCheckInWalkIn} />;
    }
    return null;
  })();

  return (
    <div className="max-w-6xl mx-auto space-y-3 sm:space-y-5 min-w-0" data-testid="practice-home">
      <div className="rounded-2xl bg-white border border-slate-200/80 px-4 py-3 sm:px-5 sm:py-4">
        <h2 className="text-[13px] leading-5 sm:text-lg sm:leading-7 font-semibold tracking-tight text-slate-900">Welcome back to {clinic}</h2>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <Kpi label={kpis[0].label} value={kpis[0].value} />
        <Kpi label={kpis[1].label} value={kpis[1].value} />
        <Kpi label={kpis[2].label} value={kpis[2].value} />
        <Kpi label={kpis[3].label} value={kpis[3].value} />
      </div>

      <section
        className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        data-testid="home-next-action"
      >
        <div className="min-w-0">
          <p className="text-xs text-slate-500">Next visit</p>
          {next ? (
            <>
              <p className="font-semibold text-slate-900 truncate">{next.patientName}</p>
              <p className="text-xs text-slate-500">{timeLabel}</p>
            </>
          ) : (
            <p className="font-semibold text-slate-900">No visit is waiting.</p>
          )}
        </div>
        {nextAction}
      </section>

      <p className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-sm text-amber-950" data-testid="home-nudge">
        {nudge}
      </p>

      <section className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 sm:p-5 space-y-3" data-testid="home-opd-trend">
        <h3 className="text-sm font-semibold text-slate-900">OPD trend</h3>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-slate-50 px-3 py-2.5 min-w-0">
            <p className="text-xs text-slate-500 whitespace-nowrap">{trend[0].label}</p>
            <p className="text-xl font-semibold text-slate-900 tabular-nums" data-testid="home-today-breakdown">{trend[0].value}</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2.5 min-w-0">
            <p className="text-xs text-slate-500 whitespace-nowrap">{trend[1].label}</p>
            <p className="text-xl font-semibold text-slate-900 tabular-nums">{trend[1].value}</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2.5 min-w-0">
            <p className="text-xs text-slate-500 whitespace-nowrap">{trend[2].label}</p>
            <p className="text-xl font-semibold text-slate-900 tabular-nums">{trend[2].value}</p>
          </div>
        </div>
      </section>

      {specialtyTiles}

      {showBranches && (
        <section className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4" data-testid="home-branches">
          <h3 className="text-sm font-semibold text-slate-900">Branches</h3>
          {branches.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">No branches are saved for this clinic.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {branches.map((branch) => (
                <li key={branch.id}>{branch.name || "Unnamed branch"}{branch.address ? ` · ${branch.address}` : ""}</li>
              ))}
            </ul>
          )}
        </section>
      )}

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

      <p className="text-xs text-slate-400">Signed in as {doctor.name}</p>
    </div>
  );
};

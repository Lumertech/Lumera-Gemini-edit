import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  FlaskConical,
  PawPrint,
  Plus,
  Scissors,
  ShieldCheck,
  Stethoscope,
  Syringe,
  Users,
} from "lucide-react";
import type {
  Appointment,
  Doctor,
  LabReportRecord,
  Patient,
  Prescription,
  VeterinaryAssessment,
} from "../types";
import type { NavView } from "./Navbar";
import { apiFetch } from "../api/http";
import { clinicCalendarDate } from "../lib/clinicDay";
import { formatHomeInr } from "../lib/clinicNav";
import { inferHouseholdHolderName, phoneKey10 } from "../lib/sharedMobile";

interface VeterinaryPracticeDeckProps {
  patients: Patient[];
  appointments: Appointment[];
  prescriptions?: Prescription[];
  doctor: Doctor;
  todayPendingInr: number;
  withDoctorCount: number;
  followUpsToday: number;
  onOpen: (view: NavView) => void;
  onSelectPatient?: (patient: Patient) => void;
  onStartConsult?: (appointment: Appointment) => void;
  onRegisterSiblingPet?: (phone: string) => void;
}

type VetDeckTab = "households" | "vaccines" | "tickfever" | "surgery";

interface VetSurgeryBiteEntry {
  id: string;
  date: string;
  patientId: string;
  patientName: string;
  uhid: string;
  speciesBreed: string;
  ownerName: string;
  asaGrade: string;
  procedureOrIncident: string;
  sutureOrDay10Note: string;
  biteStatus: string;
  source: "rx" | "manual";
}

const STORAGE_KEY = "lumera_vet_surgery_bite_log_v1";

function readStoredLogs(): VetSurgeryBiteEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const VeterinaryPracticeDeck: React.FC<VeterinaryPracticeDeckProps> = ({
  patients,
  appointments,
  prescriptions: propPrescriptions,
  doctor,
  todayPendingInr,
  withDoctorCount,
  followUpsToday,
  onOpen,
  onSelectPatient,
  onStartConsult,
  onRegisterSiblingPet,
}) => {
  const [activeTab, setActiveTab] = useState<VetDeckTab>("households");
  const [fetchedRx, setFetchedRx] = useState<Prescription[]>([]);
  const [labReports, setLabReports] = useState<LabReportRecord[]>([]);
  const [manualLogs, setManualLogs] = useState<VetSurgeryBiteEntry[]>(() => readStoredLogs());
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [logPatientId, setLogPatientId] = useState("");
  const [logProcedure, setLogProcedure] = useState("Ovariohysterectomy (Spay)");
  const [logAsa, setLogAsa] = useState("ASA I");
  const [logNote, setLogNote] = useState("E-collar 10 days • Suture removal Day 10");
  const [logBiteStatus, setLogBiteStatus] = useState("Not Applicable");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiFetch<{ prescriptions?: Prescription[] }>("/api/prescriptions").catch(() => ({ prescriptions: [] })),
      apiFetch<{ labReports?: LabReportRecord[]; reports?: LabReportRecord[] }>("/api/lab-reports").catch(() => ({ labReports: [], reports: [] })),
    ]).then(([rxRes, labRes]) => {
      if (cancelled) return;
      if (Array.isArray(rxRes.prescriptions)) setFetchedRx(rxRes.prescriptions);
      const nextLabs = Array.isArray(labRes.labReports)
        ? labRes.labReports
        : Array.isArray(labRes.reports)
          ? labRes.reports
          : [];
      setLabReports(nextLabs);
    });
    return () => {
      cancelled = true;
    };
  }, [doctor.id, patients.length]);

  const prescriptions = useMemo(() => {
    const byId = new Map<string, Prescription>();
    for (const r of propPrescriptions || []) if (r?.id) byId.set(r.id, r);
    for (const r of fetchedRx) if (r?.id) byId.set(r.id, r);
    return [...byId.values()];
  }, [propPrescriptions, fetchedRx]);

  const latestVetByPatient = useMemo(() => {
    const map = new Map<string, { rx: Prescription; vet: VeterinaryAssessment }>();
    for (const rx of prescriptions) {
      if (!rx.patientId || !rx.veterinaryAssessment) continue;
      if (!map.has(rx.patientId)) {
        map.set(rx.patientId, { rx, vet: rx.veterinaryAssessment });
      }
    }
    return map;
  }, [prescriptions]);

  const households = useMemo(() => {
    const groups = new Map<string, Patient[]>();
    for (const p of patients) {
      const k = phoneKey10(p.phone) || p.id;
      const list = groups.get(k) || [];
      list.push(p);
      groups.set(k, list);
    }
    return [...groups.entries()]
      .map(([phoneKey, members]) => ({
        phoneKey,
        phoneDisplay: members[0]?.phone || phoneKey,
        holderName:
          inferHouseholdHolderName(members) ||
          members[0]?.ownerName ||
          members[0]?.primaryContactName ||
          "Pet Parent",
        members,
      }))
      .sort((a, b) => b.members.length - a.members.length);
  }, [patients]);

  const multiPetHouseholdCount = households.filter((h) => h.members.length > 1).length;

  const tickFeverWatchRows = useMemo(() => {
    return prescriptions
      .filter((rx) => {
        const v = rx.veterinaryAssessment;
        if (!v) return false;
        return (
          v.clinicalMode === "Tick-Fever & Internal Med" ||
          (v.vectorSnap4DxStatus && v.vectorSnap4DxStatus !== "Not Tested" && v.vectorSnap4DxStatus !== "Negative") ||
          (typeof v.plateletCountLakhs === "number" && v.plateletCountLakhs < 1.5) ||
          (typeof v.rectalTempF === "number" && v.rectalTempF > 102.5)
        );
      })
      .map((rx) => ({
        rx,
        vet: rx.veterinaryAssessment!,
        patient: patients.find((p) => p.id === rx.patientId),
      }));
  }, [prescriptions, patients]);

  const combinedSurgeryLogs = useMemo(() => {
    const fromRx: VetSurgeryBiteEntry[] = prescriptions
      .filter(
        (rx) =>
          rx.veterinaryAssessment?.clinicalMode === "Surgery, Spay/Neuter & Bite" ||
          (rx.veterinaryAssessment?.biteQuarantineStatus &&
            rx.veterinaryAssessment.biteQuarantineStatus !== "Not Applicable")
      )
      .map((rx) => {
        const v = rx.veterinaryAssessment!;
        const pat = patients.find((p) => p.id === rx.patientId);
        return {
          id: `rx-${rx.id}`,
          date: rx.date,
          patientId: rx.patientId,
          patientName: rx.patientName,
          uhid: rx.patientUhid,
          speciesBreed: `${v.species || pat?.species || "Pet"} • ${v.breed || pat?.breed || "Companion"}`,
          ownerName: v.ownerName || pat?.ownerName || pat?.primaryContactName || "—",
          asaGrade: v.asaRiskGrade || "ASA I",
          procedureOrIncident: v.procedurePlanned || rx.diagnosis,
          sutureOrDay10Note: v.eCollarAndSutureDate || rx.followUpDate || "Day 10 review",
          biteStatus: v.biteQuarantineStatus || "Not Applicable",
          source: "rx",
        };
      });
    return [...manualLogs, ...fromRx];
  }, [prescriptions, patients, manualLogs]);

  const openConsultForPatient = (p: Patient) => {
    const today = clinicCalendarDate();
    const todayApt = appointments.find(
      (a) => a.patientId === p.id && a.date === today && a.status !== "Completed"
    );
    if (todayApt && onStartConsult) {
      onStartConsult(todayApt);
      return;
    }
    onSelectPatient?.(p);
    onOpen("rx");
  };

  const handleSaveManualLog = (e: React.FormEvent) => {
    e.preventDefault();
    const pat = patients.find((p) => p.id === logPatientId) || patients[0];
    if (!pat) return;
    const entry: VetSurgeryBiteEntry = {
      id: `vet-log-${Date.now()}`,
      date: clinicCalendarDate(),
      patientId: pat.id,
      patientName: pat.name,
      uhid: pat.uhid,
      speciesBreed: `${pat.species || "Dog"} • ${pat.breed || "Companion"}`,
      ownerName: pat.ownerName || pat.primaryContactName || pat.emergencyContact || "—",
      asaGrade: logAsa,
      procedureOrIncident: logProcedure.trim() || "Surgical Procedure",
      sutureOrDay10Note: logNote.trim() || "Day 10 review",
      biteStatus: logBiteStatus,
      source: "manual",
    };
    const next = [entry, ...manualLogs];
    setManualLogs(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
    setIsLogModalOpen(false);
  };

  return (
    <section
      data-testid="veterinary-practice-deck"
      className="bg-white rounded-2xl border border-amber-200/90 shadow-sm overflow-hidden space-y-0"
    >
      {/* Command Header */}
      <div className="bg-gradient-to-r from-amber-950 via-stone-900 to-slate-900 text-white p-4 sm:p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-400/20 border border-amber-300/30 flex items-center justify-center text-amber-200 shrink-0">
              <PawPrint className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-400/30">
                Companion Animal Command Deck
              </span>
              <h2 className="text-base sm:text-lg font-bold text-white mt-0.5">
                Multi-Pet Households, WSAVA India Vaccines &amp; Tick-Fever Triage
              </h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-lg bg-white/10 border border-white/15 text-amber-100 font-medium">
              Multi-Pet Mobiles: <strong>{multiPetHouseholdCount}</strong>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-white/10 border border-white/15 text-amber-100 font-medium">
              In Consult: <strong>{withDoctorCount}</strong>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-white/10 border border-white/15 text-amber-100 font-medium">
              Follow-ups: <strong>{followUpsToday}</strong>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-white/10 border border-white/15 text-amber-100 font-medium">
              Due Today: <strong>{formatHomeInr(todayPendingInr)}</strong>
            </span>
          </div>
        </div>

        {/* 4 Interactive Tabs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5 pt-1">
          <button
            type="button"
            data-testid="vet-tab-households"
            onClick={() => setActiveTab("households")}
            className={`px-3 py-2 rounded-xl text-xs font-semibold text-left border transition-all flex items-center gap-2 ${
              activeTab === "households"
                ? "bg-amber-400 text-stone-950 border-amber-300 font-bold shadow-xs"
                : "bg-white/10 text-amber-100 border-white/15 hover:bg-white/15"
            }`}
          >
            <Users className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Multi-Pet Households ({households.length})</span>
          </button>

          <button
            type="button"
            data-testid="vet-tab-vaccines"
            onClick={() => setActiveTab("vaccines")}
            className={`px-3 py-2 rounded-xl text-xs font-semibold text-left border transition-all flex items-center gap-2 ${
              activeTab === "vaccines"
                ? "bg-amber-400 text-stone-950 border-amber-300 font-bold shadow-xs"
                : "bg-white/10 text-amber-100 border-white/15 hover:bg-white/15"
            }`}
          >
            <Syringe className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">WSAVA Rabies &amp; Deworming</span>
          </button>

          <button
            type="button"
            data-testid="vet-tab-tickfever"
            onClick={() => setActiveTab("tickfever")}
            className={`px-3 py-2 rounded-xl text-xs font-semibold text-left border transition-all flex items-center gap-2 ${
              activeTab === "tickfever"
                ? "bg-amber-400 text-stone-950 border-amber-300 font-bold shadow-xs"
                : "bg-white/10 text-amber-100 border-white/15 hover:bg-white/15"
            }`}
          >
            <Activity className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Tick-Fever &amp; Triage ({tickFeverWatchRows.length})</span>
          </button>

          <button
            type="button"
            data-testid="vet-tab-surgery"
            onClick={() => setActiveTab("surgery")}
            className={`px-3 py-2 rounded-xl text-xs font-semibold text-left border transition-all flex items-center gap-2 ${
              activeTab === "surgery"
                ? "bg-amber-400 text-stone-950 border-amber-300 font-bold shadow-xs"
                : "bg-white/10 text-amber-100 border-white/15 hover:bg-white/15"
            }`}
          >
            <Scissors className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Spay/Neuter &amp; 10d Bite Log ({combinedSurgeryLogs.length})</span>
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-4 sm:p-5 space-y-4">
        {activeTab === "households" && (
          <div className="space-y-3" data-testid="vet-households-panel">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Shared-Mobile Pet Parent Households &amp; Weight Board
                </h3>
                <p className="text-xs text-slate-600">
                  Multiple dogs and cats under one pet parent mobile share owner contact while keeping independent UHIDs, weight curves, and vaccine charts.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpen("reception")}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
              >
                <Plus className="w-3.5 h-3.5" />
                Intake New Pet
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {households.map((hh) => (
                <div
                  key={hh.phoneKey}
                  className={`rounded-xl border p-3.5 space-y-2.5 ${
                    hh.members.length > 1
                      ? "border-amber-300 bg-amber-50/50"
                      : "border-slate-200 bg-slate-50/60"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <strong className="text-xs font-bold text-slate-900">{hh.holderName}</strong>
                        <span className="font-mono text-[11px] text-slate-600">{hh.phoneDisplay}</span>
                        {hh.members.length > 1 && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-200/80 text-amber-950 text-[10px] font-bold">
                            {hh.members.length} Pets on 1 Mobile
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (onRegisterSiblingPet) onRegisterSiblingPet(hh.phoneDisplay);
                        else onOpen("reception");
                      }}
                      className="px-2.5 py-1 rounded-md bg-white border border-amber-300 text-amber-900 text-[11px] font-semibold hover:bg-amber-100/60"
                    >
                      + Register Sibling Pet
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {hh.members.map((pet) => {
                      const latest = latestVetByPatient.get(pet.id)?.vet;
                      const sp = String(pet.species || latest?.species || "dog").toLowerCase();
                      const icon = sp === "cat" ? "🐱" : "🐾";
                      const weight = latest?.bodyWeightKg;
                      const bcs = latest?.bodyConditionScore;
                      return (
                        <div
                          key={pet.id}
                          className="rounded-lg bg-white border border-slate-200 px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-bold text-slate-900">
                                {icon} {pet.name}
                              </span>
                              <span className="text-slate-600">
                                {pet.breed || latest?.breed || "Companion"} ({pet.age}y)
                              </span>
                              <span className="font-mono text-[10px] text-slate-400">{pet.uhid}</span>
                            </div>
                            <div className="text-[11px] text-slate-500 flex flex-wrap gap-2 mt-0.5">
                              {typeof weight === "number" && (
                                <span className="font-mono font-semibold text-amber-900">Wt: {weight} kg</span>
                              )}
                              {typeof bcs === "number" && <span>BCS: {bcs}/9</span>}
                              {latest?.microchipId && (
                                <span className="font-mono">Chip: {latest.microchipId}</span>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => openConsultForPatient(pet)}
                            className="shrink-0 px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold inline-flex items-center gap-1"
                          >
                            <Stethoscope className="w-3 h-3" />
                            Open Consult
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "vaccines" && (
          <div className="space-y-3" data-testid="vet-vaccines-panel">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                WSAVA India Anti-Rabies, Core Vaccine &amp; Deworming Recall Register
              </h3>
              <p className="text-xs text-slate-600">
                Tracks Canine DHPPiL, Feline FVRCP, statutory Anti-Rabies (ARV) batch numbers, quarterly deworming, and ectoparasite cover.
              </p>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <th className="py-2.5 px-3 font-bold">Pet &amp; Species</th>
                    <th className="py-2.5 px-3 font-bold">Pet Parent &amp; Mobile</th>
                    <th className="py-2.5 px-3 font-bold">Anti-Rabies (ARV)</th>
                    <th className="py-2.5 px-3 font-bold">Core (DHPPiL / FVRCP)</th>
                    <th className="py-2.5 px-3 font-bold">Deworming &amp; Tick Cover</th>
                    <th className="py-2.5 px-3 font-bold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {patients.map((pet) => {
                    const latest = latestVetByPatient.get(pet.id)?.vet;
                    const sp = String(pet.species || latest?.species || "dog").toLowerCase();
                    return (
                      <tr key={pet.id} className="hover:bg-amber-50/30">
                        <td className="py-2.5 px-3">
                          <strong className="text-slate-900 block">
                            {sp === "cat" ? "🐱" : "🐾"} {pet.name}
                          </strong>
                          <span className="text-[11px] text-slate-500">
                            {pet.breed || latest?.breed || "Companion"} • {pet.dateOfBirth || `${pet.age}y`}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="font-medium text-slate-800 block">
                            {pet.ownerName || pet.primaryContactName || latest?.ownerName || "—"}
                          </span>
                          <span className="font-mono text-[11px] text-slate-500">{pet.phone}</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="font-semibold text-emerald-800 block">
                            {latest?.antiRabiesStatus || "Puppy/Kitten Schedule Active"}
                          </span>
                          {latest?.antiRabiesCertNo && (
                            <span className="font-mono text-[10px] text-slate-500">{latest.antiRabiesCertNo}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-slate-700">
                          {latest?.coreVaccineStatus || (sp === "cat" ? "FVRCP Series" : "DHPPiL Series")}
                        </td>
                        <td className="py-2.5 px-3 text-slate-700">
                          <span className="block">{latest?.dewormingProductAndDose || "Quarterly Deworming"}</span>
                          {latest?.ectoparasiteProphylaxis && (
                            <span className="text-[10px] text-amber-800 block">{latest.ectoparasiteProphylaxis}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <button
                            type="button"
                            onClick={() => openConsultForPatient(pet)}
                            className="px-2.5 py-1 rounded-md bg-amber-100 hover:bg-amber-200 text-amber-950 font-semibold text-[11px]"
                          >
                            Vaccine Chart
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "tickfever" && (
          <div className="space-y-4" data-testid="vet-tickfever-panel">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Canine Tick-Fever (Ehrlichia / Babesia / Anaplasma) &amp; Acute Triage Watch
              </h3>
              <p className="text-xs text-slate-600">
                Monitors SNAP 4Dx positives, thrombocytopenia (&lt;1.5 lakhs/µL), anemia (PCV &lt;30%), and IV fluid daycare cohorts.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {tickFeverWatchRows.map(({ rx, vet, patient }) => (
                <div
                  key={rx.id}
                  className="rounded-xl border border-rose-200 bg-rose-50/40 p-3.5 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm font-bold text-slate-900">
                      🐾 {rx.patientName} ({vet.breed || patient?.breed || "Canine"})
                    </strong>
                    <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300 text-[10px] font-bold">
                      {vet.vectorSnap4DxStatus || "Acute Triage"}
                    </span>
                  </div>
                  <p className="text-slate-700 font-medium">{rx.diagnosis}</p>
                  <div className="flex flex-wrap gap-2 text-[11px] text-slate-700">
                    {typeof vet.rectalTempF === "number" && (
                      <span className="px-2 py-0.5 rounded bg-white border border-rose-200 font-mono">
                        Temp: {vet.rectalTempF}°F
                      </span>
                    )}
                    {typeof vet.plateletCountLakhs === "number" && (
                      <span className="px-2 py-0.5 rounded bg-white border border-rose-200 font-mono font-bold text-rose-800">
                        Platelets: {vet.plateletCountLakhs} L/µL
                      </span>
                    )}
                    {typeof vet.pcvPercent === "number" && (
                      <span className="px-2 py-0.5 rounded bg-white border border-rose-200 font-mono">
                        PCV: {vet.pcvPercent}%
                      </span>
                    )}
                  </div>
                  {vet.fluidTherapyPlan && (
                    <p className="text-[11px] text-slate-600">
                      <strong>Daycare Plan:</strong> {vet.fluidTherapyPlan}
                    </p>
                  )}
                  {patient && (
                    <button
                      type="button"
                      onClick={() => openConsultForPatient(patient)}
                      className="px-2.5 py-1 rounded-md bg-rose-700 hover:bg-rose-800 text-white text-[11px] font-semibold"
                    >
                      Open Case Sheet
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Verified Veterinary Pathology Panels Strip */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <FlaskConical className="w-4 h-4 text-indigo-600" />
                  Recent Veterinary Pathology &amp; Rapid Antigen Panels ({labReports.length})
                </h4>
                <button
                  type="button"
                  onClick={() => onOpen("reports")}
                  className="text-xs font-semibold text-indigo-700 hover:underline"
                >
                  Open Lab Analyzer
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {labReports.slice(0, 6).map((rep) => (
                  <div key={rep.id} className="rounded-lg bg-white border border-slate-200 p-2.5 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <strong className="text-slate-900 truncate">{rep.patientName}</strong>
                      <span className="font-mono text-[10px] text-slate-500">{rep.date}</span>
                    </div>
                    <p className="text-[11px] font-semibold text-indigo-800 truncate">{rep.category}</p>
                    {rep.doctorInterpretation && (
                      <p className="text-[11px] text-slate-600 line-clamp-2">{rep.doctorInterpretation}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "surgery" && (
          <div className="space-y-3" data-testid="vet-surgery-panel">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-amber-700" />
                  Spay / Neuter Theatre &amp; Statutory 10-Day Animal Bite Observation Register
                </h3>
                <p className="text-xs text-slate-600">
                  Tracks ASA anesthetic risk, suture removal dates, E-collar compliance, and 10-day post-bite rabies observation status.
                </p>
              </div>
              <button
                type="button"
                data-testid="vet-add-surgery-log"
                onClick={() => {
                  if (!logPatientId && patients[0]?.id) setLogPatientId(patients[0].id);
                  setIsLogModalOpen(true);
                }}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
              >
                <Plus className="w-3.5 h-3.5" />
                + Log Surgery / Observation Entry
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <th className="py-2.5 px-3 font-bold">Date</th>
                    <th className="py-2.5 px-3 font-bold">Pet &amp; Breed</th>
                    <th className="py-2.5 px-3 font-bold">Owner</th>
                    <th className="py-2.5 px-3 font-bold">ASA</th>
                    <th className="py-2.5 px-3 font-bold">Procedure / Incident</th>
                    <th className="py-2.5 px-3 font-bold">Suture / 10-Day Bite Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {combinedSurgeryLogs.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">{entry.date}</td>
                      <td className="py-2.5 px-3">
                        <strong className="text-slate-900 block">{entry.patientName}</strong>
                        <span className="text-[11px] text-slate-500">{entry.speciesBreed}</span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700">{entry.ownerName}</td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-mono font-bold text-[10px]">
                          {entry.asaGrade}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-900">{entry.procedureOrIncident}</td>
                      <td className="py-2.5 px-3">
                        <span className="block text-slate-700">{entry.sutureOrDay10Note}</span>
                        {entry.biteStatus && entry.biteStatus !== "Not Applicable" && (
                          <span className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                            <AlertTriangle className="w-3 h-3" />
                            {entry.biteStatus}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Log Surgery / Bite Observation Modal */}
      {isLogModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 border border-slate-200 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h3 className="text-sm font-bold text-slate-900">Log Surgery or 10-Day Bite Observation</h3>
              <button
                type="button"
                onClick={() => setIsLogModalOpen(false)}
                className="text-xs text-slate-500 hover:text-slate-800"
              >
                Close
              </button>
            </div>
            <form onSubmit={handleSaveManualLog} className="space-y-3 text-xs">
              <label className="block">
                <span className="font-semibold text-slate-700">Select Pet Patient</span>
                <select
                  value={logPatientId}
                  onChange={(e) => setLogPatientId(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 bg-white"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.breed || p.species || "Pet"} • {p.phone})
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="font-semibold text-slate-700">ASA Risk Grade</span>
                  <select
                    value={logAsa}
                    onChange={(e) => setLogAsa(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="ASA I">ASA I</option>
                    <option value="ASA II">ASA II</option>
                    <option value="ASA III">ASA III</option>
                    <option value="ASA IV-E">ASA IV-E</option>
                  </select>
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">10-Day Bite Status</span>
                  <select
                    value={logBiteStatus}
                    onChange={(e) => setLogBiteStatus(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="Not Applicable">Not Applicable</option>
                    <option value="Day 0 Bite Reported — 10d Observation">Day 0 Bite Reported</option>
                    <option value="Day 5 Healthy">Day 5 Healthy</option>
                    <option value="Day 10 Cleared">Day 10 Cleared</option>
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="font-semibold text-slate-700">Procedure / Incident</span>
                <input
                  type="text"
                  required
                  value={logProcedure}
                  onChange={(e) => setLogProcedure(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300"
                />
              </label>

              <label className="block">
                <span className="font-semibold text-slate-700">Suture Removal / Post-Op Care Note</span>
                <input
                  type="text"
                  value={logNote}
                  onChange={(e) => setLogNote(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300"
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsLogModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold"
                >
                  Save Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};

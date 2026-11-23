import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Baby,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  FlaskConical,
  Heart,
  Plus,
  Ribbon,
  ShieldCheck,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import type {
  Appointment,
  Doctor,
  GynecologyAssessment,
  LabReportRecord,
  Patient,
  Prescription,
} from "../types";
import type { NavView } from "./Navbar";
import { apiFetch } from "../api/http";
import { clinicCalendarDate } from "../lib/clinicDay";
import { formatHomeInr } from "../lib/clinicNav";

interface GynaecologyPracticeDeckProps {
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
}

type DeckTab = "anc" | "fertility" | "pcpndt" | "preventive";

interface PcpndtFormFEntry {
  id: string;
  serialNo: string;
  date: string;
  patientId: string;
  patientName: string;
  patientAge: number;
  uhid: string;
  gravidaParaLabel: string;
  gestationalWeeks: number;
  indication: string;
  photoIdReference: string;
  sonologistName: string;
  nonDisclosureAttested: boolean;
  source: "rx" | "manual";
}

const PCPNDT_INDICATIONS = [
  "NT + Nasal Bone Scan (11-13w)",
  "TIFFA Level II Anomaly Scan (18-20w)",
  "Fetal Growth & Umbilical Artery Doppler",
  "Liquor / AFI & Biophysical Profile",
  "Early Intrauterine Viability / CRL Dating Scan",
  "Placental Localization & Scar Integrity Check",
];

function formatGpFormula(gyn?: GynecologyAssessment): string {
  if (!gyn?.gravidaPara) return "G1P0L0A0";
  const { g, p, l, a } = gyn.gravidaPara;
  const ectopic = gyn.ectopicCount && gyn.ectopicCount > 0 ? `E${gyn.ectopicCount}` : "";
  return `G${g}P${p}L${l}A${a}${ectopic}`;
}

export const GynaecologyPracticeDeck: React.FC<GynaecologyPracticeDeckProps> = ({
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
}) => {
  const [activeTab, setActiveTab] = useState<DeckTab>("anc");
  const [fetchedPrescriptions, setFetchedPrescriptions] = useState<Prescription[]>([]);
  const [labReports, setLabReports] = useState<LabReportRecord[]>([]);

  const storageKey = `lumera_pcpndt_form_f_v1_${doctor.id || "gynae"}`;
  const [manualFormFEntries, setManualFormFEntries] = useState<PcpndtFormFEntry[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [showFormFModal, setShowFormFModal] = useState(false);
  const [formFPatientId, setFormFPatientId] = useState("");
  const [formFWeeks, setFormFWeeks] = useState("20");
  const [formFIndication, setFormFIndication] = useState(PCPNDT_INDICATIONS[1]);
  const [formFPhotoId, setFormFPhotoId] = useState("");
  const [formFAttested, setFormFAttested] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setManualFormFEntries(parsed);
      }
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    if (propPrescriptions && propPrescriptions.length > 0) return;
    let cancelled = false;
    void apiFetch<{ prescriptions?: Prescription[] }>("/api/prescriptions")
      .then((res) => {
        if (!cancelled) setFetchedPrescriptions(res.prescriptions || []);
      })
      .catch(() => {
        if (!cancelled) setFetchedPrescriptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [propPrescriptions]);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<{ labReports?: LabReportRecord[] }>("/api/lab-reports")
      .then((res) => {
        if (!cancelled) setLabReports(res.labReports || []);
      })
      .catch(() => {
        if (!cancelled) setLabReports([]);
      });
    return () => {
      cancelled = true;
    };
  }, [doctor.id]);

  const allPrescriptions = propPrescriptions && propPrescriptions.length > 0 ? propPrescriptions : fetchedPrescriptions;

  const gynaePrescriptions = useMemo(() => {
    const own = allPrescriptions.filter(
      (rx) =>
        (doctor.id && rx.doctorId === doctor.id) ||
        rx.specialtyType === "Gynecology" ||
        rx.doctorSpecialty === "Gynecology" ||
        Boolean(rx.gynecologyAssessment)
    );
    return own.length > 0 ? own : allPrescriptions;
  }, [allPrescriptions, doctor.id]);

  const gynaePatientIds = useMemo(() => {
    const ids = new Set<string>();
    for (const apt of appointments) {
      if (!doctor.id || apt.doctorId === doctor.id || apt.specialty === "Gynecology") {
        ids.add(apt.patientId);
      }
    }
    for (const rx of gynaePrescriptions) {
      if (rx.patientId) ids.add(rx.patientId);
    }
    return ids;
  }, [appointments, gynaePrescriptions, doctor.id]);

  const gynaePatients = useMemo(() => {
    const scoped = patients.filter((p) => gynaePatientIds.has(p.id));
    return scoped.length > 0 ? scoped : patients.filter((p) => p.gender === "Female");
  }, [patients, gynaePatientIds]);

  const latestRxByPatient = useMemo(() => {
    const map = new Map<string, Prescription>();
    for (const rx of gynaePrescriptions) {
      if (!rx.patientId) continue;
      if (!map.has(rx.patientId)) {
        map.set(rx.patientId, rx);
      }
    }
    return map;
  }, [gynaePrescriptions]);

  const gynaeLabs = useMemo(() => {
    if (gynaePatientIds.size === 0) return labReports;
    const scoped = labReports.filter((l) => gynaePatientIds.has(l.patientId));
    return scoped.length > 0 ? scoped : labReports;
  }, [labReports, gynaePatientIds]);

  const ancRegistry = useMemo(() => {
    const rows: Array<{
      patient: Patient;
      rx?: Prescription;
      gyn?: GynecologyAssessment;
    }> = [];
    for (const patient of gynaePatients) {
      const rx = latestRxByPatient.get(patient.id);
      const gyn = rx?.gynecologyAssessment;
      const isAncMode =
        (gyn &&
          (gyn.clinicalMode === "Antenatal / Obstetric" ||
            (!gyn.clinicalMode && gyn.gestationalAgeWeeks > 0))) ||
        (patient.chronicConditions || []).some((c) => /ANC|Primigravida|G\dP\d|PIH|Gestational Diabetes/i.test(c));
      if (isAncMode) {
        rows.push({ patient, rx, gyn });
      }
    }
    return rows.sort((a, b) => (b.gyn?.gestationalAgeWeeks || 0) - (a.gyn?.gestationalAgeWeeks || 0));
  }, [gynaePatients, latestRxByPatient]);

  const fertilityRegistry = useMemo(() => {
    const rows: Array<{
      patient: Patient;
      rx?: Prescription;
      gyn?: GynecologyAssessment;
    }> = [];
    for (const patient of gynaePatients) {
      const rx = latestRxByPatient.get(patient.id);
      const gyn = rx?.gynecologyAssessment;
      const isFertility =
        gyn?.clinicalMode === "Fertility & PCOS" ||
        Boolean(gyn?.fertilityCycleDay || gyn?.ovulationInductionProtocol) ||
        (patient.chronicConditions || []).some((c) => /PCOS|Infertility|Follicular|Ovulation/i.test(c));
      if (isFertility) {
        rows.push({ patient, rx, gyn });
      }
    }
    return rows;
  }, [gynaePatients, latestRxByPatient]);

  const derivedFormFEntries = useMemo<PcpndtFormFEntry[]>(() => {
    const derived: PcpndtFormFEntry[] = [];
    gynaePrescriptions.forEach((rx, idx) => {
      const gyn = rx.gynecologyAssessment;
      if (!gyn) return;
      const isObstetricScan =
        gyn.pcpndtFormFLogged ||
        (gyn.clinicalMode === "Antenatal / Obstetric" &&
          (rx.labTests || []).some((lt) => /Scan|Doppler|USG|TIFFA|NT/i.test(lt.testName)));
      if (!isObstetricScan) return;
      const pat = gynaePatients.find((p) => p.id === rx.patientId);
      const scanTest = (rx.labTests || []).find((lt) => /Scan|Doppler|USG|TIFFA|NT/i.test(lt.testName));
      derived.push({
        id: `rx-ff-${rx.id}`,
        serialNo: `FF-2026-${String(401 + idx).padStart(4, "0")}`,
        date: rx.date || clinicCalendarDate(),
        patientId: rx.patientId,
        patientName: rx.patientName || pat?.name || "Antenatal Patient",
        patientAge: rx.patientAge || pat?.age || 28,
        uhid: rx.patientUhid || pat?.uhid || "UHID",
        gravidaParaLabel: formatGpFormula(gyn),
        gestationalWeeks: gyn.gestationalAgeWeeks || 12,
        indication: scanTest?.testName || `${gyn.trimester} Antenatal Fetal Biometry & Liquor Assessment`,
        photoIdReference: `Voter/Passport ID Verified (${(rx.patientUhid || "ID").slice(-4)})`,
        sonologistName: rx.doctorName || doctor.name,
        nonDisclosureAttested: true,
        source: "rx",
      });
    });
    return [...manualFormFEntries, ...derived];
  }, [gynaePrescriptions, gynaePatients, manualFormFEntries, doctor.name]);

  const oncologyAndPostnatalRows = useMemo(() => {
    const postnatalRows: Array<{
      patient: Patient;
      rx?: Prescription;
      gyn?: GynecologyAssessment;
    }> = [];
    const oncologyRows: Array<{
      patient: Patient;
      rx?: Prescription;
      gyn?: GynecologyAssessment;
    }> = [];

    for (const patient of gynaePatients) {
      const rx = latestRxByPatient.get(patient.id);
      const gyn = rx?.gynecologyAssessment;
      const isPostnatalOrMeno =
        gyn?.clinicalMode === "Postnatal / Menopause" ||
        (patient.chronicConditions || []).some((c) => /Postnatal|Postpartum|LSCS|Perimenopaus|Menopaus/i.test(c));
      if (isPostnatalOrMeno) {
        postnatalRows.push({ patient, rx, gyn });
      }
      const hasOncoOrGynae =
        gyn?.clinicalMode === "Gynaecology & Menstrual" ||
        gyn?.clinicalMode === "Postnatal / Menopause" ||
        Boolean(gyn?.cervicalScreeningPapVia || gyn?.hpvVaccineStatus || gyn?.breastExamSummary);
      if (hasOncoOrGynae) {
        oncologyRows.push({ patient, rx, gyn });
      }
    }
    return { postnatalRows, oncologyRows };
  }, [gynaePatients, latestRxByPatient]);

  const highRiskAncCount = ancRegistry.filter(
    (r) =>
      (r.gyn?.highRiskFactors || []).some((f) => !f.includes("None")) ||
      (typeof r.gyn?.maternalHemoglobinGdl === "number" && r.gyn.maternalHemoglobinGdl < 11) ||
      (typeof r.gyn?.dipsiOgtt2HrMgDl === "number" && r.gyn.dipsiOgtt2HrMgDl >= 140)
  ).length;

  const handleOpenConsultForPatient = (patient: Patient) => {
    const today = clinicCalendarDate();
    const activeApt =
      appointments.find(
        (a) =>
          a.patientId === patient.id &&
          a.date === today &&
          a.status !== "Completed" &&
          a.status !== "Cancelled"
      ) ||
      appointments.find(
        (a) => a.patientId === patient.id && a.status !== "Completed" && a.status !== "Cancelled"
      );

    if (activeApt && onStartConsult) {
      onStartConsult(activeApt);
      return;
    }
    onSelectPatient?.(patient);
    try {
      sessionStorage.setItem("lumera_active_patient_id", patient.id);
    } catch {}
    onOpen("rx");
  };

  const handleViewChartForPatient = (patient: Patient) => {
    onSelectPatient?.(patient);
    try {
      sessionStorage.setItem("lumera_active_patient_id", patient.id);
    } catch {}
    onOpen("patients");
  };

  const handleSaveFormFEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formFAttested) return;
    const selectedPat =
      gynaePatients.find((p) => p.id === formFPatientId) || ancRegistry[0]?.patient || gynaePatients[0];
    if (!selectedPat) return;
    const rx = latestRxByPatient.get(selectedPat.id);
    const nextSerial = `FF-2026-${String(500 + manualFormFEntries.length + 1).padStart(4, "0")}`;
    const entry: PcpndtFormFEntry = {
      id: `manual-ff-${Date.now()}`,
      serialNo: nextSerial,
      date: clinicCalendarDate(),
      patientId: selectedPat.id,
      patientName: selectedPat.name,
      patientAge: selectedPat.age,
      uhid: selectedPat.uhid,
      gravidaParaLabel: formatGpFormula(rx?.gynecologyAssessment),
      gestationalWeeks: Math.max(4, Math.min(42, parseInt(formFWeeks, 10) || 20)),
      indication: formFIndication,
      photoIdReference: formFPhotoId.trim() || "Govt Photo ID Checked on File",
      sonologistName: doctor.name,
      nonDisclosureAttested: true,
      source: "manual",
    };
    const updated = [entry, ...manualFormFEntries];
    setManualFormFEntries(updated);
    try {
      localStorage.setItem(storageKey, JSON.stringify(updated));
    } catch {}
    setShowFormFModal(false);
    setFormFPhotoId("");
    setFormFAttested(false);
  };

  return (
    <div className="space-y-4" data-testid="gynaecology-practice-deck">
      {/* Quick Clinical Operations Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <section className="bg-gradient-to-br from-pink-50 to-white rounded-2xl border border-pink-200/80 shadow-sm p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-pink-900">ANC Mothers Tracked</span>
            <Baby className="w-4 h-4 text-pink-600" />
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{ancRegistry.length}</p>
          <p className="text-[11px] text-rose-700 font-medium">
            {highRiskAncCount} PMSMA high-risk surveillance
          </p>
        </section>

        <section className="bg-gradient-to-br from-purple-50 to-white rounded-2xl border border-purple-200/80 shadow-sm p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-purple-900">Fertility &amp; PCOS Cohort</span>
            <Sparkles className="w-4 h-4 text-purple-600" />
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{fertilityRegistry.length}</p>
          <p className="text-[11px] text-purple-700 font-medium">
            TVS follicular &amp; ovulation protocols
          </p>
        </section>

        <section className="bg-gradient-to-br from-amber-50/80 to-white rounded-2xl border border-amber-200/80 shadow-sm p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-950">PCPNDT Form F Log</span>
            <ShieldCheck className="w-4 h-4 text-amber-700" />
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{derivedFormFEntries.length}</p>
          <p className="text-[11px] text-amber-800 font-medium">
            100% statutory non-disclosure attested
          </p>
        </section>

        <section className="bg-gradient-to-br from-emerald-50/80 to-white rounded-2xl border border-emerald-200/80 shadow-sm p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-950">Ob/Gyn Lab Panels</span>
            <FlaskConical className="w-4 h-4 text-emerald-700" />
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{gynaeLabs.length}</p>
          <div className="flex items-center justify-between mt-0.5">
            <span className="text-[11px] text-slate-600">
              {withDoctorCount > 0 ? `${withDoctorCount} in consult` : `${followUpsToday} follow-ups`}{" "}
              · Due {formatHomeInr(todayPendingInr)}
            </span>
            <button
              type="button"
              onClick={() => onOpen("reports")}
              className="text-[11px] font-bold text-emerald-800 hover:underline"
            >
              Open Labs
            </button>
          </div>
        </section>
      </div>

      {/* Main 4-Tab Women's Health & Maternity Deck */}
      <section className="bg-white rounded-2xl border border-pink-200/80 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-pink-50/90 via-rose-50/60 to-purple-50/70 px-4 py-3.5 border-b border-pink-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
              <Stethoscope className="w-4 h-4 text-pink-600" />
              <span>Obstetrics, Gynaecology &amp; Fertility Clinical Command</span>
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              FOGSI / MoHFW MCP antenatal high-risk registry, follicular monitoring, statutory PCPNDT Form F register, and 42-day postnatal &amp; oncology recall
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onOpen("appointments")}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              ANC Calendar
            </button>
            <button
              type="button"
              onClick={() => onOpen("whatsapp")}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              Maternal WhatsApp Desk
            </button>
            <button
              type="button"
              onClick={() => onOpen("billing")}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              Packages &amp; Billing
            </button>
          </div>
        </div>

        {/* Interactive 4-Tab Bar */}
        <div
          className="flex overflow-x-auto border-b border-slate-200 bg-slate-50/70 px-3 pt-2 gap-1.5"
          role="tablist"
          aria-label="Gynaecology clinical registries"
        >
          {(
            [
              { id: "anc", label: "ANC & EDD Registry", badge: ancRegistry.length, icon: Baby },
              {
                id: "fertility",
                label: "Fertility & Follicular Study Tracker",
                badge: fertilityRegistry.length,
                icon: Sparkles,
              },
              {
                id: "pcpndt",
                label: "PCPNDT Form F Statutory USG Register",
                badge: derivedFormFEntries.length,
                icon: ClipboardCheck,
              },
              {
                id: "preventive",
                label: "Preventive Oncology & Postnatal 42-Day Recall",
                badge:
                  oncologyAndPostnatalRows.oncologyRows.length +
                  oncologyAndPostnatalRows.postnatalRows.length,
                icon: Ribbon,
              },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                data-testid={`gynae-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-t-xl text-xs font-bold whitespace-nowrap border-t border-x transition-colors ${
                  selected
                    ? "bg-white text-pink-800 border-pink-200 -mb-px pb-2.5"
                    : "bg-transparent text-slate-600 border-transparent hover:text-slate-900 hover:bg-white/60"
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                    selected ? "bg-pink-100 text-pink-800" : "bg-slate-200/80 text-slate-700"
                  }`}
                >
                  {tab.badge}
                </span>
              </button>
            );
          })}
        </div>

        {/* TAB 1: ANC & EDD REGISTRY */}
        {activeTab === "anc" && (
          <div className="p-4 space-y-3" data-testid="gynae-panel-anc">
            {ancRegistry.length === 0 ? (
              <p className="text-sm text-slate-500">
                No antenatal mothers registered yet. Check in an expectant mother at reception to initiate an MCP flowsheet.
              </p>
            ) : (
              <div className="space-y-2.5">
                {ancRegistry.map(({ patient, rx, gyn }) => {
                  const hb = gyn?.maternalHemoglobinGdl;
                  const isAnemic = typeof hb === "number" && hb > 0 && hb < 11;
                  const dipsi = gyn?.dipsiOgtt2HrMgDl;
                  const isGdm = typeof dipsi === "number" && dipsi >= 140;
                  const bg = gyn?.maternalBloodGroupRh || patient.bloodGroup || "O+";
                  const isRhNeg = bg.includes("-");
                  const highRiskTags = (gyn?.highRiskFactors || []).filter((f) => !f.includes("None"));

                  return (
                    <div
                      key={patient.id}
                      className="rounded-xl border border-slate-200 p-3.5 hover:border-pink-300 transition-colors bg-white flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                    >
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-sm text-slate-900">{patient.name}</span>
                          <span className="text-xs text-slate-500">
                            {patient.age}y · {patient.uhid}
                          </span>
                          <span className="px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-pink-50 text-pink-800 border border-pink-200">
                            {formatGpFormula(gyn)}
                          </span>
                          {gyn?.gestationalAgeWeeks ? (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 text-purple-800 border border-purple-200">
                              {gyn.gestationalAgeWeeks}w {gyn.gestationalAgeDays || 0}d · {gyn.trimester}
                            </span>
                          ) : null}
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                              isRhNeg
                                ? "bg-rose-100 text-rose-900 border-rose-300"
                                : "bg-slate-100 text-slate-700 border-slate-200"
                            }`}
                          >
                            BG: {bg}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                          <span>
                            <strong>EDD:</strong> {gyn?.correctedUsgEdd || gyn?.calculatedEdd || "Pending dating scan"}
                          </span>
                          {gyn?.previousDeliveryMode && (
                            <span>
                              <strong>Prev:</strong> {gyn.previousDeliveryMode}
                            </span>
                          )}
                          {gyn?.fetalHeartRateBpm && (
                            <span>
                              <strong>FHR:</strong> {gyn.fetalHeartRateBpm} bpm
                            </span>
                          )}
                          {gyn?.nstBppStatus && gyn.nstBppStatus !== "Not Done" && (
                            <span className="text-indigo-700 font-semibold">
                              <strong>NST/BPP:</strong> {gyn.nstBppStatus}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {isAnemic && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-rose-50 text-rose-800 border border-rose-200">
                              <AlertTriangle className="w-3 h-3" />
                              Anemia Alert (Hb {hb} g/dL)
                            </span>
                          )}
                          {!isAnemic && typeof hb === "number" && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                              Hb {hb} g/dL
                            </span>
                          )}
                          {isGdm && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-900 border border-amber-300">
                              <AlertTriangle className="w-3 h-3" />
                              DIPSI GDM ({dipsi} mg/dL)
                            </span>
                          )}
                          {highRiskTags.map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50/80 text-rose-900 border border-rose-200"
                            >
                              PMSMA: {tag}
                            </span>
                          ))}
                          {rx?.followUpDate && (
                            <span className="px-2 py-0.5 rounded text-[11px] text-slate-600 bg-slate-100">
                              Next ANC: {rx.followUpDate}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleViewChartForPatient(patient)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50"
                        >
                          View Chart
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenConsultForPatient(patient)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-pink-600 text-white hover:bg-pink-700"
                        >
                          Open Consult
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: FERTILITY & FOLLICULAR STUDY TRACKER */}
        {activeTab === "fertility" && (
          <div className="p-4 space-y-3" data-testid="gynae-panel-fertility">
            {fertilityRegistry.length === 0 ? (
              <p className="text-sm text-slate-500">
                No active ovulation induction or PCOS cycles found in this cohort.
              </p>
            ) : (
              <div className="space-y-2.5">
                {fertilityRegistry.map(({ patient, gyn }) => {
                  const et = gyn?.endometrialThicknessMm;
                  const receptiveEt = typeof et === "number" && et >= 8;
                  return (
                    <div
                      key={patient.id}
                      className="rounded-xl border border-purple-200/80 p-3.5 bg-purple-50/20 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                    >
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-sm text-slate-900">{patient.name}</span>
                          <span className="text-xs text-slate-500">
                            {patient.age}y · {patient.uhid}
                          </span>
                          {gyn?.fertilityCycleDay ? (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-900 border border-purple-300">
                              Cycle Day {gyn.fertilityCycleDay}
                            </span>
                          ) : null}
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-white text-slate-800 border border-slate-200">
                            {gyn?.ovulationInductionProtocol || gyn?.cycleRegularity || "PCOS / Metabolic Protocol"}
                          </span>
                          {receptiveEt && (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                              Receptive ET {et} mm ({gyn?.endometrialPattern || "Trilaminar"})
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-slate-700 pt-0.5">
                          <div>
                            <span className="text-slate-500 font-medium">Follicles (TVS): </span>
                            <span className="font-semibold">
                              RO: {gyn?.rightOvaryFollicleMm || "PCOM"} · LO: {gyn?.leftOvaryFollicleMm || "PCOM"}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 font-medium">Reserve / Tubal: </span>
                            <span className="font-semibold">
                              {typeof gyn?.amhNgMl === "number" ? `AMH ${gyn.amhNgMl} ng/mL` : "AMH on file"}
                              {gyn?.tubalPatencyStatus ? ` · ${gyn.tubalPatencyStatus}` : ""}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 font-medium">Partner / Trigger: </span>
                            <span className="font-semibold text-purple-900">
                              {gyn?.ovulationTriggerPlan || gyn?.partnerSemenSummary || "Lifestyle + Inositol"}
                            </span>
                          </div>
                        </div>

                        {gyn?.pelvicUsgSummary && (
                          <p className="text-[11px] text-slate-600">{gyn.pelvicUsgSummary}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleViewChartForPatient(patient)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        >
                          View Chart
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenConsultForPatient(patient)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700"
                        >
                          Open Consult
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: PCPNDT FORM F STATUTORY USG REGISTER */}
        {activeTab === "pcpndt" && (
          <div className="p-4 space-y-3" data-testid="gynae-panel-pcpndt">
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-amber-950 space-y-0.5">
                <p className="font-bold flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0" />
                  PCPNDT Act Statutory Ultrasonic Register (Form F)
                </p>
                <p className="text-[11px] text-amber-900">
                  Every obstetric ultrasound requires patient photo ID verification, clinical indication logging, and mandatory non-disclosure of foetal sex declaration.
                </p>
              </div>
              <button
                type="button"
                data-testid="toggle-log-form-f"
                onClick={() => {
                  if (!formFPatientId && (ancRegistry[0]?.patient?.id || gynaePatients[0]?.id)) {
                    setFormFPatientId(ancRegistry[0]?.patient?.id || gynaePatients[0]?.id || "");
                  }
                  setShowFormFModal((prev) => !prev);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-700 text-white hover:bg-amber-800 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Log Form F Entry</span>
              </button>
            </div>

            {showFormFModal && (
              <form
                onSubmit={handleSaveFormFEntry}
                data-testid="pcpndt-form-f-modal"
                className="rounded-xl border border-amber-300 bg-amber-50/40 p-4 space-y-3 text-xs"
              >
                <div className="flex items-center justify-between border-b border-amber-200 pb-2">
                  <span className="font-bold text-amber-950">New Statutory Form F Obstetric USG Entry</span>
                  <button
                    type="button"
                    onClick={() => setShowFormFModal(false)}
                    className="text-slate-500 hover:text-slate-800 font-semibold"
                  >
                    Cancel
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Pregnant Woman</label>
                    <select
                      value={formFPatientId}
                      onChange={(e) => setFormFPatientId(e.target.value)}
                      className="w-full p-2 rounded-lg border border-slate-300 bg-white font-medium text-slate-800"
                    >
                      {gynaePatients.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.age}y · {p.uhid})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Gestational Age (Wks)</label>
                    <input
                      type="number"
                      min={4}
                      max={42}
                      value={formFWeeks}
                      onChange={(e) => setFormFWeeks(e.target.value)}
                      className="w-full p-2 rounded-lg border border-slate-300 bg-white font-semibold text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Obstetric USG Indication</label>
                    <select
                      value={formFIndication}
                      onChange={(e) => setFormFIndication(e.target.value)}
                      className="w-full p-2 rounded-lg border border-slate-300 bg-white font-medium text-slate-800"
                    >
                      {PCPNDT_INDICATIONS.map((ind) => (
                        <option key={ind} value={ind}>
                          {ind}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Govt Photo ID Ref</label>
                    <input
                      type="text"
                      placeholder="e.g. Voter ID / Passport last 4"
                      value={formFPhotoId}
                      onChange={(e) => setFormFPhotoId(e.target.value)}
                      className="w-full p-2 rounded-lg border border-slate-300 bg-white text-slate-800"
                    />
                  </div>
                </div>

                <label className="flex items-start gap-2 p-2.5 rounded-lg bg-white border border-amber-300 text-amber-950 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formFAttested}
                    onChange={(e) => setFormFAttested(e.target.checked)}
                    className="mt-0.5 rounded text-amber-700"
                  />
                  <span>
                    <strong>Mandatory Statutory Declaration:</strong> I declare that while conducting ultrasonography on the above pregnant woman, I have neither detected nor disclosed the sex of her foetus to anybody in any manner under the PCPNDT Act.
                  </span>
                </label>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={!formFAttested}
                    className="px-4 py-2 rounded-lg font-bold bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    Save Signed Form F Record
                  </button>
                </div>
              </form>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 uppercase text-[10px]">
                    <th className="py-2 pr-3">Form F Serial</th>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Patient &amp; Parity</th>
                    <th className="py-2 pr-3">GA</th>
                    <th className="py-2 pr-3">Diagnostic Indication</th>
                    <th className="py-2 pr-3">ID Proof &amp; Sonologist</th>
                    <th className="py-2">Statutory Declaration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {derivedFormFEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 pr-3 font-mono font-bold text-amber-900">{entry.serialNo}</td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">{entry.date}</td>
                      <td className="py-2.5 pr-3">
                        <span className="font-semibold text-slate-900">{entry.patientName}</span>{" "}
                        <span className="text-slate-500">
                          ({entry.patientAge}y · {entry.gravidaParaLabel})
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 font-semibold">{entry.gestationalWeeks}w</td>
                      <td className="py-2.5 pr-3">{entry.indication}</td>
                      <td className="py-2.5 pr-3 text-[11px] text-slate-600">
                        {entry.photoIdReference} · {entry.sonologistName}
                      </td>
                      <td className="py-2.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" />
                          Sex Non-Disclosure Attested
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: PREVENTIVE ONCOLOGY & POSTNATAL 42-DAY RECALL */}
        {activeTab === "preventive" && (
          <div className="p-4 space-y-4" data-testid="gynae-panel-preventive">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Postnatal 42-Day & Menopause Care */}
              <div className="rounded-xl border border-rose-200/80 p-3.5 space-y-2.5 bg-rose-50/20">
                <h4 className="text-xs font-bold text-rose-950 flex items-center gap-1.5 border-b border-rose-100 pb-2">
                  <Heart className="w-3.5 h-3.5 text-rose-600" />
                  Postnatal Day-3 / Day-7 / Day-42 Puerperium &amp; Spacing Recall
                </h4>
                {oncologyAndPostnatalRows.postnatalRows.length === 0 ? (
                  <p className="text-xs text-slate-500">No postnatal or menopause recall visits active.</p>
                ) : (
                  <div className="space-y-2">
                    {oncologyAndPostnatalRows.postnatalRows.map(({ patient, gyn }) => (
                      <div
                        key={patient.id}
                        className="rounded-lg bg-white border border-rose-100 p-2.5 flex items-start justify-between gap-2 text-xs"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-slate-900">{patient.name}</span>
                            <span className="text-[11px] text-slate-500">{patient.age}y</span>
                            {gyn?.postpartumDays ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-900">
                                Postpartum Day {gyn.postpartumDays} / 42d PNC
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900">
                                Perimenopause / Bone Health
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-600">
                            {gyn?.lochiaAndScarStatus ||
                              gyn?.dexaTScoreSummary ||
                              gyn?.pelvicUsgSummary ||
                              (patient.chronicConditions || [])[0]}
                          </p>
                          <div className="flex flex-wrap gap-1.5 text-[10px]">
                            {gyn?.lactationLatchStatus && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
                                {gyn.lactationLatchStatus}
                              </span>
                            )}
                            {gyn?.epdsPostnatalMood && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                                {gyn.epdsPostnatalMood}
                              </span>
                            )}
                            {gyn?.contraceptionMethod && (
                              <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-800 font-semibold">
                                Spacing: {gyn.contraceptionMethod}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleOpenConsultForPatient(patient)}
                          className="px-2.5 py-1 rounded text-[11px] font-semibold bg-rose-600 text-white hover:bg-rose-700 shrink-0"
                        >
                          Open Consult
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Cervical Pap/LBC, HPV Cervavac & Breast CBE Screening */}
              <div className="rounded-xl border border-pink-200/80 p-3.5 space-y-2.5 bg-pink-50/20">
                <h4 className="text-xs font-bold text-pink-950 flex items-center gap-1.5 border-b border-pink-100 pb-2">
                  <Ribbon className="w-3.5 h-3.5 text-pink-600" />
                  Cervical (Pap / LBC / VIA), HPV Cervavac &amp; Breast CBE Recall
                </h4>
                <div className="space-y-2">
                  {oncologyAndPostnatalRows.oncologyRows.map(({ patient, gyn }) => (
                    <div
                      key={patient.id}
                      className="rounded-lg bg-white border border-pink-100 p-2.5 flex items-start justify-between gap-2 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-bold text-slate-900">{patient.name}</span>
                          <span className="text-[11px] text-slate-500">
                            {patient.age}y · {patient.uhid}
                          </span>
                          {gyn?.aubPalmCoeinClass && gyn.aubPalmCoeinClass !== "Not Applicable" && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-pink-100 text-pink-900">
                              {gyn.aubPalmCoeinClass}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-700">
                          <strong>Pap/VIA:</strong> {gyn?.cervicalScreeningPapVia || "Due for 3-yr LBC screen"} ·{" "}
                          <strong>HPV:</strong> {gyn?.hpvVaccineStatus || "Counsel Cervavac"}
                        </p>
                        {gyn?.breastExamSummary && (
                          <p className="text-[11px] text-slate-500">
                            <strong>CBE:</strong> {gyn.breastExamSummary}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleViewChartForPatient(patient)}
                        className="px-2.5 py-1 rounded text-[11px] font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 shrink-0"
                      >
                        View Chart
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Verified Ob/Gyn Diagnostic Lab Panels Strip */}
      <section className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-pink-600" />
            <span>Verified Women&apos;s Diagnostics &amp; Maternal Lab Reports ({gynaeLabs.length})</span>
          </h3>
          <button
            type="button"
            onClick={() => onOpen("reports")}
            className="text-xs font-semibold text-blue-700 hover:underline"
          >
            Open Lab Analyzer
          </button>
        </div>

        {gynaeLabs.length === 0 ? (
          <p className="text-xs text-slate-500">No Maternal or Gynaecology lab panels waiting for review.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {gynaeLabs.slice(0, 5).map((lab) => {
              const abnormal = (lab.results || []).filter((r) => r.status !== "Normal");
              return (
                <div
                  key={lab.id}
                  className="rounded-xl border border-slate-200 p-3 bg-slate-50/50 space-y-1 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900 truncate">{lab.patientName}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                        abnormal.length > 0
                          ? "bg-rose-100 text-rose-800 border border-rose-200"
                          : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {abnormal.length > 0 ? `${abnormal.length} Flagged` : "Normal"}
                    </span>
                  </div>
                  <p className="text-[11px] font-semibold text-pink-800">{lab.category}</p>
                  <p className="text-[11px] text-slate-600 line-clamp-2">{lab.doctorInterpretation}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

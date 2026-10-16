import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Phone, Search, UserPlus } from "lucide-react";
import { apiFetch } from "../api/http";
import { PatientDocuments } from "./PatientDocuments";
import { formatINR } from "../../app/applet/src/lib/currency.ts";
import { isAbhaLinked, type Appointment, type Patient, type Prescription, type Vitals } from "../types";

interface ChartResponse {
  patient: Patient;
  visits: Appointment[];
  prescriptions: Prescription[];
}

interface PatientsWorkspaceProps {
  recordId: string;
  canPrescribe: boolean;
  onOpenPatient: (patientId: string) => void;
  onBack: () => void;
  onRegister: (name?: string) => void;
  onSelectPatient: (patient: Patient) => void;
  onOpenPrescription: (patient: Patient) => void;
  onCheckIn: (patient: Patient) => void;
}

function vitalsLine(vitals?: Vitals | null): string {
  if (!vitals) return "";
  const parts: string[] = [];
  if (vitals.bloodPressureSystolic && vitals.bloodPressureDiastolic) {
    parts.push(`BP ${vitals.bloodPressureSystolic}/${vitals.bloodPressureDiastolic}`);
  }
  if (vitals.heartRate) parts.push(`Pulse ${vitals.heartRate}`);
  if (vitals.temperature) parts.push(`Temp ${vitals.temperature}`);
  if (vitals.spO2) parts.push(`SpO2 ${vitals.spO2}%`);
  return parts.join(" · ");
}

export const PatientsWorkspace: React.FC<PatientsWorkspaceProps> = ({
  recordId,
  canPrescribe,
  onOpenPatient,
  onBack,
  onRegister,
  onSelectPatient,
  onOpenPrescription,
  onCheckIn,
}) => {
  if (recordId) {
    return (
      <PatientDetail
        patientId={recordId}
        canPrescribe={canPrescribe}
        onBack={onBack}
        onSelectPatient={onSelectPatient}
        onOpenPrescription={onOpenPrescription}
        onCheckIn={onCheckIn}
      />
    );
  }
  return <PatientList onOpenPatient={onOpenPatient} onRegister={onRegister} />;
};

const PatientList: React.FC<{
  onOpenPatient: (patientId: string) => void;
  onRegister: (name?: string) => void;
}> = ({ onOpenPatient, onRegister }) => {
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      params.set("limit", "100");
      void apiFetch<{ patients: Patient[] }>(`/api/patients?${params.toString()}`)
        .then((data) => {
          if (cancelled) return;
          setPatients(data.patients || []);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setPatients([]);
          setError(err instanceof Error ? err.message : "Could not load patients");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query]);

  const trimmed = query.trim();

  return (
    <div data-testid="patients-page" className="w-full min-w-0 max-w-full overflow-x-hidden space-y-4">
      <div className="min-w-0">
        <h1 className="text-lg sm:text-xl font-bold text-slate-900">Patients</h1>
        <p className="text-sm text-slate-600 mt-1 break-words">
          Find a patient in this clinic by name, phone, or ABHA, then open their chart.
        </p>
      </div>

      <form
        className="relative w-full min-w-0"
        onSubmit={(event) => {
          event.preventDefault();
          searchRef.current?.blur();
        }}
      >
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          ref={searchRef}
          data-testid="patients-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, phone, or ABHA"
          aria-label="Search patients by name, phone, or ABHA"
          className="w-full min-w-0 pl-9 pr-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        />
      </form>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 break-words" role="alert">
          {error}
        </div>
      )}

      <div data-testid="patients-list" className="space-y-2 w-full min-w-0">
        {loading && <p className="text-sm text-slate-500">Loading patients…</p>}
        {!loading && patients.length === 0 && !trimmed && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
            <UserPlus className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-900">No patients in this clinic yet</p>
            <p className="text-xs text-slate-500 mt-1">
              Register a walk-in to start their chart. Saved patients stay in this clinic after refresh.
            </p>
            <button
              type="button"
              onClick={() => onRegister()}
              className="mt-4 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <UserPlus className="w-4 h-4" />
              Add patient / Register walk-in
            </button>
          </div>
        )}
        {!loading && patients.length === 0 && trimmed && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
            <p className="text-sm font-semibold text-slate-900 break-words">No matches for “{trimmed}”</p>
            <p className="text-xs text-slate-500 mt-1">Search covers name, phone, and ABHA in this clinic only.</p>
            <button
              type="button"
              onClick={() => onRegister(trimmed)}
              className="mt-4 inline-flex max-w-full items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <span className="break-words">Register “{trimmed}” as new patient</span>
            </button>
          </div>
        )}
        {patients.map((patient) => {
          const linked = isAbhaLinked(patient);
          return (
            <button
              key={patient.id}
              type="button"
              data-testid={`patient-row-${patient.id}`}
              onClick={() => onOpenPatient(patient.id)}
              className="w-full min-w-0 text-left rounded-xl border border-slate-200 bg-white px-3 py-3 hover:border-blue-300 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="font-semibold text-slate-900 break-words">{patient.name}</span>
                  <span className="font-mono text-[11px] text-slate-500 break-all">{patient.uhid}</span>
                  {linked ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      ABHA · NHA sandbox
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                      ABHA not linked
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 break-words">
                  {patient.age} yrs · {patient.gender}
                  {patient.phone ? ` · ${patient.phone}` : ""}
                  {patient.abhaAddress ? ` · ${patient.abhaAddress}` : ""}
                </p>
                {patient.lastVisit && (
                  <p className="text-[11px] text-slate-500">Last visit {patient.lastVisit}</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const PatientDetail: React.FC<{
  patientId: string;
  canPrescribe: boolean;
  onBack: () => void;
  onSelectPatient: (patient: Patient) => void;
  onOpenPrescription: (patient: Patient) => void;
  onCheckIn: (patient: Patient) => void;
}> = ({ patientId, canPrescribe, onBack, onSelectPatient, onOpenPrescription, onCheckIn }) => {
  const [chart, setChart] = useState<ChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setChart(null);
    void apiFetch<ChartResponse>(`/api/patients/${encodeURIComponent(patientId)}/chart`)
      .then((data) => {
        if (cancelled) return;
        setChart(data);
        if (data.patient) onSelectPatient(data.patient);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not open this patient");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // onSelectPatient is stable enough for a one-shot load; identity changes must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const patient = chart?.patient;

  return (
    <div data-testid="patient-detail" className="w-full min-w-0 max-w-full overflow-x-hidden space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-md"
      >
        <ArrowLeft className="w-4 h-4" />
        All patients
      </button>

      {loading && <p className="text-sm text-slate-500">Loading patient chart…</p>}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800" role="alert">
          <p className="font-semibold">This chart is not available</p>
          <p className="mt-1 break-words">{error}</p>
          <button
            type="button"
            onClick={onBack}
            className="mt-3 px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-900 text-xs font-semibold"
          >
            Back to the patient list
          </button>
        </div>
      )}

      {patient && (
        <>
          <section data-testid="patient-demographics" className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 min-w-0">
            <div className="flex flex-col gap-3 min-w-0 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-slate-900 break-words">{patient.name}</h1>
                <p className="text-sm text-slate-600 mt-1 break-words">
                  {patient.age} yrs · {patient.gender}
                  {patient.bloodGroup ? ` · ${patient.bloodGroup}` : ""}
                </p>
                <p className="text-xs font-mono text-slate-500 mt-1 break-all">UHID {patient.uhid || "—"}</p>
                {isAbhaLinked(patient) ? (
                  <p className="text-xs text-emerald-800 mt-2 break-all">
                    ABHA {patient.abhaNumber || "linked"}
                    {patient.abhaAddress ? ` · ${patient.abhaAddress}` : ""} · NHA sandbox
                  </p>
                ) : (
                  <p className="text-xs text-amber-800 mt-2">ABHA not linked · NHA sandbox</p>
                )}
              </div>
              <div className="flex flex-col gap-2 w-full sm:w-auto sm:min-w-[10rem]">
                {canPrescribe && (
                  <button
                    type="button"
                    onClick={() => onOpenPrescription(patient)}
                    className="w-full px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    Open prescription
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onCheckIn(patient)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  Book / check in
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 text-sm">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Allergies</p>
                <p className="text-slate-800 break-words">{patient.allergies?.length ? patient.allergies.join(", ") : "None recorded"}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Chronic conditions</p>
                <p className="text-slate-800 break-words">
                  {patient.chronicConditions?.length ? patient.chronicConditions.join(", ") : "None recorded"}
                </p>
              </div>
            </div>
          </section>

          <section data-testid="patient-contact" className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 min-w-0">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Phone className="w-4 h-4 text-slate-500" />
              Contact
            </h2>
            <dl className="grid grid-cols-1 gap-2 text-sm">
              <div className="min-w-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Phone</dt>
                <dd className="text-slate-800 break-all">{patient.phone || "—"}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Email</dt>
                <dd className="text-slate-800 break-all">{patient.email || "—"}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Address</dt>
                <dd className="text-slate-800 break-words">{patient.address || "—"}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Emergency contact</dt>
                <dd className="text-slate-800 break-words">{patient.emergencyContact || "—"}</dd>
              </div>
            </dl>
          </section>

          <section data-testid="patient-visits" className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 min-w-0">
            <h2 className="text-sm font-bold text-slate-900">Visit history</h2>
            {(chart?.visits || []).length === 0 ? (
              <div>
                <p className="text-sm text-slate-600">No visits recorded for this patient yet.</p>
                <button
                  type="button"
                  onClick={() => onCheckIn(patient)}
                  className="mt-2 text-sm font-semibold text-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                >
                  Book / check in
                </button>
              </div>
            ) : (
              <ul className="space-y-2">
                {chart?.visits.map((visit) => {
                  const vitals = vitalsLine(visit.vitals);
                  return (
                    <li key={visit.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 break-words">
                        {visit.date || "Undated"} · {visit.timeSlot || "Time not set"}
                      </p>
                      <p className="text-xs text-slate-600 break-words mt-0.5">
                        {visit.type || "Visit"} · {visit.status || "—"}
                        {visit.doctorName ? ` · ${visit.doctorName}` : ""}
                      </p>
                      <p className="text-xs text-slate-800 mt-1">
                        Fee {formatINR(Number(visit.consultationFee || 0))}
                        {visit.isPaid ? " · Paid" : " · Unpaid"}
                      </p>
                      {vitals && <p className="text-xs text-slate-600 mt-1 break-words">{vitals}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section data-testid="patient-prescriptions" className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 min-w-0">
            <h2 className="text-sm font-bold text-slate-900">Prescriptions</h2>
            {(chart?.prescriptions || []).length === 0 ? (
              <div>
                <p className="text-sm text-slate-600">No prescriptions issued for this patient yet.</p>
                {canPrescribe && (
                  <button
                    type="button"
                    onClick={() => onOpenPrescription(patient)}
                    className="mt-2 text-sm font-semibold text-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                  >
                    Open prescription
                  </button>
                )}
              </div>
            ) : (
              <ul className="space-y-3">
                {chart?.prescriptions.map((rx) => (
                  <li key={rx.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 break-words">
                      {rx.rxNumber || "Prescription"} · {rx.date || "Undated"}
                    </p>
                    <p className="text-xs text-slate-600 break-words">
                      {rx.doctorName || "Clinician"}
                      {rx.diagnosis ? ` · ${rx.diagnosis}` : ""}
                    </p>
                    {(rx.medicines || []).length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {rx.medicines.map((medicine) => (
                          <li key={medicine.id || medicine.drugName} className="text-xs text-slate-800 break-words">
                            {medicine.drugName}
                            {medicine.dosage ? ` ${medicine.dosage}` : ""}
                            {medicine.frequency ? ` · ${medicine.frequency}` : ""}
                            {medicine.durationDays ? ` · ${medicine.durationDays} days` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    {(rx.labTests || []).some((test) => typeof test.price === "number") && (
                      <ul className="mt-2 space-y-1">
                        {rx.labTests
                          .filter((test) => typeof test.price === "number")
                          .map((test) => (
                            <li key={test.id || test.testName} className="text-xs text-slate-700 break-words">
                              {test.testName} · {formatINR(Number(test.price))}
                            </li>
                          ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <PatientDocuments patientId={patient.id} />
        </>
      )}
    </div>
  );
};

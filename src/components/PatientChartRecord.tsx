import React, { useEffect, useState } from "react";
import { apiFetch } from "../api/http";
import type { Appointment, Patient, Vitals } from "../types";

export interface ChartNote {
  id: string;
  at: string;
  appointmentId: string;
  authorName?: string;
  body?: string;
  redacted?: boolean;
}

export interface ChartDiagnosis {
  id: string;
  label: string;
  icd10: string;
  at: string;
  doctorName: string;
  prescriptionId: string;
}

export interface ChartVitalsEntry {
  id: string;
  appointmentId: string;
  at: string;
  date: string;
  summary: string;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "Undated";
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function visitLabel(visit: Appointment): string {
  return [visit.date, visit.timeSlot, visit.doctorName].filter(Boolean).join(" · ");
}

export const PatientChartRecord: React.FC<{
  patient: Patient;
  visits: Appointment[];
  notes: ChartNote[];
  diagnoses: ChartDiagnosis[];
  vitalsHistory: ChartVitalsEntry[];
  canWriteNotes: boolean;
  onReload: () => void;
}> = ({ patient, visits, notes, diagnoses, vitalsHistory, canWriteNotes, onReload }) => {
  const [allergies, setAllergies] = useState((patient.allergies || []).join(", "));
  useEffect(() => {
    setAllergies((patient.allergies || []).join(", "));
  }, [patient.id, patient.allergies]);
  const [allergyError, setAllergyError] = useState("");
  const [savingAllergies, setSavingAllergies] = useState(false);
  const [note, setNote] = useState("");
  const [noteVisit, setNoteVisit] = useState(visits[0]?.id || "");
  const [noteError, setNoteError] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [vitalVisit, setVitalVisit] = useState(visits[0]?.id || "");
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [heartRate, setHeartRate] = useState("");
  const [temperature, setTemperature] = useState("");
  const [spO2, setSpO2] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [vitalError, setVitalError] = useState("");
  const [savingVitals, setSavingVitals] = useState(false);

  async function saveAllergies() {
    setSavingAllergies(true);
    setAllergyError("");
    const next = allergies
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    try {
      await apiFetch(`/api/patients/${encodeURIComponent(patient.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ allergies: next }),
      });
      onReload();
    } catch (err) {
      setAllergyError(err instanceof Error ? err.message : "Could not save allergies");
    } finally {
      setSavingAllergies(false);
    }
  }

  async function saveNote() {
    setSavingNote(true);
    setNoteError("");
    try {
      await apiFetch(`/api/patients/${encodeURIComponent(patient.id)}/notes`, {
        method: "POST",
        body: JSON.stringify({ body: note, appointmentId: noteVisit }),
      });
      setNote("");
      onReload();
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : "Could not save the note");
    } finally {
      setSavingNote(false);
    }
  }

  async function saveVitals() {
    if (!vitalVisit) {
      setVitalError("Check the patient in before recording vitals.");
      return;
    }
    setSavingVitals(true);
    setVitalError("");
    const numeric = (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const vitals: Vitals = {
      recordedAt: new Date().toISOString(),
      bloodPressureSystolic: numeric(systolic),
      bloodPressureDiastolic: numeric(diastolic),
      heartRate: numeric(heartRate),
      temperature: numeric(temperature),
      spO2: numeric(spO2),
      weightKg: numeric(weightKg),
    };
    try {
      await apiFetch(`/api/appointments/${encodeURIComponent(vitalVisit)}`, {
        method: "PATCH",
        body: JSON.stringify({ vitals }),
      });
      setSystolic("");
      setDiastolic("");
      setHeartRate("");
      setTemperature("");
      setSpO2("");
      setWeightKg("");
      onReload();
    } catch (err) {
      setVitalError(err instanceof Error ? err.message : "Could not save vitals");
    } finally {
      setSavingVitals(false);
    }
  }

  return (
    <div className="space-y-4 min-w-0" data-testid="patient-chart-record">
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 min-w-0">
        <h2 className="text-sm font-bold text-slate-900">Allergies</h2>
        <label className="block text-xs text-slate-600" htmlFor="chart-allergies">
          Separate each allergy with a comma. Leave blank when none are known.
        </label>
        <textarea
          id="chart-allergies"
          data-testid="chart-allergies"
          value={allergies}
          onChange={(event) => setAllergies(event.target.value)}
          rows={2}
          className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
        />
        {allergyError && (
          <p className="text-xs text-rose-700 break-words" role="alert">
            {allergyError}
          </p>
        )}
        <button
          type="button"
          data-testid="chart-allergies-save"
          disabled={savingAllergies}
          onClick={() => void saveAllergies()}
          className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold disabled:opacity-50"
        >
          {savingAllergies ? "Saving…" : "Save allergies"}
        </button>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 min-w-0" data-testid="chart-diagnoses">
        <h2 className="text-sm font-bold text-slate-900">Diagnoses</h2>
        <p className="text-xs text-slate-600 break-words">From issued prescriptions on this chart.</p>
        {diagnoses.length === 0 ? (
          <p className="text-sm text-slate-600">Not recorded</p>
        ) : (
          <ul className="space-y-2">
            {diagnoses.map((item) => (
              <li key={item.id} className="text-sm text-slate-800 break-words">
                <span className="font-semibold">{item.label}</span>
                {item.icd10 ? ` (${item.icd10})` : ""}
                <span className="block text-xs text-slate-500">
                  {[item.doctorName, formatWhen(item.at)].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 min-w-0" data-testid="chart-notes">
        <h2 className="text-sm font-bold text-slate-900">Clinical notes</h2>
        {notes.length === 0 ? (
          <p className="text-sm text-slate-600">Not recorded</p>
        ) : (
          <ul className="space-y-3">
            {notes.map((item) => (
              <li key={item.id} className="text-sm text-slate-800 break-words border-b border-slate-100 pb-2">
                {item.redacted || !item.body ? (
                  <p>Note recorded{item.at ? ` · ${formatWhen(item.at)}` : ""}</p>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap break-words">{item.body}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {[item.authorName, formatWhen(item.at)].filter(Boolean).join(" · ")}
                    </p>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {canWriteNotes && (
          <div className="space-y-2">
            <label className="block text-xs text-slate-600" htmlFor="chart-note">
              Add a note for this patient. It stays on the chart after you save it.
            </label>
            <textarea
              id="chart-note"
              data-testid="chart-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            {visits.length > 0 && (
              <label className="block text-xs text-slate-600">
                Attach to visit
                <select
                  data-testid="chart-note-visit"
                  value={noteVisit}
                  onChange={(event) => setNoteVisit(event.target.value)}
                  className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                >
                  <option value="">Not attached to a visit</option>
                  {visits.map((visit) => (
                    <option key={visit.id} value={visit.id}>
                      {visitLabel(visit)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {noteError && (
              <p className="text-xs text-rose-700 break-words" role="alert">
                {noteError}
              </p>
            )}
            <button
              type="button"
              data-testid="chart-note-save"
              disabled={savingNote || !note.trim()}
              onClick={() => void saveNote()}
              className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
            >
              {savingNote ? "Saving…" : "Save note"}
            </button>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 min-w-0" data-testid="chart-vitals">
        <h2 className="text-sm font-bold text-slate-900">Vitals</h2>
        {vitalsHistory.length === 0 ? (
          <p className="text-sm text-slate-600">Not recorded</p>
        ) : (
          <ul className="space-y-2">
            {vitalsHistory.map((item) => (
              <li key={item.id} className="text-sm text-slate-800 break-words">
                <span className="font-semibold">{item.summary}</span>
                <span className="block text-xs text-slate-500">{[item.date, formatWhen(item.at)].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2">
          <p className="text-xs text-slate-600">Record vitals on a visit.</p>
          {visits.length === 0 ? (
            <p className="text-sm text-slate-600">Check the patient in before recording vitals.</p>
          ) : (
            <>
              <select
                data-testid="chart-vitals-visit"
                value={vitalVisit}
                onChange={(event) => setVitalVisit(event.target.value)}
                className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                {visits.map((visit) => (
                  <option key={visit.id} value={visit.id}>
                    {visitLabel(visit)}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input data-testid="chart-bp-sys" value={systolic} onChange={(event) => setSystolic(event.target.value)} placeholder="Systolic" inputMode="decimal" className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <input data-testid="chart-bp-dia" value={diastolic} onChange={(event) => setDiastolic(event.target.value)} placeholder="Diastolic" inputMode="decimal" className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <input data-testid="chart-hr" value={heartRate} onChange={(event) => setHeartRate(event.target.value)} placeholder="Heart rate" inputMode="decimal" className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <input data-testid="chart-temp" value={temperature} onChange={(event) => setTemperature(event.target.value)} placeholder="Temperature °F" inputMode="decimal" className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <input data-testid="chart-spo2" value={spO2} onChange={(event) => setSpO2(event.target.value)} placeholder="SpO2 %" inputMode="decimal" className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <input data-testid="chart-weight" value={weightKg} onChange={(event) => setWeightKg(event.target.value)} placeholder="Weight kg" inputMode="decimal" className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              {vitalError && (
                <p className="text-xs text-rose-700 break-words" role="alert">
                  {vitalError}
                </p>
              )}
              <button
                type="button"
                data-testid="chart-vitals-save"
                disabled={savingVitals}
                onClick={() => void saveVitals()}
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-800 disabled:opacity-50"
              >
                {savingVitals ? "Saving…" : "Save vitals"}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
};

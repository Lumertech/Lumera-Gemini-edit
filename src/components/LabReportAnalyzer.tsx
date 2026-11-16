import React, { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiFetch } from "../api/http";
import type { Patient } from "../types";

type LabStatus = "Normal" | "Low" | "High" | "Critical" | "Unknown";

interface LabValue {
  param: string;
  value: string;
  unit: string;
  normalRange: string;
  status: LabStatus;
}

interface LabReport {
  id: string;
  date: string;
  labName: string;
  category: string;
  status: string;
  draft: boolean;
  documentId: string;
  appointmentId: string;
  results: LabValue[];
}

interface InvestigationFile {
  id: string;
  title: string;
  docType: string;
  documentDate: string;
  appointmentId: string;
}

const STATUSES: LabStatus[] = ["Normal", "Low", "High", "Critical", "Unknown"];

function statusClass(status: string): string {
  if (status === "High" || status === "Low" || status === "Critical") return "text-rose-700 bg-rose-50 border-rose-200";
  if (status === "Unknown") return "text-amber-800 bg-amber-50 border-amber-200";
  return "text-emerald-800 bg-emerald-50 border-emerald-200";
}

export const LabReportAnalyzer: React.FC<{
  currentPatient?: Patient;
  patientName?: string;
  uhid?: string;
  onApplyClinicalFindings?: (findings: string[]) => void;
}> = ({ currentPatient }) => {
  const patientId = currentPatient?.id || "";
  const [reports, setReports] = useState<LabReport[]>([]);
  const [files, setFiles] = useState<InvestigationFile[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<LabValue[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    if (!patientId) return;
    const [reading, chart] = await Promise.all([
      apiFetch<{ reports: LabReport[] }>(`/api/patients/${encodeURIComponent(patientId)}/lab-reports`),
      apiFetch<{ investigations?: { files?: InvestigationFile[] } }>(`/api/patients/${encodeURIComponent(patientId)}/chart`),
    ]);
    setReports(reading.reports || []);
    setFiles(chart.investigations?.files || []);
    const first = (reading.reports || [])[0];
    setSelectedId((current) => current || first?.id || "");
    if (first) setDraft(first.results || []);
  }

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    setError("");
    void load()
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load lab readings");
      });
    return () => {
      cancelled = true;
    };
    // load closes over patientId only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const selected = reports.find((report) => report.id === selectedId) || null;

  useEffect(() => {
    setDraft(selected?.results || []);
  }, [selectedId, selected?.status, selected?.results]);

  const trends = useMemo(() => {
    const byParam = new Map<string, Array<{ date: string; value: number }>>();
    for (const report of reports) {
      if (report.draft) continue;
      for (const row of report.results) {
        const value = Number(String(row.value).replace(/,/g, ""));
        if (!Number.isFinite(value)) continue;
        const points = byParam.get(row.param) || [];
        points.push({ date: report.date, value });
        byParam.set(row.param, points);
      }
    }
    return [...byParam.entries()]
      .map(([param, points]) => ({ param, points: points.slice().reverse() }))
      .filter((series) => series.points.length >= 2);
  }, [reports]);

  async function readFile(documentId: string) {
    setBusy(documentId);
    setError("");
    try {
      const saved = await apiFetch<{ report: LabReport }>(
        `/api/patients/${encodeURIComponent(patientId)}/documents/${encodeURIComponent(documentId)}/extract`,
        { method: "POST", body: "{}" }
      );
      await load();
      if (saved.report?.id) setSelectedId(saved.report.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read this report");
    } finally {
      setBusy("");
    }
  }

  async function saveDraft() {
    if (!selected?.draft) return;
    setBusy("save");
    setError("");
    try {
      await apiFetch(`/api/patients/${encodeURIComponent(patientId)}/lab-reports/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ results: draft }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the draft");
    } finally {
      setBusy("");
    }
  }

  async function confirmDraft() {
    if (!selected?.draft) return;
    setBusy("confirm");
    setError("");
    try {
      await apiFetch(
        `/api/patients/${encodeURIComponent(patientId)}/lab-reports/${encodeURIComponent(selected.id)}/confirm`,
        { method: "POST", body: JSON.stringify({ doctorConfirmed: true, results: draft }) }
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm the draft");
    } finally {
      setBusy("");
    }
  }

  if (!patientId) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8" data-testid="lab-reader-empty">
        <h1 className="text-lg font-bold text-slate-900">Lab report reading</h1>
        <p className="text-sm text-slate-600 mt-2 break-words">
          Open a patient from Patients. A reading of an uploaded report stays a draft until a doctor confirms it.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden px-4 py-6 space-y-4" data-testid="lab-reader">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Lab report reading</h1>
        <p className="text-sm text-slate-600 mt-1 break-words">
          {currentPatient?.name}. Values read from a file are a draft. They are saved on the chart only after a doctor confirms them.
        </p>
      </div>
      {error && (
        <p className="text-sm text-rose-700 break-words" role="alert">
          {error}
        </p>
      )}
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2" data-testid="lab-reader-files">
        <h2 className="text-sm font-bold text-slate-900">Uploaded reports</h2>
        {files.length === 0 ? (
          <p className="text-sm text-slate-600">Not recorded. Add a lab report on Reception or on this patient's documents.</p>
        ) : (
          <ul className="space-y-2">
            {files.map((file) => (
              <li key={file.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-slate-800 break-words">
                  {file.title}
                  <span className="block text-xs text-slate-500">{file.documentDate}</span>
                </span>
                <button
                  type="button"
                  data-testid={`lab-read-${file.id}`}
                  disabled={busy === file.id}
                  onClick={() => void readFile(file.id)}
                  className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
                >
                  {busy === file.id ? "Reading…" : "Read values"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3" data-testid="lab-reader-draft">
        <h2 className="text-sm font-bold text-slate-900">Readings</h2>
        {reports.length === 0 ? (
          <p className="text-sm text-slate-600">Not recorded</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {reports.map((report) => (
              <button
                key={report.id}
                type="button"
                onClick={() => setSelectedId(report.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                  report.id === selectedId ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300"
                }`}
              >
                {report.date} · {report.draft ? "Draft" : "Confirmed"}
              </button>
            ))}
          </div>
        )}
        {selected?.draft && (
          <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 break-words" data-testid="lab-draft-banner">
            Draft. These values are not on the chart until you confirm them.
          </p>
        )}
        {selected && draft.length > 0 && (
          <ul className="space-y-3">
            {draft.map((row, index) => (
              <li key={`${row.param}-${index}`} className="grid grid-cols-1 gap-2 border-b border-slate-100 pb-3">
                <p className="text-sm font-semibold text-slate-900 break-words">{row.param}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    aria-label={`${row.param} value`}
                    value={row.value}
                    disabled={!selected.draft}
                    onChange={(event) =>
                      setDraft((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, value: event.target.value } : item)))
                    }
                    className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    aria-label={`${row.param} unit`}
                    value={row.unit}
                    disabled={!selected.draft}
                    onChange={(event) =>
                      setDraft((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, unit: event.target.value } : item)))
                    }
                    className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    aria-label={`${row.param} reference range`}
                    value={row.normalRange}
                    disabled={!selected.draft}
                    onChange={(event) =>
                      setDraft((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, normalRange: event.target.value } : item)))
                    }
                    className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <select
                    aria-label={`${row.param} flag`}
                    value={row.status}
                    disabled={!selected.draft}
                    onChange={(event) =>
                      setDraft((prev) =>
                        prev.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, status: event.target.value as LabStatus } : item
                        )
                      )
                    }
                    className={`w-full min-w-0 rounded-lg border px-3 py-2 text-sm ${statusClass(row.status)}`}
                  >
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        )}
        {selected?.draft && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              data-testid="lab-draft-save"
              disabled={busy === "save"}
              onClick={() => void saveDraft()}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold"
            >
              Save draft edits
            </button>
            <button
              type="button"
              data-testid="lab-draft-confirm"
              disabled={busy === "confirm"}
              onClick={() => void confirmDraft()}
              className="px-3 py-2 rounded-lg bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
            >
              Confirm reading
            </button>
          </div>
        )}
      </section>
      {trends.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3" data-testid="lab-trends">
          <h2 className="text-sm font-bold text-slate-900">Confirmed trends</h2>
          {trends.map((series) => (
            <div key={series.param} className="h-40 min-w-0">
              <p className="text-xs font-semibold text-slate-600 mb-1 break-words">{series.param}</p>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series.points}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={36} />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" stroke="#1d4ed8" dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </section>
      )}
    </div>
  );
};

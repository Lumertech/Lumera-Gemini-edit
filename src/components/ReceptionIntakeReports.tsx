import React, { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Camera, Upload, X } from "lucide-react";
import { apiFetch, apiUploadForm } from "../api/http";
import { intakeFileProblem, titleFromReportName } from "../lib/intakeReportFile.ts";
import { PATIENT_DOCUMENT_LIMIT_LABEL } from "../lib/patientReportLimits.ts";
import { PatientDocumentConsentDialog, type DocumentConsentStatus } from "./PatientDocumentConsentDialog";

const DOC_TYPES = [
  { value: "lab_report", label: "Lab report" },
  { value: "prescription", label: "Prescription" },
  { value: "discharge_summary", label: "Discharge summary" },
  { value: "imaging", label: "Imaging" },
  { value: "other", label: "Other" },
] as const;

type ReportStatus = "queued" | "uploading" | "failed" | "done";

interface IntakeReport {
  key: string;
  file: File;
  title: string;
  docType: string;
  documentDate: string;
  progress: number;
  status: ReportStatus;
  error: string;
}

export interface IntakeUploadResult {
  saved: number;
  failed: number;
  blocked: boolean;
}

export interface ReceptionIntakeReportsHandle {
  fileCount: () => number;
  uploadAll: (patientId: string) => Promise<IntakeUploadResult>;
  retryFailed: () => Promise<IntakeUploadResult>;
  reset: () => void;
}

function todayKolkata(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function filesFrom(list: FileList | null): File[] {
  const files: File[] = [];
  if (!list) return files;
  for (let index = 0; index < list.length; index += 1) {
    const file = list.item(index);
    if (file) files.push(file);
  }
  return files;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const CONSENT_BLOCK =
  "Record consent before storing a health document. The patient is already saved.";

export const ReceptionIntakeReports = forwardRef<ReceptionIntakeReportsHandle, { patientId: string | null }>(
  function ReceptionIntakeReports({ patientId }, ref) {
    const [items, setItems] = useState<IntakeReport[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const [consent, setConsent] = useState<DocumentConsentStatus | null>(null);
    const [consentOpen, setConsentOpen] = useState(false);
    const [consentMessage, setConsentMessage] = useState("");
    const itemsRef = useRef<IntakeReport[]>([]);
    const patientRef = useRef<string | null>(patientId);
    const fileRef = useRef<HTMLInputElement>(null);
    const cameraRef = useRef<HTMLInputElement>(null);
    patientRef.current = patientId;
    itemsRef.current = items;

    function commit(next: IntakeReport[]) {
      itemsRef.current = next;
      setItems(next);
    }

    function patch(key: string, partial: Partial<IntakeReport>) {
      commit(itemsRef.current.map((row) => (row.key === key ? { ...row, ...partial } : row)));
    }

    function addFiles(files: File[]) {
      if (!files.length) return;
      const next: IntakeReport[] = files.map((file) => {
        const problem = intakeFileProblem(file);
        return {
          key: `rep-${crypto.randomUUID()}`,
          file,
          title: titleFromReportName(file.name),
          docType: "",
          documentDate: todayKolkata(),
          progress: 0,
          status: problem ? "failed" : "queued",
          error: problem,
        };
      });
      commit([...itemsRef.current, ...next]);
    }

    async function consentAllows(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
      try {
        const status = await apiFetch<DocumentConsentStatus>(
          `/api/patients/${encodeURIComponent(id)}/document-consent`
        );
        setConsent(status);
        if (status.active) {
          setConsentMessage("");
          setConsentOpen(false);
          return { ok: true };
        }
        setConsentMessage(CONSENT_BLOCK);
        setConsentOpen(true);
        return { ok: false, message: CONSENT_BLOCK };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not load the consent notice.";
        setConsentOpen(false);
        setConsentMessage(message);
        return { ok: false, message };
      }
    }

    async function uploadOne(id: string, item: IntakeReport): Promise<"ok" | "fail" | "consent"> {
      const current = itemsRef.current.find((row) => row.key === item.key) || item;
      if (current.status === "done") return "ok";
      if (!current.title.trim() || !current.docType || !current.documentDate) {
        patch(current.key, {
          status: "failed",
          progress: 0,
          error: "Add a title, type, and date before uploading.",
        });
        return "fail";
      }
      const problem = intakeFileProblem(current.file);
      if (problem) {
        patch(current.key, { status: "failed", progress: 0, error: problem });
        return "fail";
      }
      patch(current.key, { status: "uploading", progress: 8, error: "" });
      const body = new FormData();
      body.set("file", current.file);
      body.set("title", current.title.trim());
      body.set("docType", current.docType);
      body.set("documentDate", current.documentDate);
      try {
        const res = await apiUploadForm(
          `/api/patients/${encodeURIComponent(id)}/documents`,
          body,
          (ratio) => patch(current.key, { progress: Math.max(8, Math.min(90, Math.round(ratio * 100))) })
        );
        if (res.status === 409 && (res.json.code === "CONSENT_REQUIRED" || res.json.code === "GUARDIAN_REQUIRED")) {
          const message =
            res.json.code === "GUARDIAN_REQUIRED"
              ? "A parent or guardian must be recorded before storing a report for this patient. The patient is already saved."
              : CONSENT_BLOCK;
          setConsentMessage(message);
          patch(current.key, { status: "failed", progress: 0, error: message });
          if (res.json.code === "CONSENT_REQUIRED") setConsentOpen(true);
          return "consent";
        }
        if (res.status < 200 || res.status >= 300) {
          patch(current.key, {
            status: "failed",
            progress: 0,
            error: res.json.error || `Upload failed (${res.status}). The patient is already saved.`,
          });
          return "fail";
        }
        patch(current.key, { status: "done", progress: 100, error: "" });
        return "ok";
      } catch (err) {
        patch(current.key, {
          status: "failed",
          progress: 0,
          error: err instanceof Error ? err.message : "Upload failed. The patient is already saved.",
        });
        return "fail";
      }
    }

    async function uploadKeys(id: string, keys: string[]): Promise<IntakeUploadResult> {
      if (!keys.length) return { saved: 0, failed: 0, blocked: false };
      const allowed = await consentAllows(id);
      if (allowed.ok === false) {
        const message = allowed.message;
        commit(
          itemsRef.current.map((row) =>
            keys.includes(row.key) && row.status !== "done"
              ? { ...row, status: "failed", progress: 0, error: message }
              : row
          )
        );
        return { saved: 0, failed: keys.length, blocked: true };
      }
      let saved = 0;
      let failed = 0;
      let blocked = false;
      for (const key of keys) {
        const item = itemsRef.current.find((row) => row.key === key);
        if (!item || item.status === "done") continue;
        const outcome = await uploadOne(id, item);
        if (outcome === "ok") saved += 1;
        else failed += 1;
        if (outcome === "consent") {
          blocked = true;
          break;
        }
      }
      return { saved, failed, blocked };
    }

    useImperativeHandle(ref, () => ({
      fileCount: () => itemsRef.current.length,
      uploadAll: (id: string) => {
        patientRef.current = id;
        const keys = itemsRef.current.filter((row) => row.status !== "done").map((row) => row.key);
        return uploadKeys(id, keys);
      },
      retryFailed: () => {
        const id = patientRef.current;
        if (!id) return Promise.resolve({ saved: 0, failed: 0, blocked: false });
        const keys = itemsRef.current.filter((row) => row.status === "failed").map((row) => row.key);
        return uploadKeys(id, keys);
      },
      reset: () => {
        commit([]);
        setConsent(null);
        setConsentOpen(false);
        setConsentMessage("");
        patientRef.current = null;
      },
    }));

    async function retryOne(item: IntakeReport) {
      const id = patientRef.current;
      if (!id) return;
      await uploadKeys(id, [item.key]);
    }

    return (
      <div data-testid="reception-intake-reports" className="min-w-0 max-w-full space-y-3">
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-slate-900">Reports</h4>
          <p className="text-xs text-slate-600 mt-1 break-words">
            Attach reports for this patient. Files stay in this clinic. {PATIENT_DOCUMENT_LIMIT_LABEL}
          </p>
        </div>

        <div
          data-testid="reception-report-dropzone"
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            addFiles(filesFrom(event.dataTransfer.files));
          }}
          className={`rounded-xl border-2 border-dashed px-3 py-4 text-center min-w-0 ${
            dragOver ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50"
          }`}
        >
          <Upload className="w-6 h-6 text-slate-500 mx-auto" />
          <p className="text-sm font-semibold text-slate-900 mt-2">Drop reports here</p>
          <p className="text-xs text-slate-600 mt-1">PDF, JPG, or PNG. Nothing is uploaded until the patient is saved.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              data-testid="reception-report-choose"
              onClick={() => fileRef.current?.click()}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
            >
              <Upload className="w-4 h-4" />
              Choose files
            </button>
            <button
              type="button"
              data-testid="reception-report-take-photo"
              onClick={() => cameraRef.current?.click()}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              <Camera className="w-4 h-4" />
              Take photo
            </button>
          </div>
          <input
            ref={fileRef}
            data-testid="reception-report-file"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            multiple
            className="sr-only"
            onChange={(event) => {
              const files = filesFrom(event.target.files);
              event.target.value = "";
              addFiles(files);
            }}
          />
          <input
            ref={cameraRef}
            data-testid="reception-report-camera"
            type="file"
            accept="image/jpeg,image/png,.jpg,.jpeg,.png"
            capture="environment"
            className="sr-only"
            onChange={(event) => {
              const files = filesFrom(event.target.files);
              event.target.value = "";
              addFiles(files);
            }}
          />
        </div>

        {consentMessage && (
          <p
            role="alert"
            data-testid="reception-report-consent"
            className="text-sm text-amber-950 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 break-words"
          >
            {consentMessage}
          </p>
        )}

        {items.length > 0 && (
          <ul className="space-y-3 min-w-0">
            {items.map((item) => (
              <li
                key={item.key}
                data-testid="reception-report-row"
                className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 min-w-0 max-w-full"
              >
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <p className="text-xs text-slate-600 break-all min-w-0">
                    {item.file.name} · {formatBytes(item.file.size)}
                  </p>
                  {item.status !== "uploading" && item.status !== "done" && (
                    <button
                      type="button"
                      data-testid="reception-report-remove"
                      aria-label={`Remove ${item.file.name}`}
                      onClick={() => commit(itemsRef.current.filter((row) => row.key !== item.key))}
                      className="shrink-0 p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <label className="block min-w-0 text-xs font-semibold text-slate-600">
                  Title
                  <input
                    data-testid="reception-report-title"
                    value={item.title}
                    onChange={(event) => patch(item.key, { title: event.target.value })}
                    className="mt-1 w-full max-w-full min-w-0 rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900"
                  />
                </label>
                <label className="block min-w-0 text-xs font-semibold text-slate-600">
                  Type
                  <select
                    data-testid="reception-report-type"
                    value={item.docType}
                    onChange={(event) => patch(item.key, { docType: event.target.value })}
                    className="mt-1 w-full max-w-full min-w-0 rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900 bg-white"
                  >
                    <option value="">Select type</option>
                    {DOC_TYPES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block min-w-0 text-xs font-semibold text-slate-600">
                  Date
                  <input
                    data-testid="reception-report-date"
                    type="date"
                    value={item.documentDate}
                    onChange={(event) => patch(item.key, { documentDate: event.target.value })}
                    className="mt-1 w-full max-w-full min-w-0 rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900"
                  />
                </label>
                {(item.status === "uploading" || item.progress > 0) && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span>Uploading</span>
                      <span data-testid="reception-report-progress-label">{item.progress}%</span>
                    </div>
                    <div
                      data-testid="reception-report-progress"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={item.progress}
                      className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden"
                    >
                      <div className="h-full bg-blue-600" style={{ width: `${item.progress}%` }} />
                    </div>
                  </div>
                )}
                {item.status === "done" && (
                  <p className="text-xs font-semibold text-emerald-700" data-testid="reception-report-stored">
                    Stored
                  </p>
                )}
                {item.error && (
                  <p className="text-xs text-rose-700 break-words" role="alert" data-testid="reception-report-error">
                    {item.error}
                  </p>
                )}
                {item.status === "failed" && patientId && (
                  <button
                    type="button"
                    data-testid="reception-report-retry"
                    onClick={() => void retryOne(item)}
                    className="w-full sm:w-auto px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold"
                  >
                    Retry
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {consentOpen && consent && patientRef.current && (
          <PatientDocumentConsentDialog
            patientId={patientRef.current}
            status={consent}
            onClose={() => setConsentOpen(false)}
            onGranted={(next) => {
              setConsent(next);
              setConsentOpen(false);
              const id = patientRef.current;
              if (next.active && id) void uploadKeys(id, itemsRef.current.filter((row) => row.status !== "done").map((row) => row.key));
            }}
          />
        )}
      </div>
    );
  }
);

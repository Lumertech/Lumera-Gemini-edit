import React, { useEffect, useRef, useState } from "react";
import { Camera, Download, Eye, FileText, Trash2, Upload, X } from "lucide-react";
import { apiFetch, getStoredToken } from "../api/http";

const MAX_BYTES = 10 * 1024 * 1024;

const DOC_TYPES = [
  { value: "lab_report", label: "Lab report" },
  { value: "prescription", label: "Prescription" },
  { value: "discharge_summary", label: "Discharge summary" },
  { value: "imaging", label: "Imaging" },
  { value: "other", label: "Other" },
] as const;

type DocType = (typeof DOC_TYPES)[number]["value"];

interface PatientDocument {
  id: string;
  title: string;
  docType: DocType | string;
  documentDate: string;
  uploadedById: string;
  uploadedByName: string;
  uploadedByRole: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  canDelete: boolean;
}

interface PendingFile {
  key: string;
  file: File;
  title: string;
  docType: string;
  documentDate: string;
  error: string;
  uploading: boolean;
}

function typeLabel(value: string): string {
  return DOC_TYPES.find((option) => option.value === value)?.label || value;
}

function formatDocDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function titleFromName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
  return base.slice(0, 200);
}

function clientFileError(file: File): string {
  if (file.size > MAX_BYTES) return "Each file must be 10 MB or smaller.";
  const name = file.name.toLowerCase();
  const allowedExt = [".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif"];
  const allowedType = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif", "image/jpg", ""];
  const extOk = allowedExt.some((ext) => name.endsWith(ext));
  const type = (file.type || "").toLowerCase();
  if (type && !allowedType.includes(type) && type !== "application/octet-stream") {
    return "Use a PDF, JPG, PNG, or HEIC file.";
  }
  if (!extOk && type && !allowedType.includes(type)) return "Use a PDF, JPG, PNG, or HEIC file.";
  if (!extOk && !type) return "Use a PDF, JPG, PNG, or HEIC file.";
  return "";
}

async function fetchAuthorizedBlob(path: string): Promise<Blob> {
  const headers = new Headers();
  const token = getStoredToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("x-session-token", token);
  }
  const res = await fetch(path, { credentials: "include", headers });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.blob();
}

function isImageMime(mime: string): boolean {
  return mime === "image/jpeg" || mime === "image/png";
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

export const PatientDocuments: React.FC<{ patientId: string }> = ({ patientId }) => {
  const [documents, setDocuments] = useState<PatientDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ title: string; mime: string; url: string } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [webcamOn, setWebcamOn] = useState(false);
  const [webcamError, setWebcamError] = useState("");
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const thumbUrls = useRef<Record<string, string>>({});

  function stopWebcam() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setWebcamOn(false);
  }

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      for (const url of Object.values(thumbUrls.current)) URL.revokeObjectURL(String(url));
    };
  }, []);

  useEffect(() => {
    if (!webcamOn || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => undefined);
  }, [webcamOn]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setDocuments([]);
    setPending([]);
    setConfirmDeleteId("");
    void apiFetch<{ documents: PatientDocument[] }>(`/api/patients/${encodeURIComponent(patientId)}/documents`)
      .then((data) => {
        if (!cancelled) setDocuments(data.documents || []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load documents");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  useEffect(() => {
    let cancelled = false;
    const images = documents.filter((doc) => isImageMime(doc.mimeType) && !thumbUrls.current[doc.id]);
    for (const doc of images) {
      void fetchAuthorizedBlob(
        `/api/patients/${encodeURIComponent(patientId)}/documents/${encodeURIComponent(doc.id)}/file?purpose=thumbnail`
      )
        .then((blob) => {
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          thumbUrls.current[doc.id] = url;
          setThumbs((prev) => ({ ...prev, [doc.id]: url }));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [documents, patientId]);

  function addFiles(files: File[]) {
    const next: PendingFile[] = [];
    const problems: string[] = [];
    for (const file of files) {
      const problem = clientFileError(file);
      if (problem) {
        problems.push(`${file.name}: ${problem}`);
        continue;
      }
      next.push({
        key: crypto.randomUUID(),
        file,
        title: titleFromName(file.name),
        docType: "",
        documentDate: "",
        error: "",
        uploading: false,
      });
    }
    if (next.length) setPending((prev) => [...prev, ...next]);
    if (problems.length) setError(problems.join(" "));
  }

  function updatePending(key: string, patch: Partial<PendingFile>) {
    setPending((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  async function uploadOne(item: PendingFile) {
    if (!item.title.trim() || !item.docType || !item.documentDate) {
      updatePending(item.key, { error: "Add a title, type, and date before uploading." });
      return;
    }
    updatePending(item.key, { uploading: true, error: "" });
    const body = new FormData();
    body.set("file", item.file);
    body.set("title", item.title.trim());
    body.set("docType", item.docType);
    body.set("documentDate", item.documentDate);
    try {
      const saved = await apiFetch<{ document: PatientDocument }>(
        `/api/patients/${encodeURIComponent(patientId)}/documents`,
        { method: "POST", body }
      );
      setPending((prev) => prev.filter((row) => row.key !== item.key));
      if (saved.document?.id) {
        setDocuments((prev) => [saved.document, ...prev.filter((row) => row.id !== saved.document.id)]);
      }
    } catch (err) {
      updatePending(item.key, {
        uploading: false,
        error: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }

  async function startWebcam() {
    setWebcamError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setWebcamError("This browser has no webcam. Take a photo or choose a file instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setWebcamOn(true);
    } catch {
      setWebcamError("The webcam is unavailable. Take a photo or choose a file instead.");
    }
  }

  function captureWebcam() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setWebcamError("The camera is still starting. Try again in a moment.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setWebcamError("Could not capture a photo.");
          return;
        }
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
        addFiles([file]);
        stopWebcam();
      },
      "image/jpeg",
      0.92
    );
  }

  async function openPreview(doc: PatientDocument) {
    setPreviewError("");
    if (preview?.url.startsWith("blob:")) URL.revokeObjectURL(preview.url);
    setPreview(null);
    try {
      if (doc.mimeType === "application/pdf") {
        const ticket = await apiFetch<{ ticket: string }>(
          `/api/patients/${encodeURIComponent(patientId)}/documents/${encodeURIComponent(doc.id)}/preview-ticket`,
          { method: "POST", body: "{}" }
        );
        const url = `/api/patients/${encodeURIComponent(patientId)}/documents/${encodeURIComponent(doc.id)}/file?purpose=preview&ticket=${encodeURIComponent(ticket.ticket)}`;
        setPreview({ title: doc.title, mime: doc.mimeType, url });
        return;
      }
      const blob = await fetchAuthorizedBlob(
        `/api/patients/${encodeURIComponent(patientId)}/documents/${encodeURIComponent(doc.id)}/file?purpose=preview`
      );
      if (!isImageMime(doc.mimeType)) {
        setPreviewError("This file can be downloaded. A preview is available for JPG, PNG, and PDF.");
        return;
      }
      setPreview({ title: doc.title, mime: doc.mimeType, url: URL.createObjectURL(blob) });
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Could not preview this document");
    }
  }

  function closePreview() {
    if (preview?.url.startsWith("blob:")) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  async function download(doc: PatientDocument) {
    setError("");
    try {
      const blob = await fetchAuthorizedBlob(
        `/api/patients/${encodeURIComponent(patientId)}/documents/${encodeURIComponent(doc.id)}/file?purpose=download`
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = doc.originalFilename || `${doc.title}.bin`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download this document");
    }
  }

  async function remove(doc: PatientDocument) {
    setError("");
    try {
      await apiFetch(`/api/patients/${encodeURIComponent(patientId)}/documents/${encodeURIComponent(doc.id)}`, {
        method: "DELETE",
      });
      setDocuments((prev) => prev.filter((row) => row.id !== doc.id));
      setConfirmDeleteId("");
      const thumb = thumbUrls.current[doc.id];
      if (thumb) {
        URL.revokeObjectURL(thumb);
        delete thumbUrls.current[doc.id];
        setThumbs((prev) => {
          const next = { ...prev };
          delete next[doc.id];
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this document");
    }
  }

  return (
    <section
      data-testid="patient-documents"
      className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 min-w-0 max-w-full overflow-x-hidden"
    >
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-slate-900">Documents &amp; Reports</h2>
        <p className="text-xs text-slate-600 mt-1 break-words">
          Attach earlier reports for this patient. Files stay private to this clinic.
        </p>
      </div>

      <div className="flex flex-col gap-2 w-full min-w-0 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          <Camera className="w-4 h-4" />
          Take a photo
        </button>
        <button
          type="button"
          data-testid="patient-document-webcam"
          onClick={() => void startWebcam()}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          <Camera className="w-4 h-4" />
          Use webcam
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
        >
          <Upload className="w-4 h-4" />
          Choose files
        </button>
        <input
          ref={cameraRef}
          data-testid="patient-document-camera"
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(event) => {
            const files = filesFrom(event.target.files);
            event.target.value = "";
            if (files.length) addFiles(files);
          }}
        />
        <input
          ref={fileRef}
          data-testid="patient-document-file"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif"
          multiple
          className="sr-only"
          onChange={(event) => {
            const files = filesFrom(event.target.files);
            event.target.value = "";
            if (files.length) addFiles(files);
          }}
        />
      </div>

      {webcamError && (
        <p className="text-xs text-rose-700 break-words" role="alert">
          {webcamError}
        </p>
      )}

      {webcamOn && (
        <div className="min-w-0 max-w-full space-y-2">
          <video
            ref={videoRef}
            data-testid="patient-document-webcam-preview"
            playsInline
            muted
            autoPlay
            className="w-full max-w-full rounded-lg bg-slate-900"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              data-testid="patient-document-webcam-capture"
              onClick={captureWebcam}
              className="w-full sm:w-auto px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold"
            >
              Capture photo
            </button>
            <button
              type="button"
              onClick={stopWebcam}
              className="w-full sm:w-auto px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <ul className="space-y-3 min-w-0">
          {pending.map((item) => (
            <li key={item.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2 min-w-0">
              <p className="text-xs text-slate-600 break-all">
                {item.file.name} · {formatBytes(item.file.size)}
              </p>
              <label className="block min-w-0 text-xs font-semibold text-slate-600">
                Title
                <input
                  data-testid="patient-document-title"
                  value={item.title}
                  onChange={(event) => updatePending(item.key, { title: event.target.value })}
                  className="mt-1 w-full max-w-full min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                />
              </label>
              <label className="block min-w-0 text-xs font-semibold text-slate-600">
                Type
                <select
                  data-testid="patient-document-type"
                  value={item.docType}
                  onChange={(event) => updatePending(item.key, { docType: event.target.value })}
                  className="mt-1 w-full max-w-full min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 bg-white"
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
                  data-testid="patient-document-date"
                  type="date"
                  value={item.documentDate}
                  onChange={(event) => updatePending(item.key, { documentDate: event.target.value })}
                  className="mt-1 w-full max-w-full min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                />
              </label>
              {item.error && (
                <p className="text-xs text-rose-700 break-words" role="alert">
                  {item.error}
                </p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  data-testid="patient-document-upload"
                  disabled={item.uploading || !item.title.trim() || !item.docType || !item.documentDate}
                  onClick={() => void uploadOne(item)}
                  className="w-full sm:w-auto px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
                >
                  {item.uploading ? "Uploading…" : "Upload"}
                </button>
                <button
                  type="button"
                  onClick={() => setPending((prev) => prev.filter((row) => row.key !== item.key))}
                  className="w-full sm:w-auto px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-sm text-rose-700 break-words" role="alert">
          {error}
        </p>
      )}
      {previewError && (
        <p className="text-sm text-rose-700 break-words" role="alert">
          {previewError}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading documents…</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-slate-600">No documents or reports attached yet.</p>
      ) : (
        <ul data-testid="patient-document-list" className="space-y-2 min-w-0">
          {documents.map((doc) => (
            <li
              key={doc.id}
              data-testid={`patient-document-row-${doc.id}`}
              className="rounded-lg border border-slate-100 bg-slate-50 p-3 min-w-0 max-w-full"
            >
              <div className="flex gap-3 min-w-0">
                {thumbs[doc.id] ? (
                  <img
                    src={thumbs[doc.id]}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-md object-cover border border-slate-200 bg-white"
                  />
                ) : (
                  <span className="h-14 w-14 shrink-0 rounded-md border border-slate-200 bg-white inline-flex items-center justify-center">
                    <FileText className="w-5 h-5 text-slate-400" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 break-words">{doc.title}</p>
                  <p className="text-xs text-slate-600 break-words mt-0.5">
                    {typeLabel(doc.docType)} · {formatDocDate(doc.documentDate)}
                  </p>
                  <p className="text-xs text-slate-500 break-words mt-0.5">
                    Uploaded by {doc.uploadedByName || "Staff"}
                    {doc.createdAt ? ` · ${formatWhen(doc.createdAt)}` : ""}
                    {doc.sizeBytes ? ` · ${formatBytes(doc.sizeBytes)}` : ""}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  data-testid={`patient-document-preview-${doc.id}`}
                  onClick={() => void openPreview(doc)}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Preview
                </button>
                <button
                  type="button"
                  data-testid={`patient-document-download-${doc.id}`}
                  onClick={() => void download(doc)}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>
                {doc.canDelete && confirmDeleteId !== doc.id && (
                  <button
                    type="button"
                    data-testid={`patient-document-delete-${doc.id}`}
                    onClick={() => setConfirmDeleteId(doc.id)}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 bg-white text-xs font-semibold text-rose-700"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                )}
                {doc.canDelete && confirmDeleteId === doc.id && (
                  <button
                    type="button"
                    data-testid={`patient-document-delete-confirm-${doc.id}`}
                    onClick={() => void remove(doc)}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold"
                  >
                    Confirm delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true" aria-label={preview.title}>
          <button type="button" className="absolute inset-0 bg-slate-900/50" aria-label="Close preview" onClick={closePreview} />
          <div className="relative h-full w-full max-w-full overflow-y-auto overflow-x-hidden p-3">
            <div className="mx-auto w-full max-w-3xl min-w-0 rounded-xl bg-white p-3 space-y-2">
              <div className="flex items-start justify-between gap-2 min-w-0">
                <h3 className="text-sm font-bold text-slate-900 break-words">{preview.title}</h3>
                <button type="button" onClick={closePreview} className="shrink-0 p-1 rounded-md text-slate-600" aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {preview.mime === "application/pdf" ? (
                <iframe title={preview.title} src={preview.url} className="w-full max-w-full h-[70vh] border border-slate-200 rounded-lg" />
              ) : (
                <img src={preview.url} alt={preview.title} className="w-full max-w-full h-auto rounded-lg" />
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

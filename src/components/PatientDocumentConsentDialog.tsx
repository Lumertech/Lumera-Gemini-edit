import React, { useEffect, useId, useState } from "react";
import { apiFetch } from "../api/http";
import {
  CLINIC_NAME_REQUIRED_MESSAGE,
  consentMethodLabel,
  type HealthDocumentConsentMethod,
  type HealthDocumentNoticeLanguage,
} from "../lib/healthDocumentNotice";

export interface DocumentConsentStatus {
  active: boolean;
  minor: boolean;
  clinicName: string;
  clinicNameSet?: boolean;
  retentionYears: number;
  notices: {
    en: { title: string; body: string };
    hi: { title: string; body: string };
  };
  latest: {
    event: string;
    capturedAt: string;
    method: string;
    language?: string;
    guardianName?: string;
    guardianRelation?: string;
  } | null;
}

const METHODS: HealthDocumentConsentMethod[] = ["staff_attested_verbal", "signed_paper", "in_app", "whatsapp"];

export const PatientDocumentConsentDialog: React.FC<{
  patientId: string;
  status: DocumentConsentStatus;
  onClose: () => void;
  onGranted: (status: DocumentConsentStatus) => void;
}> = ({ patientId, status, onClose, onGranted }) => {
  const titleId = useId();
  const [language, setLanguage] = useState<HealthDocumentNoticeLanguage>("en");
  const [method, setMethod] = useState<HealthDocumentConsentMethod | "">("");
  const [attested, setAttested] = useState(false);
  const [guardianName, setGuardianName] = useState("");
  const [guardianRelation, setGuardianRelation] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const notice = status.notices[language];
  const clinicNameMissing = status.clinicNameSet === false || !status.clinicName.trim();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (clinicNameMissing) {
      setError(CLINIC_NAME_REQUIRED_MESSAGE);
      return;
    }
    if (!attested || !method) {
      setError("Show the notice, confirm agreement, and choose how it was given.");
      return;
    }
    if (status.minor && (!guardianName.trim() || !guardianRelation.trim())) {
      setError("Enter the parent or guardian's name and relation.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await apiFetch<{ status: DocumentConsentStatus }>(
        `/api/patients/${encodeURIComponent(patientId)}/document-consent`,
        {
          method: "POST",
          body: JSON.stringify({
            language,
            method,
            attested: true,
            guardianName: guardianName.trim(),
            guardianRelation: guardianRelation.trim(),
          }),
        }
      );
      onGranted(saved.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record consent");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-3" role="presentation">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="health-document-consent"
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-4 shadow-xl space-y-3"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-base font-bold text-slate-900">
            {notice.title}
          </h2>
          <div className="flex shrink-0 rounded-lg border border-slate-200 p-0.5">
            <button
              type="button"
              onClick={() => setLanguage("en")}
              className={`px-2 py-1 text-xs font-semibold rounded-md ${language === "en" ? "bg-slate-900 text-white" : "text-slate-600"}`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => setLanguage("hi")}
              className={`px-2 py-1 text-xs font-semibold rounded-md ${language === "hi" ? "bg-slate-900 text-white" : "text-slate-600"}`}
            >
              हिन्दी
            </button>
          </div>
        </div>
        {clinicNameMissing ? (
          <p className="text-sm text-rose-800 break-words" role="alert" data-testid="clinic-name-required">
            {CLINIC_NAME_REQUIRED_MESSAGE}
          </p>
        ) : (
          <p className="text-sm text-slate-800 whitespace-pre-wrap break-words" data-testid="health-document-notice-body">
            {notice.body}
          </p>
        )}
        <label className="block text-xs font-semibold text-slate-600">
          How consent was given
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value as HealthDocumentConsentMethod | "")}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900 bg-white"
          >
            <option value="">Select</option>
            {METHODS.map((value) => (
              <option key={value} value={value}>
                {consentMethodLabel(value)}
              </option>
            ))}
          </select>
        </label>
        {status.minor && (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-950">
              This patient is under 18. Record consent from a parent or guardian.
            </p>
            <label className="block text-xs font-semibold text-slate-700">
              Guardian name
              <input
                value={guardianName}
                onChange={(event) => setGuardianName(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Relation
              <input
                value={guardianRelation}
                onChange={(event) => setGuardianRelation(event.target.value)}
                placeholder="Parent, guardian"
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>
        )}
        <label className="flex items-start gap-2 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={attested}
            onChange={(event) => setAttested(event.target.checked)}
            className="mt-1"
            autoFocus
          />
          <span>Patient was shown this notice and agreed</span>
        </label>
        {error && (
          <p className="text-sm text-rose-700" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || clinicNameMissing}
            className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
          >
            {saving ? "Saving…" : "Record consent"}
          </button>
        </div>
      </form>
    </div>
  );
};

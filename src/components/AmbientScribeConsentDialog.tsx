import React, { useEffect, useState } from "react";
import { AMBIENT_RECORDING_DISCLOSURE, AMBIENT_SCRIBE_CONSENT_TEXT } from "../lib/ambientScribeConsent";

export function AmbientRecordingDisclosure() {
  return (
    <p data-testid="ambient-recording-disclosure" className="text-[11px] leading-snug text-slate-600 break-words">
      {AMBIENT_RECORDING_DISCLOSURE}
    </p>
  );
}

export function AmbientScribeConsentDialog({
  open,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (open) setChecked(false);
  }, [open]);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-labelledby="ambient-consent-title"
      data-testid="ambient-scribe-consent"
      className="mx-4 mt-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-3 text-sm text-slate-800"
    >
      <h3 id="ambient-consent-title" className="text-sm font-bold text-slate-900">
        Patient agreement
      </h3>
      <label className="mt-2 flex items-start gap-2 text-xs leading-snug">
        <input
          type="checkbox"
          className="mt-0.5"
          data-testid="ambient-scribe-consent-check"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
        />
        <span>{AMBIENT_SCRIBE_CONSENT_TEXT}</span>
      </label>
      {error && (
        <p role="alert" className="mt-2 text-xs text-rose-800">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="ambient-scribe-consent-confirm"
          disabled={!checked}
          onClick={() => {
            if (!checked) return;
            onConfirm();
          }}
          className="px-3 py-1.5 rounded-lg bg-violet-700 text-white text-xs font-bold disabled:opacity-40"
        >
          Start listening
        </button>
        <button
          type="button"
          onClick={() => {
            setChecked(false);
            onCancel();
          }}
          className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  ambientVisitKey,
  closedVisitNeedsFreshConsent,
  consentWriteNextStep,
  fetchAmbientScribeConsent,
  saveAmbientScribeConsent,
} from "./ambientScribeConsent";

/**
 * Loads the per-appointment attestation.
 * confirm() awaits the audit write. That turn does not open the microphone.
 * After a successful write the clinician taps Start listening, which opens the microphone in that turn.
 */
export function useAmbientScribeConsent(opts: {
  appointmentId?: string;
  patientId: string;
  onAuditFailed: () => void;
}) {
  const grantedRef = useRef(false);
  const visitRef = useRef("");
  const patientRef = useRef(opts.patientId);
  const failedRef = useRef(opts.onAuditFailed);
  failedRef.current = opts.onAuditFailed;
  patientRef.current = opts.patientId;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const known = ambientVisitKey(opts.appointmentId, opts.patientId);
    visitRef.current = known;
    grantedRef.current = false;
    setOpen(false);
    setError("");
    setNotice("");
    if (!opts.patientId) return;
    let cancelled = false;
    const load = known
      ? fetchAmbientScribeConsent({ appointmentId: known })
      : fetchAmbientScribeConsent({ patientId: opts.patientId });
    void load
      .then((row) => {
        if (cancelled || row.confirmed !== true) return;
        const appointmentId = String(row.appointmentId || known || "").trim();
        if (!appointmentId) return;
        visitRef.current = appointmentId;
        grantedRef.current = true;
        setOpen(false);
      })
      .catch(() => {
        if (!cancelled) grantedRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [opts.appointmentId, opts.patientId]);

  return {
    open,
    error,
    notice,
    saving,
    allowsStart() {
      return grantedRef.current && !saving;
    },
    appointmentId() {
      return visitRef.current;
    },
    ask() {
      if (saving) return;
      setError("");
      setOpen(true);
    },
    close() {
      if (saving) return;
      setOpen(false);
    },
    acknowledgeSecondTap() {
      setNotice("");
    },
    async confirm() {
      const patientId = patientRef.current;
      if (!patientId || saving) {
        setError("Choose a patient before recording this consult.");
        setOpen(true);
        return;
      }
      setSaving(true);
      setError("");
      try {
        const saved = await saveAmbientScribeConsent(patientId, visitRef.current || undefined);
        if (consentWriteNextStep(true) !== "second-tap") return;
        visitRef.current = String(saved.appointmentId || "").trim();
        grantedRef.current = Boolean(visitRef.current);
        setOpen(false);
        setNotice("Agreement recorded. Tap Start listening.");
      } catch (err) {
        if (closedVisitNeedsFreshConsent(err)) {
          visitRef.current = "";
          grantedRef.current = false;
          setNotice("");
          setError("");
          setOpen(true);
          return;
        }
        if (consentWriteNextStep(false) !== "blocked") return;
        grantedRef.current = false;
        setNotice("");
        setError("Could not record the patient agreement. The microphone was not started.");
        setOpen(true);
        failedRef.current();
      } finally {
        setSaving(false);
      }
    },
  };
}

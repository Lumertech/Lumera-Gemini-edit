import { useEffect, useRef, useState } from "react";
import { ambientVisitKey, fetchAmbientScribeConsent, saveAmbientScribeConsent } from "./ambientScribeConsent";

/**
 * Loads the per-appointment attestation and keeps it for the page session.
 * confirm() sets the grant and starts the mic in the same turn, then writes the audit.
 * A failed audit clears the grant so the next tap asks again.
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

  useEffect(() => {
    const visitId = ambientVisitKey(opts.appointmentId, opts.patientId);
    visitRef.current = visitId;
    grantedRef.current = false;
    setOpen(false);
    setError("");
    if (!visitId || !opts.patientId) return;
    let cancelled = false;
    void fetchAmbientScribeConsent(visitId)
      .then((row) => {
        if (cancelled) return;
        grantedRef.current = row.confirmed === true;
        if (row.confirmed) setOpen(false);
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
    allowsStart() {
      return grantedRef.current;
    },
    ask() {
      setError("");
      setOpen(true);
    },
    close() {
      setOpen(false);
    },
    confirm(startMic: () => void) {
      const visitId = visitRef.current;
      const patientId = patientRef.current;
      if (!visitId || !patientId) {
        setError("Choose a patient before recording this consult.");
        setOpen(true);
        return;
      }
      grantedRef.current = true;
      setOpen(false);
      setError("");
      startMic();
      void saveAmbientScribeConsent(visitId, patientId).catch(() => {
        grantedRef.current = false;
        setError("Could not record consent. The microphone was stopped.");
        setOpen(true);
        failedRef.current();
      });
    },
  };
}

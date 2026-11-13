import React, { useEffect, useState } from "react";
import { apiFetch } from "../api/http";
import { trialCountdownLabel, type TrialCountdownStatus } from "../lib/trialCountdown";

type TrialPayload = {
  trial?: {
    status?: TrialCountdownStatus;
    trialEndsAt?: string | null;
    readOnly?: boolean;
  };
  razorpayConfigured?: boolean;
  requiredEnv?: string[];
};

/**
 * Compact trial clock in the app header. Paid and demo workspaces return status "none" and stay blank.
 */
export function TrialHeaderCountdown() {
  const [label, setLabel] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [payNote, setPayNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch<TrialPayload>("/api/billing/trial")
      .then((body) => {
        if (cancelled) return;
        const status = body.trial?.status || "none";
        setLabel(
          trialCountdownLabel({
            status,
            trialEndsAt: body.trial?.trialEndsAt || null,
          }),
        );
        setReadOnly(Boolean(body.trial?.readOnly) || status === "read_only");
        if (status === "read_only" && body.razorpayConfigured === false) {
          const names = (body.requiredEnv || []).join(", ");
          setPayNote(names ? `Set ${names} before a charge can be taken.` : "Razorpay is not configured. The clinic was not charged.");
        }
      })
      .catch(() => {
        if (!cancelled) setLabel(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!label) return null;

  return (
    <div
      data-testid="trial-header-countdown"
      className={`flex flex-col items-end max-w-[7.5rem] sm:max-w-[16rem] leading-tight ${readOnly ? "text-amber-700" : "text-slate-600"}`}
      title={payNote || label}
    >
      <span className="text-[11px] font-semibold">{label}</span>
      {readOnly ? <span className="text-[10px] font-medium">Upgrade to pay</span> : null}
    </div>
  );
}

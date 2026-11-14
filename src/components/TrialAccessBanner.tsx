import React, { useEffect, useState } from "react";
import { apiFetch } from "../api/http";
import { formatINR } from "../lib/currency";
import { TRIAL_DAYS, TRIAL_READ_ONLY_DAY } from "../../server/trial-length.ts";
import { trialCountdownLabel } from "../lib/trialCountdown";

type TrialView = {
  status: "none" | "pending_whatsapp" | "active" | "read_only";
  daysLeft: number | null;
  trialEndsAt?: string | null;
  upgradeRequired: boolean;
  whatsappVerificationRequired: boolean;
  readOnly: boolean;
};

type PlansResponse = {
  plans?: { code: string; name: string; monthlyPaise: number; annualPaise: number }[];
  gstRateBps?: number;
};

type CheckoutResponse = {
  configured?: boolean;
  paid?: boolean;
  error?: string;
  requiredEnv?: string[];
  orderId?: string;
  amountPaise?: number;
  message?: string;
  sandbox?: boolean;
};

function rupees(paise: number): string {
  return formatINR(paise / 100).replace(/\.00$/, "");
}

/**
 * Days left during the trial. On day 31 every clinic screen asks the clinic to upgrade.
 * Payment stays unpaid until Razorpay keys exist and a verified webhook arrives.
 */
export function TrialAccessBanner() {
  const [trial, setTrial] = useState<TrialView | null>(null);
  const [payEnv, setPayEnv] = useState("");
  const [plans, setPlans] = useState<PlansResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [verificationId, setVerificationId] = useState("");

  const load = () => {
    apiFetch<{ trial: TrialView; razorpayConfigured?: boolean; requiredEnv?: string[] }>("/api/billing/trial")
      .then((body) => {
        setTrial(body.trial);
        setPayEnv(body.razorpayConfigured === false ? (body.requiredEnv || []).join(", ") : "");
      })
      .catch(() => setTrial(null));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!open) return;
    apiFetch<PlansResponse>("/api/public/plans")
      .then(setPlans)
      .catch(() => setPlans(null));
  }, [open]);

  if (!trial || trial.status === "none") return null;

  const startCheckout = async (planCode: string, cycle: "monthly" | "annual") => {
    setNotice("");
    try {
      const result = await apiFetch<CheckoutResponse>("/api/billing/plan-checkout", {
        method: "POST",
        body: JSON.stringify({ planCode, cycle }),
      });
      if (result.configured === false) {
        setNotice(
          `${result.error || "Razorpay is not configured."} Set ${ (result.requiredEnv || []).join(", ") }. Prices exclude GST until the charge adds 18% GST. Contact ravee@lumer.me.`
        );
        return;
      }
      setNotice(result.message || `Order ${result.orderId || ""} created. The clinic is not paid until Razorpay confirms it.`);
    } catch (err) {
      const body = err as { message?: string; requiredEnv?: string[] };
      setNotice(body.message || "Upgrade could not start.");
    }
  };

  const sendCode = async () => {
    setNotice("");
    try {
      const result = await apiFetch<{ verificationId: string; demoOtp?: string }>("/api/auth/trial-phone/send", {
        method: "POST",
        body: JSON.stringify({ phone }),
      });
      setVerificationId(result.verificationId);
      setNotice("Check WhatsApp for the 6-digit code.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not send the code.");
    }
  };

  const verifyCode = async () => {
    setNotice("");
    try {
      await apiFetch("/api/auth/trial-phone/verify", {
        method: "POST",
        body: JSON.stringify({ verificationId, otp }),
      });
      setOpen(false);
      load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "That code was not accepted.");
    }
  };

  const prominent = trial.readOnly || trial.upgradeRequired;
  return (
    <section
      data-testid="trial-access-banner"
      className={`mb-3 rounded-lg border px-3 py-2 text-sm ${prominent ? "bg-amber-50 border-amber-300 text-amber-950" : "bg-sky-50 border-sky-200 text-sky-950"}`}
    >
      {trial.whatsappVerificationRequired ? (
        <p data-testid="trial-whatsapp-required">Verify your WhatsApp number to start the {TRIAL_DAYS}-day free trial. No card is required.</p>
      ) : trial.status === "read_only" ? (
        <p data-testid="trial-readonly-prompt">
          Day {TRIAL_READ_ONLY_DAY}: this clinic is read-only. Records stay available. Upgrade to pay. Manual WhatsApp replies inside the 24-hour window still work.
        </p>
      ) : (
        <p data-testid="trial-days-left">
          {trialCountdownLabel({ status: "active", trialEndsAt: trial.trialEndsAt || null }) || `${trial.daysLeft ?? 0} days left`} in the free trial. No card was required to start.
        </p>
      )}
      <button
        type="button"
        data-testid="trial-upgrade"
        className="mt-2 mr-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
        onClick={() => setOpen((value) => !value)}
      >
        Upgrade to pay
      </button>
      {trial.whatsappVerificationRequired ? (
        <button type="button" className="mt-2 text-xs font-semibold underline" onClick={() => setOpen(true)}>
          Verify WhatsApp
        </button>
      ) : null}
      {open ? (
        <div className="mt-3 space-y-2" data-testid="trial-paywall">
          <p className="text-xs">Polyclinic is ₹6,699/mo and Individual is ₹1,999/mo, exclusive of GST. The charge adds 18% GST.</p>
          {payEnv ? (
            <p className="text-xs" data-testid="trial-razorpay-missing">
              Razorpay is not configured. Set {payEnv}. The clinic was not charged.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {(plans?.plans || [
              { code: "individual", name: "Individual", monthlyPaise: 199900, annualPaise: 1799900 },
              { code: "polyclinic", name: "Polyclinic", monthlyPaise: 669900, annualPaise: 5999900 },
            ]).map((plan) => (
              <button
                key={plan.code}
                type="button"
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold"
                onClick={() => void startCheckout(plan.code, "monthly")}
              >
                {plan.name} {rupees(plan.monthlyPaise)}/mo + GST
              </button>
            ))}
          </div>
          {trial.whatsappVerificationRequired ? (
            <div className="flex flex-wrap gap-2">
              <input
                data-testid="trial-phone"
                className="rounded border px-2 py-1 text-xs"
                placeholder="WhatsApp mobile"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
              <button type="button" className="text-xs font-semibold underline" onClick={() => void sendCode()}>
                Send code
              </button>
              <input
                data-testid="trial-otp"
                className="rounded border px-2 py-1 text-xs"
                placeholder="6-digit code"
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
              />
              <button type="button" className="text-xs font-semibold underline" onClick={() => void verifyCode()}>
                Verify
              </button>
            </div>
          ) : null}
          {notice ? (
            <p data-testid="trial-paywall-notice" className="text-xs">
              {notice}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

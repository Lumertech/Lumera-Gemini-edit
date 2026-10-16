import React, { useMemo } from "react";
import {
  annualApprovalCopy,
  effectiveCycle,
  monthlyAutopayCopy,
  planAfterTrial,
  planByCode,
  quoteFor,
  trialIntro,
  trialSchedule,
  type BillingCycle,
  type BillingPlanCode,
  type PublicPlans,
} from "../lib/pricingModel";
import { MONTHLY_BILLING_CONTACT, TRIAL_WHATSAPP_INR, TRIAL_WHATSAPP_SIGNUP } from "../lib/pricingCopy";

export function TrialTermsPanel({
  plans,
  plan,
  cycle,
  onCycleChange,
  agreed,
  onAgreedChange,
  showMandateStep,
  mandateAgreed,
  onMandateAgreedChange,
}: {
  plans: PublicPlans | null;
  plan: BillingPlanCode;
  cycle: BillingCycle;
  onCycleChange: (cycle: BillingCycle) => void;
  agreed: boolean;
  onAgreedChange: (agreed: boolean) => void;
  showMandateStep: boolean;
  mandateAgreed: boolean;
  onMandateAgreedChange: (agreed: boolean) => void;
}) {
  const schedule = useMemo(() => trialSchedule(), []);
  const offeredMonthly = plans ? plan === "individual" || plans.polyclinicMonthlyEnabled : true;
  const usedCycle = plans ? effectiveCycle(plans, plan, cycle) : cycle;
  const quote = plans ? quoteFor(plans, plan, usedCycle) : null;
  const planName = plans ? planByCode(plans, plan).name : plan === "polyclinic" ? "Polyclinic" : "Individual";

  return (
    <section data-testid="trial-terms" className="min-w-0 space-y-3 rounded-xl border border-slate-700 bg-slate-950/80 p-3 text-xs text-slate-200">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="Billing cycle">
        <button
          type="button"
          data-testid="trial-cycle-annual"
          aria-pressed={cycle === "annual"}
          onClick={() => onCycleChange("annual")}
          className={`min-h-11 rounded-xl border px-3 py-2 font-semibold ${cycle === "annual" ? "border-emerald-400 text-white" : "border-slate-700 text-slate-300"}`}
        >
          Annual
        </button>
        <button
          type="button"
          data-testid="trial-cycle-monthly"
          aria-pressed={cycle === "monthly"}
          onClick={() => onCycleChange("monthly")}
          className={`min-h-11 rounded-xl border px-3 py-2 font-semibold ${cycle === "monthly" ? "border-emerald-400 text-white" : "border-slate-700 text-slate-300"}`}
        >
          Monthly
        </button>
      </div>
      {!offeredMonthly && cycle === "monthly" ? (
        <p data-testid="trial-monthly-contact">{MONTHLY_BILLING_CONTACT}</p>
      ) : null}
      <p data-testid="trial-terms-copy">
        <strong>30 days free. No card needed for Lumera.</strong>{" "}
        {trialIntro(planName, usedCycle, schedule.trialEndLabel).replace(
          "30 days free. No card needed for Lumera. ",
          ""
        )}
      </p>
      <p>
        <strong>WhatsApp:</strong> {TRIAL_WHATSAPP_SIGNUP} {TRIAL_WHATSAPP_INR}
      </p>
      {quote ? <p data-testid="trial-price">{planAfterTrial(quote)}</p> : <p>Loading plan price…</p>}
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          data-testid="trial-terms-agree"
          checked={agreed}
          onChange={(event) => onAgreedChange(event.target.checked)}
          className="mt-0.5"
          required
        />
        <span>
          I agree to the <a href="/terms-of-service" className="text-emerald-300 underline">Terms of Service</a> and{" "}
          <a href="/refund-policy" className="text-emerald-300 underline">Refund policy</a>.
        </span>
      </label>
      {showMandateStep && quote ? (
        <div data-testid="autopay-step" className="space-y-2 rounded-xl border border-slate-600 p-3">
          <p>
            {usedCycle === "monthly"
              ? monthlyAutopayCopy(planName, quote, schedule.day31Label)
              : annualApprovalCopy(quote, schedule.day31Label)}
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              data-testid="trial-mandate-agree"
              checked={mandateAgreed}
              onChange={(event) => onMandateAgreedChange(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              {usedCycle === "monthly"
                ? `I authorise AutoPay for ${quote.total} per month for Lumera, as above.`
                : "I understand my annual plan renews only with my approval each year."}
            </span>
          </label>
        </div>
      ) : null}
    </section>
  );
}

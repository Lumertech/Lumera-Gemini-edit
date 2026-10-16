import React, { useEffect, useState } from "react";
import { apiFetchResponse } from "../api/http";
import { buildPricingPageModel, type PricingPageModel, type PublicPlans } from "../lib/pricingModel";
import { CONTACT_EMAIL } from "../lib/pricingCopy";

export function PricingPage() {
  const [model, setModel] = useState<PricingPageModel | null>(null);
  const [cycle, setCycle] = useState<"annual" | "monthly">("annual");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetchResponse("/api/public/plans")
      .then((res) => {
        if (!res.ok) throw new Error("Pricing is unavailable.");
        return res.json() as Promise<PublicPlans>;
      })
      .then((plans) => {
        if (!cancelled) setModel(buildPricingPageModel(plans));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Pricing is unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      data-testid="pricing-page-app"
      className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden bg-slate-50 text-slate-900"
    >
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <a href="/" className="font-semibold text-slate-900">
            Lumera
          </a>
          <nav className="flex flex-wrap gap-3 text-sm">
            <a href="/pricing">Pricing</a>
            <a href="/login">Sign in</a>
            <a href="/signup?plan=individual&cycle=annual">Try for free</a>
          </nav>
        </header>
        {error ? <p>{error} Contact {CONTACT_EMAIL}.</p> : null}
        {!model && !error ? <p>Loading pricing…</p> : null}
        {model ? (
          <>
            <h1 className="text-3xl font-bold">{model.title}</h1>
            <p className="mt-2 text-slate-600">{model.gstNote} Annual is the default billing cycle.</p>
            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Billing cycle">
              <button
                type="button"
                aria-pressed={cycle === "annual"}
                onClick={() => setCycle("annual")}
                className={`min-h-11 flex-1 rounded-full px-4 py-2 text-sm font-semibold ${cycle === "annual" ? "bg-blue-700 text-white" : "bg-white text-slate-800"}`}
              >
                Annual
              </button>
              <button
                type="button"
                aria-pressed={cycle === "monthly"}
                onClick={() => setCycle("monthly")}
                className={`min-h-11 flex-1 rounded-full px-4 py-2 text-sm font-semibold ${cycle === "monthly" ? "bg-blue-700 text-white" : "bg-white text-slate-800"}`}
              >
                Monthly
              </button>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              {model.cards.map((card) => (
                <article key={card.code} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
                  <h2 className="text-xl font-bold">{card.name}</h2>
                  <p className="text-sm text-slate-600">{card.summary}</p>
                  {cycle === "annual" || !card.monthlyDetail ? (
                    <>
                      <p className="mt-3 text-2xl font-bold">{card.annualPrice}</p>
                      <p>{card.annualDetail}</p>
                      {card.monthlyDetail ? <p className="font-semibold">{card.saving}</p> : null}
                      <a href={card.signupAnnual} className="mt-3 block min-h-11 rounded-xl bg-blue-700 px-3 py-3 text-center font-bold text-white">
                        Try {card.name} annual free
                      </a>
                    </>
                  ) : null}
                  {cycle === "monthly" ? (
                    card.monthlyDetail ? (
                      <>
                        <p className="mt-3 text-2xl font-bold">{card.monthlyPrice}</p>
                        <p>{card.monthlyDetail}</p>
                        <a href={card.signupMonthly} className="mt-3 block min-h-11 rounded-xl border border-blue-700 px-3 py-3 text-center font-bold text-blue-700">
                          Try {card.name} monthly free
                        </a>
                      </>
                    ) : (
                      <p className="mt-3">{card.monthlyFallback}</p>
                    )
                  ) : null}
                  <h3 className="mt-4 text-sm font-semibold">Includes</h3>
                  <ul className="mt-1 list-disc pl-5 text-sm">
                    {card.includes.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            <section className="mt-4 min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-xl font-bold">Extra doctors</h2>
              <p className="mt-2">{model.extraDoctor}</p>
            </section>
            <section className="mt-4 min-w-0 rounded-2xl border border-slate-200 bg-white p-4" data-testid="whatsapp-billing">
              <h2 className="text-xl font-bold">WhatsApp</h2>
              <p className="mt-2">{model.whatsapp}</p>
              <p className="mt-2">{model.whatsappInr}</p>
              <p className="mt-2 text-sm text-slate-500">{model.trademark}</p>
            </section>
            <section className="mt-4 min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-xl font-bold">Free trial</h2>
              <p className="mt-2">{model.trial}</p>
            </section>
            <section className="mt-4 min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-xl font-bold">Refunds</h2>
              <p className="mt-2">{model.refund}</p>
              <p className="mt-2">
                <a href="/refund-policy">Refund policy</a>
              </p>
            </section>
            <section className="mt-4 min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-xl font-bold">Questions</h2>
              {model.faqs.map((item) => (
                <details key={item.q} className="border-t border-slate-200 py-3">
                  <summary className="cursor-pointer font-semibold">{item.q}</summary>
                  <p className="mt-2">{item.a}</p>
                </details>
              ))}
            </section>
            <p className="mt-6 text-sm">
              Contact <a href={`mailto:${model.contactEmail}`}>{model.contactEmail}</a>
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

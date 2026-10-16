import React, { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { apiFetchResponse } from "../api/http";
import { BrandMark } from "../components/BrandMark";
import { LEGAL_ENTITY_NAME } from "../brand";
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
      className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 font-sans text-slate-200"
    >
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-5 sm:px-6">
        <a href="/" className="flex items-center no-underline" data-testid="pricing-brand">
          <BrandMark
            size="md"
            wordmarkClassName="font-manrope text-2xl font-bold tracking-tight text-white"
          />
        </a>
        <nav className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3" aria-label="Primary">
          <a href="/pricing" className="px-3 py-2 text-sm font-semibold text-slate-200 no-underline">
            Pricing
          </a>
          <a
            href="/login"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white no-underline shadow-md shadow-blue-500/20"
          >
            <Lock className="h-3.5 w-3.5" />
            Sign In
          </a>
          <a
            href="/signup?plan=individual&cycle=annual"
            data-testid="pricing-try-free"
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 font-manrope text-sm font-bold text-white no-underline shadow-xl shadow-blue-600/30 sm:flex-none"
          >
            Try for free
          </a>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        {error ? <p className="text-center">Pricing is unavailable. Contact {CONTACT_EMAIL}.</p> : null}
        {!model && !error ? <p className="text-center text-slate-400">Loading pricing…</p> : null}
        {model ? (
          <>
            <div className="mx-auto max-w-3xl text-center">
              <h1 className="font-manrope text-4xl font-extrabold tracking-tight text-white sm:text-5xl">{model.title}</h1>
              <p className="mt-2 text-slate-400">{model.gstNote} Annual is the default billing cycle.</p>
            </div>
            <div
              className="mx-auto mt-6 grid max-w-xs grid-cols-2 gap-1 rounded-full border border-white/10 bg-slate-950/80 p-1"
              role="group"
              aria-label="Billing cycle"
            >
              <button
                type="button"
                aria-pressed={cycle === "annual"}
                onClick={() => setCycle("annual")}
                className={`min-h-11 rounded-full px-4 py-2 text-sm font-bold ${cycle === "annual" ? "bg-blue-600 text-white shadow-md shadow-blue-600/30" : "text-slate-300"}`}
              >
                Annual
              </button>
              <button
                type="button"
                aria-pressed={cycle === "monthly"}
                onClick={() => setCycle("monthly")}
                className={`min-h-11 rounded-full px-4 py-2 text-sm font-bold ${cycle === "monthly" ? "bg-blue-600 text-white shadow-md shadow-blue-600/30" : "text-slate-300"}`}
              >
                Monthly
              </button>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              {model.cards.map((card) => (
                <article key={card.code} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
                  <h2 className="font-manrope text-2xl font-bold text-white">{card.name}</h2>
                  <p className="text-sm text-slate-400">{card.summary}</p>
                  {cycle === "annual" || !card.monthlyDetail ? (
                    <>
                      <p className="mt-4 font-manrope text-4xl font-extrabold tracking-tight text-white">{card.annualPrice}</p>
                      <p className="text-slate-300">{card.annualDetail}</p>
                      {card.monthlyDetail ? (
                        <p className="mt-2 inline-block rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-sm font-bold text-emerald-300">
                          {card.saving}
                        </p>
                      ) : null}
                      <a
                        href={card.signupAnnual}
                        className="mt-4 block min-h-11 rounded-xl bg-blue-600 px-3 py-3 text-center font-manrope font-bold text-white no-underline shadow-lg shadow-blue-600/30"
                      >
                        Try {card.name} annual free
                      </a>
                    </>
                  ) : null}
                  {cycle === "monthly" ? (
                    card.monthlyDetail ? (
                      <>
                        <p className="mt-4 font-manrope text-4xl font-extrabold tracking-tight text-white">{card.monthlyPrice}</p>
                        <p className="text-slate-300">{card.monthlyDetail}</p>
                        <a
                          href={card.signupMonthly}
                          className="mt-4 block min-h-11 rounded-xl bg-blue-600 px-3 py-3 text-center font-manrope font-bold text-white no-underline shadow-lg shadow-blue-600/30"
                        >
                          Try {card.name} monthly free
                        </a>
                      </>
                    ) : (
                      <p className="mt-4 text-slate-300">{card.monthlyFallback}</p>
                    )
                  ) : null}
                  <h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-slate-400">Includes</h3>
                  <ul className="mt-1 text-sm text-slate-300">
                    {card.includes.map((item) => (
                      <li key={item} className="border-t border-slate-800 py-2 pl-4">
                        {item}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            <section className="mt-4 min-w-0 rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
              <h2 className="font-manrope text-xl font-bold text-white">Extra doctors</h2>
              <p className="mt-2 text-slate-300">{model.extraDoctor}</p>
            </section>
            <section className="mt-4 min-w-0 rounded-2xl border border-slate-800 bg-slate-900/80 p-5" data-testid="whatsapp-billing">
              <h2 className="font-manrope text-xl font-bold text-white">WhatsApp</h2>
              <p className="mt-2 text-slate-300">{model.whatsapp}</p>
              <p className="mt-2 text-slate-300">{model.whatsappInr}</p>
              <p className="mt-2 text-sm text-slate-500">{model.trademark}</p>
            </section>
            <section className="mt-4 min-w-0 rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
              <h2 className="font-manrope text-xl font-bold text-white">Free trial</h2>
              <p className="mt-2 text-slate-300">{model.trial}</p>
            </section>
            <section className="mt-4 min-w-0 rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
              <h2 className="font-manrope text-xl font-bold text-white">Refunds</h2>
              <p className="mt-2 text-slate-300">{model.refund}</p>
              <p className="mt-2">
                <a href="/refund-policy" className="font-semibold text-blue-300 no-underline">
                  Refund policy
                </a>
              </p>
            </section>
            <section className="mt-4 min-w-0 rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
              <h2 className="font-manrope text-xl font-bold text-white">Questions</h2>
              {model.faqs.map((item) => (
                <details key={item.q} className="border-t border-white/10 py-3">
                  <summary className="cursor-pointer font-semibold text-white">{item.q}</summary>
                  <p className="mt-2 text-slate-300">{item.a}</p>
                </details>
              ))}
            </section>
          </>
        ) : null}
      </main>
      <footer className="border-t border-white/10 bg-slate-950 px-4 py-12 text-center text-xs text-slate-400">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="flex items-center justify-center text-white">
            <BrandMark size="sm" wordmarkClassName="font-manrope text-lg font-bold text-white" />
          </div>
          <p className="mx-auto max-w-2xl text-xs text-slate-400">
            Empowering Indian healthcare with multilingual ambient scribing (coming soon), automated WhatsApp patient self-service, and ABHA linking (in ABDM sandbox testing; not yet live).
          </p>
          <div className="flex flex-wrap justify-center gap-4 border-t border-slate-900 pt-4 text-xs font-medium text-slate-300 sm:gap-6">
            <a href="/pricing" className="no-underline hover:text-blue-400">Pricing</a>
            <a href="/terms-of-service" className="no-underline hover:text-blue-400">Terms of Service</a>
            <a href="/privacy-policy" className="no-underline hover:text-blue-400">Privacy Policy</a>
            <a href="/data-deletion-instructions" className="no-underline hover:text-blue-400">Meta Data Deletion Callback</a>
            <a href="/security" className="no-underline hover:text-blue-400">Security and privacy statement</a>
          </div>
          <div className="space-y-1 text-[11px] text-slate-500">
            <p>ABDM integration is in sandbox testing and not yet live. We follow India's DPDP Act in how we handle data.</p>
            <p>
              Contact <a className="no-underline hover:text-blue-400" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </p>
            <p className="pt-2 text-slate-600">© {new Date().getFullYear()} {LEGAL_ENTITY_NAME}. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

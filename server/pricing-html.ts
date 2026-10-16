import type { Express, Request, Response } from "express";
import { escapeHtml } from "./policy-html.ts";
import { applyHtmlDocumentSecurityHeaders } from "./html-security-headers.ts";
import { publicPlansResponse } from "./pricing-catalog.ts";
import { buildPricingPageModel, type PricingPageModel, type PublicPlans } from "../src/lib/pricingModel.ts";
import { ANNUAL_REFUND, MONTHLY_REFUND, TRIAL_REFUND } from "../src/lib/pricingCopy.ts";

export const PRICING_HTML_PATH = "/pricing";
export const REFUND_POLICY_HTML_PATH = "/refund-policy";

export function isPricingHtmlPath(pathname: string): boolean {
  const clean = (pathname.split("?")[0] || "/").replace(/\/+$/, "").toLowerCase() || "/";
  return clean === PRICING_HTML_PATH || clean === REFUND_POLICY_HTML_PATH;
}

const PRICING_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; max-width: 100%; overflow-x: hidden; }
  body {
    font-family: system-ui, sans-serif;
    color: #0f172a;
    background: #f8fafc;
    line-height: 1.5;
    overflow-y: auto;
    overflow-wrap: anywhere;
  }
  a { color: #1d4ed8; overflow-wrap: anywhere; }
  header, main, footer { width: 100%; max-width: 48rem; margin: 0 auto; padding: 1rem; }
  header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; }
  nav { display: flex; flex-wrap: wrap; gap: 0.75rem; }
  h1, h2, h3 { line-height: 1.25; overflow-wrap: anywhere; }
  h1 { font-size: 1.75rem; margin: 0 0 0.5rem; }
  .note { color: #334155; }
  .toggle { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 1rem 0; }
  .toggle label {
    flex: 1 1 8rem;
    text-align: center;
    border: 1px solid #cbd5e1;
    border-radius: 999px;
    padding: 0.6rem 0.75rem;
    background: #fff;
    cursor: pointer;
  }
  .plans { display: grid; grid-template-columns: 1fr; gap: 1rem; }
  .card, .panel {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 1rem;
    padding: 1rem;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .price { font-size: 1.5rem; font-weight: 700; margin: 0.25rem 0; }
  .actions { display: grid; grid-template-columns: 1fr; gap: 0.5rem; margin-top: 1rem; }
  .actions a {
    display: block;
    text-align: center;
    text-decoration: none;
    color: #fff;
    background: #1d4ed8;
    border-radius: 0.75rem;
    padding: 0.75rem;
    font-weight: 700;
  }
  .actions a.secondary { background: #fff; color: #1d4ed8; border: 1px solid #1d4ed8; }
  ul { padding-left: 1.1rem; margin: 0.5rem 0 0; }
  li { margin: 0.25rem 0; }
  details { border-top: 1px solid #e2e8f0; padding: 0.75rem 0; }
  summary { cursor: pointer; font-weight: 650; }
  .price-monthly { display: none; }
  #cycle-monthly:checked ~ main .price-annual { display: none; }
  #cycle-monthly:checked ~ main .price-monthly { display: block; }
  #cycle-monthly:checked ~ main .price-always { display: block; }
  #cycle-annual:checked ~ .toggle label[for="cycle-annual"],
  #cycle-monthly:checked ~ .toggle label[for="cycle-monthly"] {
    background: #1d4ed8;
    color: #fff;
    border-color: #1d4ed8;
  }
  input[name="cycle"] { position: absolute; opacity: 0; width: 1px; height: 1px; }
  @media (min-width: 48rem) {
    .plans { grid-template-columns: 1fr 1fr; }
    h1 { font-size: 2.25rem; }
  }
`;

function renderCard(card: PricingPageModel["cards"][number]): string {
  const includes = card.includes.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const monthly = card.monthlyDetail
    ? `<p class="price">${escapeHtml(card.monthlyPrice || "")}</p><p>${escapeHtml(card.monthlyDetail)}</p>
      <div class="actions">
        <a class="secondary" href="${escapeHtml(card.signupMonthly)}">Try ${escapeHtml(card.name)} monthly free</a>
      </div>`
    : `<p>${escapeHtml(card.monthlyFallback || "")}</p>`;
  const annualClass = card.monthlyDetail ? "price-annual" : "price-annual price-always";
  return `<article class="card" data-testid="plan-${escapeHtml(card.code)}">
    <h2>${escapeHtml(card.name)}</h2>
    <p>${escapeHtml(card.summary)}</p>
    <div class="${annualClass}">
      <p class="price">${escapeHtml(card.annualPrice)}</p>
      <p>${escapeHtml(card.annualDetail)}</p>
      ${card.monthlyDetail ? `<p><strong>${escapeHtml(card.saving)}</strong></p>` : ""}
      <div class="actions">
        <a href="${escapeHtml(card.signupAnnual)}">Try ${escapeHtml(card.name)} annual free</a>
      </div>
    </div>
    <div class="price-monthly">
      ${monthly}
    </div>
    <h3>Includes</h3>
    <ul>${includes}</ul>
  </article>`;
}

export function renderPricingDocumentHtml(plans: PublicPlans = publicPlansResponse()): string {
  const model = buildPricingPageModel(plans);
  const faqs = model.faqs
    .map(
      (item) =>
        `<details><summary>${escapeHtml(item.q)}</summary><p>${escapeHtml(item.a)}</p></details>`
    )
    .join("");
  const cards = model.cards.map(renderCard).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(model.title)} · Lumera</title>
  <meta name="description" content="${escapeHtml(model.description)}">
  <style>${PRICING_CSS}</style>
</head>
<body>
  <input type="radio" name="cycle" id="cycle-annual" checked>
  <input type="radio" name="cycle" id="cycle-monthly">
  <header>
    <a href="/">Lumera</a>
    <nav>
      <a href="/pricing" data-testid="pricing-nav">Pricing</a>
      <a href="/login">Sign in</a>
      <a href="/signup?plan=individual&amp;cycle=annual">Try for free</a>
    </nav>
  </header>
  <div class="toggle">
    <label for="cycle-annual">Annual</label>
    <label for="cycle-monthly">Monthly</label>
  </div>
  <main data-testid="pricing-page">
    <h1>${escapeHtml(model.title)}</h1>
    <p class="note">${escapeHtml(model.gstNote)} Annual is the default billing cycle.</p>
    <section class="plans">${cards}</section>
    <section class="panel" data-testid="extra-doctor">
      <h2>Extra doctors</h2>
      <p>${escapeHtml(model.extraDoctor)}</p>
    </section>
    <section class="panel" data-testid="whatsapp-billing">
      <h2>WhatsApp</h2>
      <p>${escapeHtml(model.whatsapp)}</p>
      <p>${escapeHtml(model.whatsappInr)}</p>
      <p class="note">${escapeHtml(model.trademark)}</p>
    </section>
    <section class="panel" data-testid="trial-summary">
      <h2>Free trial</h2>
      <p>${escapeHtml(model.trial)}</p>
    </section>
    <section class="panel" data-testid="refund-summary">
      <h2>Refunds</h2>
      <p>${escapeHtml(model.refund)}</p>
      <p><a href="/refund-policy">Refund policy</a></p>
    </section>
    <section class="panel" data-testid="pricing-faq">
      <h2>Questions</h2>
      ${faqs}
    </section>
  </main>
  <footer>
    <p>Contact <a href="mailto:${escapeHtml(model.contactEmail)}">${escapeHtml(model.contactEmail)}</a></p>
  </footer>
</body>
</html>`;
}

export function renderRefundPolicyHtml(): string {
  const body = `${ANNUAL_REFUND} ${MONTHLY_REFUND} ${TRIAL_REFUND} Refunds go back to the original payment method. Contact ravee@lumer.me.`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Refund policy · Lumera</title>
  <style>${PRICING_CSS}</style>
</head>
<body>
  <header>
    <a href="/">Lumera</a>
    <nav>
      <a href="/pricing">Pricing</a>
      <a href="/terms-of-service">Terms of Service</a>
    </nav>
  </header>
  <main data-testid="refund-policy">
    <h1>Refund policy</h1>
    <p>${escapeHtml(body)}</p>
  </main>
</body>
</html>`;
}

export function attachPublicPricingHtml(app: Express): void {
  app.get(PRICING_HTML_PATH, (_req: Request, res: Response) => {
    applyHtmlDocumentSecurityHeaders(res);
    res.status(200).type("html").send(renderPricingDocumentHtml());
  });
  app.get(REFUND_POLICY_HTML_PATH, (_req: Request, res: Response) => {
    applyHtmlDocumentSecurityHeaders(res);
    res.status(200).type("html").send(renderRefundPolicyHtml());
  });
}

/** CSS contract: phone width scrolls vertically, never sideways. */
export function pricingCssOverflowProblems(css: string): string[] {
  const problems: string[] = [];
  const rules = css.replace(/@media\s*\([^)]*\)\s*\{/g, "{");
  if (!/overflow-x:\s*hidden/.test(rules)) problems.push("missing overflow-x: hidden");
  if (/white-space:\s*nowrap/.test(rules)) problems.push("white-space: nowrap");
  if (/overflow-x:\s*(auto|scroll)/.test(rules)) problems.push("horizontal scroll container");
  for (const match of rules.matchAll(/min-width:\s*(\d+)px/g)) {
    if (Number(match[1]) > 320) problems.push(`min-width ${match[1]}px`);
  }
  for (const match of rules.matchAll(/(^|[^-\w])width:\s*(\d+)px/g)) {
    if (Number(match[2]) > 360) problems.push(`width ${match[2]}px`);
  }
  return problems;
}

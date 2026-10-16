import type { Express, Request, Response } from "express";
import { escapeHtml } from "./policy-html.ts";
import { applyHtmlDocumentSecurityHeaders } from "./html-security-headers.ts";
import { publicPlansResponse } from "./pricing-catalog.ts";
import { buildPricingPageModel, type PricingPageModel, type PublicPlans } from "../src/lib/pricingModel.ts";
import { ANNUAL_REFUND, CONTACT_EMAIL, MONTHLY_REFUND, TRIAL_REFUND } from "../src/lib/pricingCopy.ts";
import { LEGAL_ENTITY_NAME, PRODUCT_LOGO_ALT, PRODUCT_LOGO_SRC, PRODUCT_NAME } from "../src/brand.ts";

export const PRICING_HTML_PATH = "/pricing";
export const REFUND_POLICY_HTML_PATH = "/refund-policy";

export function isPricingHtmlPath(pathname: string): boolean {
  const clean = (pathname.split("?")[0] || "/").replace(/\/+$/, "").toLowerCase() || "/";
  return clean === PRICING_HTML_PATH || clean === REFUND_POLICY_HTML_PATH;
}

const FONT_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">`;

const PRICING_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; max-width: 100%; overflow-x: hidden; }
  body {
    font-family: Inter, system-ui, sans-serif;
    color: #e2e8f0;
    background: #020617;
    background-image: linear-gradient(to bottom right, #020617, #0f172a, #1e1b4b);
    line-height: 1.5;
    overflow-y: auto;
    overflow-wrap: anywhere;
  }
  a { color: inherit; text-decoration: none; overflow-wrap: anywhere; }
  h1, h2, h3, .wordmark, .price, .btn-primary, .toggle label, .actions a {
    font-family: Manrope, Inter, system-ui, sans-serif;
  }
  h1, h2, h3 { line-height: 1.25; overflow-wrap: anywhere; color: #fff; }
  h1 { font-size: 2.25rem; font-weight: 800; letter-spacing: -0.025em; margin: 0 0 0.5rem; text-align: center; }
  h2 { font-size: 1.35rem; font-weight: 700; margin: 0; }
  h3 { font-size: 0.8rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #94a3b8; margin: 1.25rem 0 0; }
  .site-header {
    width: 100%;
    max-width: 72rem;
    margin: 0 auto;
    padding: 1.25rem 1rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  .brand { display: inline-flex; align-items: center; gap: 0.65rem; color: #fff; }
  .brand img {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 0.75rem;
    object-fit: contain;
    box-shadow: 0 10px 15px rgba(168, 85, 247, 0.3);
  }
  .brand-sm img { width: 1.75rem; height: 1.75rem; }
  .wordmark { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.025em; color: #fff; }
  .wordmark-sm { font-size: 1.125rem; }
  .site-nav { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 0.5rem; max-width: 100%; }
  .nav-link { padding: 0.5rem 0.75rem; font-size: 0.875rem; font-weight: 600; color: #e2e8f0; }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    border-radius: 0.5rem;
    padding: 0.5rem 1.15rem;
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.2;
    color: #fff;
  }
  .btn-signin { background: #2563eb; box-shadow: 0 4px 6px rgba(37, 99, 235, 0.25); }
  .btn-primary {
    border-radius: 0.75rem;
    padding: 0.7rem 1.15rem;
    font-weight: 700;
    background: #2563eb;
    box-shadow: 0 12px 24px rgba(37, 99, 235, 0.35);
  }
  .icon { width: 0.9rem; height: 0.9rem; }
  main { width: 100%; max-width: 72rem; margin: 0 auto; padding: 1.75rem 1rem 2.5rem; }
  .intro { max-width: 40rem; margin: 0 auto 0.25rem; text-align: center; }
  .note { color: #94a3b8; margin: 0; }
  .toggle {
    display: grid;
    grid-template-columns: 1fr 1fr;
    width: 100%;
    max-width: 22rem;
    margin: 1.25rem auto 1.5rem;
    padding: 0.25rem;
    gap: 0.25rem;
    border-radius: 999px;
    background: rgba(2, 6, 23, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.12);
  }
  .toggle label {
    text-align: center;
    border-radius: 999px;
    padding: 0.7rem 0.75rem;
    color: #cbd5e1;
    font-weight: 700;
    font-size: 0.875rem;
    cursor: pointer;
  }
  .plans { display: grid; grid-template-columns: 1fr; gap: 1rem; }
  .card, .panel {
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid #1e293b;
    border-radius: 1rem;
    padding: 1.25rem;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .summary { color: #94a3b8; margin: 0.35rem 0 0; }
  .price { font-size: 2rem; font-weight: 800; letter-spacing: -0.03em; color: #fff; margin: 0.85rem 0 0.2rem; }
  .detail { color: #cbd5e1; margin: 0; }
  .saving {
    display: inline-block;
    margin: 0.65rem 0 0;
    padding: 0.2rem 0.65rem;
    border-radius: 999px;
    background: rgba(16, 185, 129, 0.14);
    color: #6ee7b7;
    font-weight: 700;
    font-size: 0.85rem;
  }
  .actions { display: grid; grid-template-columns: 1fr; gap: 0.5rem; margin-top: 1rem; }
  .actions a {
    display: block;
    text-align: center;
    text-decoration: none;
    color: #fff;
    background: #2563eb;
    border-radius: 0.75rem;
    padding: 0.85rem 1rem;
    font-weight: 700;
    box-shadow: 0 10px 20px rgba(37, 99, 235, 0.28);
  }
  ul.includes { list-style: none; padding: 0; margin: 0.5rem 0 0; }
  ul.includes li {
    position: relative;
    margin: 0;
    padding: 0.55rem 0 0.55rem 1.15rem;
    color: #cbd5e1;
    border-top: 1px solid rgba(30, 41, 59, 0.95);
  }
  ul.includes li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.9rem;
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 999px;
    background: #34d399;
  }
  .stack { display: grid; grid-template-columns: 1fr; gap: 1rem; margin-top: 1rem; }
  details { border-top: 1px solid rgba(255, 255, 255, 0.08); padding: 0.85rem 0; }
  summary { cursor: pointer; font-weight: 650; color: #fff; }
  details p { color: #cbd5e1; }
  .site-footer {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    background: #020617;
    color: #94a3b8;
    text-align: center;
    padding: 3rem 1rem;
    font-size: 0.75rem;
  }
  .footer-inner { max-width: 64rem; margin: 0 auto; }
  .footer-brand { display: flex; justify-content: center; }
  .mission { max-width: 40rem; margin: 1.25rem auto 0; color: #94a3b8; }
  .footer-links {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.85rem 1.25rem;
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid #0f172a;
    color: #cbd5e1;
    font-weight: 500;
  }
  .fineprint { margin-top: 1.25rem; color: #64748b; }
  .fineprint p { margin: 0.35rem 0; }
  .copy { color: #475569; margin-top: 0.85rem; }
  .price-monthly { display: none; }
  #cycle-monthly:checked ~ main .price-annual { display: none; }
  #cycle-monthly:checked ~ main .price-monthly { display: block; }
  #cycle-monthly:checked ~ main .price-always { display: block; }
  #cycle-annual:checked ~ main .toggle label[for="cycle-annual"],
  #cycle-monthly:checked ~ main .toggle label[for="cycle-monthly"] {
    background: #2563eb;
    color: #fff;
    box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35);
  }
  input[name="cycle"] { position: absolute; opacity: 0; width: 1px; height: 1px; overflow: hidden; }
  @media (max-width: 47.99rem) {
    .site-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      column-gap: 0.35rem;
      row-gap: 0.65rem;
    }
    .site-nav { display: contents; }
    .nav-link { padding: 0.5rem 0.35rem; }
    .btn-signin { padding: 0.5rem 0.7rem; }
    .btn-primary { grid-column: 1 / -1; }
  }
  @media (min-width: 48rem) {
    .site-header, main { padding-left: 1.5rem; padding-right: 1.5rem; }
    .plans { grid-template-columns: 1fr 1fr; align-items: stretch; }
    h1 { font-size: 3rem; }
    .price { font-size: 2.25rem; }
  }
`;

function renderSiteHeader(): string {
  return `<header class="site-header">
    <a class="brand" href="/" data-testid="pricing-brand">
      <img src="${PRODUCT_LOGO_SRC}" alt="${escapeHtml(PRODUCT_LOGO_ALT)}" width="40" height="40">
      <span class="wordmark">${escapeHtml(PRODUCT_NAME)}</span>
    </a>
    <nav class="site-nav" aria-label="Primary">
      <a class="nav-link" href="/pricing" data-testid="pricing-nav">Pricing</a>
      <a class="btn btn-signin" href="/login">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Sign In
      </a>
      <a class="btn btn-primary" href="/signup?plan=individual&amp;cycle=annual" data-testid="pricing-try-free">Try for free</a>
    </nav>
  </header>`;
}

function renderSiteFooter(): string {
  const year = new Date().getFullYear();
  return `<footer class="site-footer">
    <div class="footer-inner">
      <div class="footer-brand">
        <a class="brand brand-sm" href="/">
          <img src="${PRODUCT_LOGO_SRC}" alt="${escapeHtml(PRODUCT_LOGO_ALT)}" width="28" height="28">
          <span class="wordmark wordmark-sm">${escapeHtml(PRODUCT_NAME)}</span>
        </a>
      </div>
      <p class="mission">Empowering Indian healthcare with multilingual ambient scribing, automated WhatsApp patient self-service, and ABDM-aligned interoperability (sandbox path).</p>
      <nav class="footer-links" aria-label="Policies">
        <a href="/pricing">Pricing</a>
        <a href="/terms-of-service">Terms of Service</a>
        <a href="/privacy-policy">Privacy Policy</a>
        <a href="/data-deletion-instructions">Meta Data Deletion Callback</a>
        <a href="/security">ABDM &amp; DPDP Security Statement</a>
      </nav>
      <div class="fineprint">
        <p>Designed for ABDM M1–M3 &amp; DPDP (sandbox path).</p>
        <p>Contact <a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a></p>
        <p class="copy">© ${year} ${escapeHtml(LEGAL_ENTITY_NAME)}. All rights reserved.</p>
      </div>
    </div>
  </footer>`;
}

function renderCard(card: PricingPageModel["cards"][number]): string {
  const includes = card.includes.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const monthly = card.monthlyDetail
    ? `<p class="price">${escapeHtml(card.monthlyPrice || "")}</p><p class="detail">${escapeHtml(card.monthlyDetail)}</p>
      <div class="actions">
        <a href="${escapeHtml(card.signupMonthly)}">Try ${escapeHtml(card.name)} monthly free</a>
      </div>`
    : `<p class="detail">${escapeHtml(card.monthlyFallback || "")}</p>`;
  const annualClass = card.monthlyDetail ? "price-annual" : "price-annual price-always";
  return `<article class="card" data-testid="plan-${escapeHtml(card.code)}">
    <h2>${escapeHtml(card.name)}</h2>
    <p class="summary">${escapeHtml(card.summary)}</p>
    <div class="${annualClass}">
      <p class="price">${escapeHtml(card.annualPrice)}</p>
      <p class="detail">${escapeHtml(card.annualDetail)}</p>
      ${card.monthlyDetail ? `<p class="saving">${escapeHtml(card.saving)}</p>` : ""}
      <div class="actions">
        <a href="${escapeHtml(card.signupAnnual)}">Try ${escapeHtml(card.name)} annual free</a>
      </div>
    </div>
    <div class="price-monthly">
      ${monthly}
    </div>
    <h3>Includes</h3>
    <ul class="includes">${includes}</ul>
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
  ${FONT_LINKS}
  <style>${PRICING_CSS}</style>
</head>
<body>
  <input type="radio" name="cycle" id="cycle-annual" checked>
  <input type="radio" name="cycle" id="cycle-monthly">
  ${renderSiteHeader()}
  <main data-testid="pricing-page">
    <div class="intro">
      <h1>${escapeHtml(model.title)}</h1>
      <p class="note">${escapeHtml(model.gstNote)} Annual is the default billing cycle.</p>
    </div>
    <div class="toggle" role="group" aria-label="Billing cycle">
      <label for="cycle-annual">Annual</label>
      <label for="cycle-monthly">Monthly</label>
    </div>
    <section class="plans">${cards}</section>
    <div class="stack">
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
    </div>
  </main>
  ${renderSiteFooter()}
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
  ${FONT_LINKS}
  <style>${PRICING_CSS}</style>
</head>
<body>
  ${renderSiteHeader()}
  <main data-testid="refund-policy">
    <div class="intro">
      <h1>Refund policy</h1>
    </div>
    <section class="panel">
      <p>${escapeHtml(body)}</p>
    </section>
  </main>
  ${renderSiteFooter()}
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

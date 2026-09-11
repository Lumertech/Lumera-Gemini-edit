import type { Express, Request, Response } from "express";
import { getDb } from "./db.ts";

/** Public Meta App Review document paths that must embed cms_policies in HTML. */
export const PUBLIC_POLICY_HTML_PATHS = [
  "/privacy-policy",
  "/terms-of-service",
  "/data-deletion-instructions",
] as const;

const PATH_TO_SLUG: Record<(typeof PUBLIC_POLICY_HTML_PATHS)[number], string> = {
  "/privacy-policy": "privacy-policy",
  "/terms-of-service": "terms-of-service",
  "/data-deletion-instructions": "data-deletion-instructions",
};

export function normalizePublicPath(pathname: string): string {
  return (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
}

export function isPublicPolicyHtmlPath(pathname: string): boolean {
  const clean = normalizePublicPath(pathname).toLowerCase();
  return (PUBLIC_POLICY_HTML_PATHS as readonly string[]).includes(clean);
}

export function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderPolicyDocumentHtml(title: string, body: string, updatedAt?: string): string {
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body);
  const revision = updatedAt
    ? `<p class="meta">Last updated: ${escapeHtml(updatedAt)}</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle} · Lumera</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; color: #0f172a; line-height: 1.5; }
    header { border-bottom: 1px solid #e2e8f0; padding-bottom: 1rem; margin-bottom: 1.5rem; }
    nav { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 0.75rem; }
    .notice { background: #f8fafc; border: 1px solid #cbd5e1; padding: 0.75rem 1rem; }
    article pre { white-space: pre-wrap; font-family: inherit; }
    .meta { color: #64748b; font-size: 0.875rem; }
  </style>
</head>
<body>
  <header>
    <p class="notice"><strong>Lumera Solutions LLP</strong> — clinic software. Lumera is not a certified Meta Tech Provider. Meta App Review is not submitted.</p>
    <nav>
      <a href="/" data-testid="policy-back">Back</a>
      <a href="/">Home</a>
      <a href="/privacy-policy">Privacy Policy</a>
      <a href="/terms-of-service">Terms of Service</a>
      <a href="/data-deletion-instructions">Data Deletion Instructions</a>
    </nav>
  </header>
  <main>
    <h1>${safeTitle}</h1>
    ${revision}
    <article><pre>${safeBody}</pre></article>
  </main>
</body>
</html>`;
}

function sendPolicyHtml(res: Response, slug: string): void {
  try {
    const row = getDb()
      .prepare("SELECT slug, title, body, updated_at FROM cms_policies WHERE slug = ?")
      .get(slug) as { slug: string; title: string; body: string; updated_at: string } | undefined;
    if (!row) {
      res
        .status(404)
        .type("html")
        .send(
          renderPolicyDocumentHtml(
            "Policy not found",
            "This policy document is not available. Lumera is not a certified Meta Tech Provider. Meta App Review is not submitted."
          )
        );
      return;
    }
    res.status(200).type("html").send(renderPolicyDocumentHtml(row.title, row.body, row.updated_at));
  } catch {
    res
      .status(503)
      .type("html")
      .send(
        renderPolicyDocumentHtml(
          "Policy temporarily unavailable",
          "Unable to load this policy. Lumera is not a certified Meta Tech Provider. Meta App Review is not submitted."
        )
      );
  }
}

/**
 * Serve crawlable HTML for Meta App Review policy URLs.
 * Must be registered before the Vite / SPA index.html fallback.
 */
export function attachPublicPolicyHtml(app: Express): void {
  for (const route of PUBLIC_POLICY_HTML_PATHS) {
    const slug = PATH_TO_SLUG[route];
    app.get(route, (_req: Request, res: Response) => {
      sendPolicyHtml(res, slug);
    });
  }
}

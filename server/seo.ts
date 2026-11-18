import type { Express, Request, Response } from "express";
import { escapeHtml } from "./policy-html.ts";
import { PRODUCT_DESCRIPTION, PRODUCT_DOCUMENT_TITLE, PRODUCT_LOGO_SRC, PRODUCT_NAME } from "../src/brand.ts";

export const CANONICAL_PUBLIC_ORIGIN = "https://www.mylumera.in";
export const GOOGLE_SITE_VERIFICATION_FILE = "google9d1aa2a0f4004272.html";
export const GOOGLE_SITE_VERIFICATION_META_TOKEN = "4Y9oWBvapgKnrtnwavx9AVncsss49PaqGudlD49AJUs";

export interface SitemapEntry {
  path: string;
  changefreq: "daily" | "weekly" | "monthly";
  priority: string;
  lastmod?: string;
}

export const PUBLIC_SITEMAP_ENTRIES: readonly SitemapEntry[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/pricing", changefreq: "weekly", priority: "0.9" },
  { path: "/signup", changefreq: "monthly", priority: "0.8" },
  { path: "/login", changefreq: "monthly", priority: "0.6" },
  { path: "/privacy-policy", changefreq: "monthly", priority: "0.5" },
  { path: "/terms-of-service", changefreq: "monthly", priority: "0.5" },
  { path: "/refund-policy", changefreq: "monthly", priority: "0.5" },
  { path: "/data-deletion-instructions", changefreq: "monthly", priority: "0.4" },
  { path: "/government-data-request-policy", changefreq: "monthly", priority: "0.4" },
] as const;

export function resolveSeoOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const configured = String(env.APP_URL || "").trim().replace(/\/+$/, "");
  if (/^https:\/\/(www\.)?mylumera\.in$/i.test(configured)) {
    return CANONICAL_PUBLIC_ORIGIN;
  }
  if (/^https:\/\//i.test(configured)) {
    return configured;
  }
  return CANONICAL_PUBLIC_ORIGIN;
}

export function renderRobotsTxt(origin = resolveSeoOrigin()): string {
  const cleanOrigin = origin.replace(/\/+$/, "");
  return [
    "User-agent: *",
    "Allow: /",
    "Allow: /pricing",
    "Allow: /refund-policy",
    "Allow: /signup",
    "Allow: /login",
    "Allow: /privacy-policy",
    "Allow: /terms-of-service",
    "Allow: /data-deletion-instructions",
    "Allow: /government-data-request-policy",
    "Disallow: /api/",
    "Disallow: /meta/",
    "Disallow: /v3/",
    "Disallow: /uploads/",
    "Disallow: /app",
    "Disallow: /admin",
    "Disallow: /portal",
    "Disallow: /onboarding",
    "Disallow: /w/",
    "Disallow: /dashboard",
    "Disallow: /studio",
    "Disallow: /clinic",
    "Disallow: /data-deletion-callback",
    "Disallow: /healthz",
    "",
    `Sitemap: ${cleanOrigin}/sitemap.xml`,
    "",
  ].join("\n");
}

export function renderSitemapXml(
  origin = resolveSeoOrigin(),
  lastmodDate = new Date().toISOString().slice(0, 10)
): string {
  const cleanOrigin = origin.replace(/\/+$/, "");
  const urls = PUBLIC_SITEMAP_ENTRIES.map((entry) => {
    const loc = entry.path === "/" ? `${cleanOrigin}/` : `${cleanOrigin}${entry.path}`;
    const lastmod = entry.lastmod || lastmodDate;
    return [
      "  <url>",
      `    <loc>${escapeHtml(loc)}</loc>`,
      `    <lastmod>${escapeHtml(lastmod)}</lastmod>`,
      `    <changefreq>${entry.changefreq}</changefreq>`,
      `    <priority>${entry.priority}</priority>`,
      "  </url>",
    ].join("\n");
  }).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
}

export function renderWebManifestJson(): string {
  return JSON.stringify(
    {
      name: PRODUCT_DOCUMENT_TITLE,
      short_name: PRODUCT_NAME,
      description: PRODUCT_DESCRIPTION,
      start_url: "/",
      display: "standalone",
      background_color: "#020617",
      theme_color: "#020617",
      lang: "en-IN",
      icons: [
        {
          src: PRODUCT_LOGO_SRC,
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any",
        },
      ],
    },
    null,
    2
  );
}

export function attachPublicSeoRoutes(app: Express): void {
  app.get("/robots.txt", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).type("text/plain; charset=utf-8").send(renderRobotsTxt());
  });

  app.get("/sitemap.xml", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).type("application/xml; charset=utf-8").send(renderSitemapXml());
  });

  app.get(`/${GOOGLE_SITE_VERIFICATION_FILE}`, (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res
      .status(200)
      .type("text/html; charset=utf-8")
      .send(`google-site-verification: ${GOOGLE_SITE_VERIFICATION_FILE}`);
  });

  app.get("/manifest.webmanifest", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).type("application/manifest+json; charset=utf-8").send(renderWebManifestJson());
  });
}


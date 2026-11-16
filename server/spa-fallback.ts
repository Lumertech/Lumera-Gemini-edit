import fs from "node:fs";
import path from "node:path";
import type { Express, NextFunction, Request, Response } from "express";
import express from "express";
import { applyHtmlDocumentSecurityHeaders, HTML_DOCUMENT_CACHE_CONTROL } from "./html-security-headers.ts";
import { isPublicPolicyHtmlPath, PUBLIC_POLICY_HTML_PATHS } from "./policy-html.ts";
import { isPricingHtmlPath } from "./pricing-html.ts";

/** Public paths that must 200 without login. Policy slugs are SSR HTML, not SPA shells. */
export const PUBLIC_SPA_PATHS = [
  "/",
  "/landing",
  "/login",
  "/signup",
  "/register",
  ...PUBLIC_POLICY_HTML_PATHS,
  "/app",
  "/admin",
  "/dashboard",
] as const;

/** Policy, pricing, and refund documents are server HTML, not the SPA shell. */
export function isDedicatedPublicHtmlPath(pathname: string): boolean {
  return isPublicPolicyHtmlPath(pathname) || isPricingHtmlPath(pathname);
}

export function isBackendPath(pathname: string): boolean {
  const p = (pathname.split("?")[0] || "/").toLowerCase();
  return (
    p === "/healthz" ||
    p.startsWith("/api/") ||
    p === "/api" ||
    p.startsWith("/uploads/") ||
    p === "/uploads" ||
    p.startsWith("/meta/") ||
    p === "/meta" ||
    p === "/data-deletion-callback" ||
    p.startsWith("/v3/") ||
    p === "/v3"
  );
}

/**
 * History-API fallback: HTML routes without a file extension.
 * Missing hashed assets (`.js` / `.css`) must 404, not return index.html.
 */
export function isSpaHistoryFallbackPath(pathname: string): boolean {
  if (isBackendPath(pathname)) return false;
  if (isDedicatedPublicHtmlPath(pathname)) return false;
  const clean = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  const last = clean.split("/").pop() || "";
  if (last.includes(".")) return false;
  return true;
}

/** SPA shells and public policy documents — the responses that need CSP. */
export function isHtmlDocumentPath(pathname: string): boolean {
  if (isDedicatedPublicHtmlPath(pathname)) return true;
  return isSpaHistoryFallbackPath(pathname);
}

/**
 * Cloud Run may start with cwd at the app root (`dist/index.html`)
 * or already inside `dist/` (`./index.html`). Prefer a directory that actually
 * contains the Vite client build.
 */
export function resolveClientDist(cwd = process.cwd()): string {
  const candidates = [path.join(cwd, "dist"), cwd];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return path.join(cwd, "dist");
}

/**
 * Prospect advert bytes in `public/media` (copied into `dist/media` by Vite).
 * A day of shared caching. `send` still answers Range with 206 so seeking works.
 * HTML shells keep the private no-cache policy below.
 */
export const PROSPECT_MEDIA_CACHE_CONTROL = "public, max-age=86400";

export function isProspectMediaAsset(filePath: string): boolean {
  const base = path.basename(filePath);
  return /^lumera-prospect-.+\.mp4$/i.test(base) || /^lumera-poster-.+\.jpe?g$/i.test(base);
}

export function attachProductionSpaFallback(
  app: Express,
  distPath = resolveClientDist(),
  env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" }
): void {
  const indexFile = path.join(distPath, "index.html");
  app.use(
    express.static(distPath, {
      index: false,
      fallthrough: true,
      acceptRanges: true,
      setHeaders(res, filePath) {
        if (filePath.endsWith(`${path.sep}index.html`) || filePath.endsWith("/index.html")) {
          res.setHeader("Cache-Control", HTML_DOCUMENT_CACHE_CONTROL);
          return;
        }
        if (!isProspectMediaAsset(filePath)) return;
        res.setHeader("Cache-Control", PROSPECT_MEDIA_CACHE_CONTROL);
        res.setHeader("Accept-Ranges", "bytes");
        if (filePath.toLowerCase().endsWith(".mp4")) {
          res.setHeader("Content-Type", "video/mp4");
        } else if (/\.jpe?g$/i.test(filePath)) {
          res.setHeader("Content-Type", "image/jpeg");
        }
      },
    })
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!isSpaHistoryFallbackPath(req.path)) return next();
    if (!fs.existsSync(indexFile)) {
      return res.status(500).send("Client build missing (dist/index.html). Run npm run build.");
    }
    applyHtmlDocumentSecurityHeaders(res, env);
    res.sendFile(indexFile);
  });
  attachUnknownApiJsonNotFound(app);
}

/** Unknown /api paths stay JSON. They must not fall through to index.html. */
export function attachUnknownApiJsonNotFound(app: Express): void {
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).type("application/json").send(JSON.stringify({ error: "Not found" }));
  });
}

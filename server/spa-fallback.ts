import fs from "node:fs";
import path from "node:path";
import type { Express, NextFunction, Request, Response } from "express";
import express from "express";

/** Public Meta App Review SPA routes that must 200 without login. */
export const PUBLIC_SPA_PATHS = [
  "/",
  "/privacy-policy",
  "/terms-of-service",
  "/data-deletion-instructions",
] as const;

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
  const clean = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  const last = clean.split("/").pop() || "";
  if (last.includes(".")) return false;
  return true;
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

export function attachProductionSpaFallback(app: Express, distPath = resolveClientDist()): void {
  const indexFile = path.join(distPath, "index.html");
  app.use(express.static(distPath, { index: false, fallthrough: true }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!isSpaHistoryFallbackPath(req.path)) return next();
    if (!fs.existsSync(indexFile)) {
      return res.status(500).send("Client build missing (dist/index.html). Run npm run build.");
    }
    res.sendFile(indexFile);
  });
}

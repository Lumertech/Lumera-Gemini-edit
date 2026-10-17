/**
 * CSP and related headers for SPA / policy HTML documents.
 *
 * script-src stays free of 'unsafe-inline' so an XSS payload cannot inject a
 * script that reads lumera_session_token. style-src allows 'unsafe-inline'
 * because the React shell uses style attributes. frame-ancestors defaults to
 * 'none' so the app is not framed. Set FRAME_ANCESTORS to a space-separated
 * allowlist (for example Google AI Studio) when a specific embed is required.
 * A bare `*` is dropped. Meta Embedded Signup loads
 * https://connect.facebook.net/en_US/sdk.js and opens facebook.com frames
 * (frame-src, not frame-ancestors). 'unsafe-eval' stays because the Facebook
 * JS SDK still uses eval/new Function; injected <script> tags remain blocked.
 */
import type { Response } from "express";

/** True for a CSP source that would allow any origin to frame the app. */
function isOpenFrameSource(token: string): boolean {
  const t = token.trim();
  if (t === "*" || t === "'*'") return true;
  return /^https?:\/\/\*$/i.test(t);
}

/**
 * CSP frame-ancestors source list. Unset, blank, or 'none' stays 'none'
 * (including in production). Bare `*` tokens are ignored.
 */
export function frameAncestorsValue(env: NodeJS.ProcessEnv = process.env): string {
  const raw = String(env.FRAME_ANCESTORS ?? "").trim();
  if (!raw || /^'none'$|^none$/i.test(raw)) return "'none'";
  const tokens = raw.split(/\s+/).filter((token) => token && !isOpenFrameSource(token));
  if (tokens.length === 0) return "'none'";
  return tokens.join(" ");
}

export function frameAncestorsAreNone(value: string): boolean {
  return value === "'none'" || value.toLowerCase() === "none";
}

export function htmlContentSecurityPolicy(env: NodeJS.ProcessEnv = process.env): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `frame-ancestors ${frameAncestorsValue(env)}`,
    "form-action 'self'",
    "script-src 'self' 'unsafe-eval' https://connect.facebook.net https://*.facebook.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "connect-src 'self' https://connect.facebook.net https://*.facebook.net https://graph.facebook.com https://www.facebook.com https://web.facebook.com https://*.facebook.com https://*.fbcdn.net",
    "frame-src 'self' https://www.facebook.com https://web.facebook.com https://*.facebook.com https://*.fbcdn.net",
    "worker-src 'self' blob:",
  ].join("; ");
}

/** Default policy: FRAME_ANCESTORS unset → frame-ancestors 'none'. */
export const HTML_CONTENT_SECURITY_POLICY = htmlContentSecurityPolicy({} as NodeJS.ProcessEnv);

/** Same-origin camera for patient document photos. Ambient scribe needs same-origin microphone. */
export const HTML_PERMISSIONS_POLICY = "camera=(self), geolocation=(), microphone=(self), payment=()";

/**
 * HTML shells must revalidate. There is no service worker; a cached index.html
 * is how a phone keeps running the previous bundle after a deploy.
 * `private` keeps the logged-in shell out of shared caches.
 */
export const HTML_DOCUMENT_CACHE_CONTROL = "private, no-cache";

function isProductionFromEnv(env: NodeJS.ProcessEnv): boolean {
  return String(env.NODE_ENV || "") === "production";
}

export function applyHtmlDocumentSecurityHeaders(res: Response, env: NodeJS.ProcessEnv = process.env): void {
  const ancestors = frameAncestorsValue(env);
  res.setHeader("Content-Security-Policy", htmlContentSecurityPolicy(env));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (frameAncestorsAreNone(ancestors)) {
    res.setHeader("X-Frame-Options", "DENY");
  }
  res.setHeader("Permissions-Policy", HTML_PERMISSIONS_POLICY);
  res.setHeader("Cache-Control", HTML_DOCUMENT_CACHE_CONTROL);
  if (isProductionFromEnv(env)) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
}

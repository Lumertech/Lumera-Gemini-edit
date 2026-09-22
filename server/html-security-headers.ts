/**
 * CSP and related headers for SPA / policy HTML documents.
 *
 * script-src stays free of 'unsafe-inline' so an XSS payload cannot inject a
 * script that reads lumera_session_token. style-src allows 'unsafe-inline'
 * because the React shell uses style attributes. Meta Embedded Signup loads
 * https://connect.facebook.net/en_US/sdk.js and opens facebook.com frames;
 * those hosts are allowlisted. 'unsafe-eval' is included because the Facebook
 * JS SDK still uses eval/new Function; injected <script> tags remain blocked.
 */
import type { Response } from "express";

export const HTML_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
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

function isProductionFromEnv(env: NodeJS.ProcessEnv): boolean {
  return String(env.NODE_ENV || "") === "production";
}

export function applyHtmlDocumentSecurityHeaders(res: Response, env: NodeJS.ProcessEnv = process.env): void {
  res.setHeader("Content-Security-Policy", HTML_CONTENT_SECURITY_POLICY);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (isProductionFromEnv(env)) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
}

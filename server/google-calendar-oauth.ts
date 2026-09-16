import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "./auth.ts";
import { appPublicUrl, readSecret } from "./runtime.ts";
import {
  GoogleOAuthError,
  googleClientId,
  googleClientSecret,
  googleOAuthConfigured,
} from "./google-oauth.ts";

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

function oauthStateSecret(): string {
  const dedicated = readSecret("GOOGLE_OAUTH_STATE_SECRET");
  if (dedicated) return dedicated;
  return getJwtSecret();
}

export function googleCalendarRedirectUri(reqHost?: string, reqProto?: string): string {
  const explicit = String(
    process.env.GOOGLE_CALENDAR_REDIRECT_URI || process.env.GOOGLE_CALENDAR_CALLBACK_URL || ""
  ).trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return `${appPublicUrl(reqHost, reqProto)}/api/tenant/doctor/google-calendar/callback`;
}

export function signGoogleCalendarOAuthState(payload: {
  doctorId: string;
  userId: string;
  tenantId: string;
}): string {
  return jwt.sign(
    {
      purpose: "google_calendar_oauth",
      doctorId: payload.doctorId,
      userId: payload.userId,
      tenantId: payload.tenantId,
      n: crypto.randomUUID(),
    },
    oauthStateSecret(),
    { expiresIn: "15m" }
  );
}

export function verifyGoogleCalendarOAuthState(state: string): {
  doctorId: string;
  userId: string;
  tenantId: string;
} {
  try {
    const decoded = jwt.verify(state, oauthStateSecret());
    if (!decoded || typeof decoded !== "object") throw new Error("invalid");
    const rec = decoded as { purpose?: string; doctorId?: string; userId?: string; tenantId?: string };
    if (rec.purpose !== "google_calendar_oauth") throw new Error("wrong purpose");
    const doctorId = String(rec.doctorId || "").trim();
    const userId = String(rec.userId || "").trim();
    const tenantId = String(rec.tenantId || "").trim();
    if (!doctorId || !userId || !tenantId) throw new Error("incomplete");
    return { doctorId, userId, tenantId };
  } catch {
    throw new GoogleOAuthError("Google Calendar OAuth state is invalid or expired.", 401);
  }
}

export function googleCalendarDialogUrl(opts: { redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    state: opts.state,
    prompt: "consent",
    access_type: "offline",
    include_granted_scopes: "true",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function googleJson(url: string, init: RequestInit | undefined, fetchImpl: typeof fetch): Promise<any> {
  const res = await fetchImpl(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    const message =
      data?.error_description ||
      (typeof data?.error === "string" ? data.error : data?.error?.message) ||
      `Google Calendar request failed (HTTP ${res.status}).`;
    throw new GoogleOAuthError(message, res.status >= 400 && res.status < 600 ? res.status : 401);
  }
  return data;
}

export async function exchangeGoogleCalendarAuthorizationCode(opts: {
  code: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; email?: string }> {
  const clientId = googleClientId();
  const clientSecret = googleClientSecret();
  if (!clientId || !clientSecret || !googleOAuthConfigured()) {
    throw new GoogleOAuthError("Google Calendar is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).", 503);
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: opts.redirectUri,
    code: opts.code,
    grant_type: "authorization_code",
  });
  const data = await googleJson(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    opts.fetchImpl || fetch
  );
  const accessToken = String(data?.access_token || "").trim();
  if (!accessToken) {
    throw new GoogleOAuthError("Google Calendar authorization did not return an access token.");
  }
  return {
    accessToken,
    refreshToken: String(data?.refresh_token || "").trim(),
    expiresIn: Number(data?.expires_in || 3600),
    email: data?.email ? String(data.email) : undefined,
  };
}

export async function refreshGoogleCalendarAccessToken(opts: {
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const clientId = googleClientId();
  const clientSecret = googleClientSecret();
  if (!clientId || !clientSecret) {
    throw new GoogleOAuthError("Google Calendar is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).", 503);
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: opts.refreshToken,
    grant_type: "refresh_token",
  });
  const data = await googleJson(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    opts.fetchImpl || fetch
  );
  const accessToken = String(data?.access_token || "").trim();
  if (!accessToken) {
    throw new GoogleOAuthError("Google Calendar refresh did not return an access token.");
  }
  return { accessToken, expiresIn: Number(data?.expires_in || 3600) };
}

export async function fetchGoogleCalendarUserEmail(opts: {
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const data = await googleJson(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    { headers: { Authorization: `Bearer ${opts.accessToken}` } },
    opts.fetchImpl || fetch
  );
  return String(data?.email || "").trim().toLowerCase();
}

export { googleOAuthConfigured as googleCalendarOAuthConfigured, GoogleOAuthError };

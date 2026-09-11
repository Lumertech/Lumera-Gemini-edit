import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "./auth.ts";
import { appPublicUrl, readSecret } from "./runtime.ts";

/** Fail-closed: dedicated state secret if set, otherwise JWT_SECRET (no hardcoded fallback). */
function oauthStateSecret(): string {
  const dedicated = readSecret("GOOGLE_OAUTH_STATE_SECRET");
  if (dedicated) return dedicated;
  return getJwtSecret();
}

export function googleClientId(): string {
  return readSecret("GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID");
}

export function googleClientSecret(): string {
  return readSecret("GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET");
}

export function googleOAuthConfigured(): boolean {
  return Boolean(googleClientId() && googleClientSecret());
}

/**
 * Exact redirect URI the authorization-code exchange sends to Google.
 * Must match a Google Cloud Console Authorized redirect URI character-for-character.
 * Default: `{APP_URL}/api/auth/google/callback` (production APP_URL=https://www.mylumera.in).
 */
export function googleRedirectUri(reqHost?: string, reqProto?: string): string {
  const explicit = String(process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_CALLBACK_URL || "").trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return `${appPublicUrl(reqHost, reqProto)}/api/auth/google/callback`;
}

export function signGoogleOAuthState(): string {
  return jwt.sign({ purpose: "google_oauth", n: crypto.randomUUID() }, oauthStateSecret(), { expiresIn: "10m" });
}

export function verifyGoogleOAuthState(state: string): boolean {
  try {
    const decoded = jwt.verify(state, oauthStateSecret());
    return Boolean(
      decoded && typeof decoded === "object" && (decoded as { purpose?: string }).purpose === "google_oauth"
    );
  } catch {
    return false;
  }
}

export function googleLoginDialogUrl(opts: { redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: opts.state,
    prompt: "select_account",
    access_type: "online",
    include_granted_scopes: "true",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export type GoogleProfile = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
  emailVerified: boolean;
};

export class GoogleOAuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "GoogleOAuthError";
    this.status = status;
  }
}

async function googleJson(url: string, init: RequestInit | undefined, fetchImpl: typeof fetch): Promise<any> {
  const res = await fetchImpl(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    const message =
      data?.error_description ||
      (typeof data?.error === "string" ? data.error : data?.error?.message) ||
      `Google OAuth request failed (HTTP ${res.status}).`;
    throw new GoogleOAuthError(message, 401);
  }
  return data;
}

export async function exchangeGoogleAuthorizationCode(opts: {
  code: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string; idToken?: string }> {
  const clientId = googleClientId();
  const clientSecret = googleClientSecret();
  if (!clientId || !clientSecret) {
    throw new GoogleOAuthError("Google Sign-in is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).", 503);
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
    throw new GoogleOAuthError("Google authorization code exchange did not return an access token.");
  }
  return {
    accessToken,
    idToken: data?.id_token ? String(data.id_token) : undefined,
  };
}

/** Best-effort ID token aud/iss check. Userinfo remains the identity source of truth. */
export function assertGoogleIdTokenAudience(idToken: string | undefined, expectedClientId = googleClientId()): void {
  if (!idToken) return;
  const parts = idToken.split(".");
  if (parts.length < 2) return;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      aud?: string;
      iss?: string;
    };
    const aud = String(payload?.aud || "");
    const iss = String(payload?.iss || "");
    if (expectedClientId && aud && aud !== expectedClientId) {
      throw new GoogleOAuthError("Google ID token audience does not match GOOGLE_CLIENT_ID.");
    }
    if (iss && iss !== "https://accounts.google.com" && iss !== "accounts.google.com") {
      throw new GoogleOAuthError("Google ID token issuer is invalid.");
    }
  } catch (err) {
    if (err instanceof GoogleOAuthError) throw err;
  }
}

export async function fetchGoogleUserInfo(opts: {
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleProfile> {
  const data = await googleJson(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    { headers: { Authorization: `Bearer ${opts.accessToken}` } },
    opts.fetchImpl || fetch
  );
  const email = String(data?.email || "").trim().toLowerCase();
  if (!email) {
    throw new GoogleOAuthError("Google did not return an email. Grant the email scope and retry Google Sign-in.");
  }
  const emailVerified = data?.email_verified === true || data?.email_verified === "true";
  if (!emailVerified) {
    throw new GoogleOAuthError("Google email is not verified. Use a verified Google account.");
  }
  return {
    id: String(data?.sub || data?.id || ""),
    email,
    name: String(data?.name || email.split("@")[0]),
    avatarUrl: String(data?.picture || ""),
    emailVerified,
  };
}

export async function verifyGoogleIdentity(opts: {
  code?: string;
  accessToken?: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleProfile> {
  if (!googleOAuthConfigured()) {
    throw new GoogleOAuthError("Google Sign-in is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).", 503);
  }

  let token = String(opts.accessToken || "").trim();
  let idToken: string | undefined;
  if (!token && opts.code) {
    const exchanged = await exchangeGoogleAuthorizationCode({
      code: opts.code,
      redirectUri: opts.redirectUri,
      fetchImpl: opts.fetchImpl,
    });
    token = exchanged.accessToken;
    idToken = exchanged.idToken;
  }
  if (!token) {
    throw new GoogleOAuthError("Google authorization code or access token is required.");
  }

  assertGoogleIdTokenAudience(idToken);
  return fetchGoogleUserInfo({ accessToken: token, fetchImpl: opts.fetchImpl });
}

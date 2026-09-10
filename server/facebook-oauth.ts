import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "./auth.ts";
import { appPublicUrl, graphApiVersion, isProduction, readSecret } from "./runtime.ts";

/** Fail-closed: dedicated state secret if set, otherwise JWT_SECRET (no hardcoded fallback). */
function oauthStateSecret(): string {
  const dedicated = readSecret("FACEBOOK_OAUTH_STATE_SECRET");
  if (dedicated) return dedicated;
  return getJwtSecret();
}

export function facebookAppId(): string {
  return readSecret("FACEBOOK_APP_ID", "META_APP_ID");
}

export function facebookAppSecret(): string {
  return readSecret("FACEBOOK_APP_SECRET", "META_APP_SECRET");
}

export function facebookOAuthConfigured(): boolean {
  return Boolean(facebookAppId() && facebookAppSecret());
}

export function facebookRedirectUri(reqHost?: string, reqProto?: string): string {
  const explicit = String(process.env.FACEBOOK_REDIRECT_URI || process.env.FACEBOOK_CALLBACK_URL || "").trim();
  if (explicit) return explicit;
  return `${appPublicUrl(reqHost, reqProto)}/api/auth/facebook/callback`;
}

export function signFacebookOAuthState(): string {
  return jwt.sign({ purpose: "facebook_oauth", n: crypto.randomUUID() }, oauthStateSecret(), { expiresIn: "10m" });
}

export function verifyFacebookOAuthState(state: string): boolean {
  try {
    const decoded = jwt.verify(state, oauthStateSecret());
    return Boolean(decoded && typeof decoded === "object" && (decoded as { purpose?: string }).purpose === "facebook_oauth");
  } catch {
    return false;
  }
}

export function facebookLoginDialogUrl(opts: { redirectUri: string; state: string }): string {
  const version = graphApiVersion();
  const params = new URLSearchParams({
    client_id: facebookAppId(),
    redirect_uri: opts.redirectUri,
    state: opts.state,
    scope: "email,public_profile",
    response_type: "code",
  });
  return `https://www.facebook.com/${version}/dialog/oauth?${params.toString()}`;
}

export type FacebookProfile = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
};

export class FacebookOAuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "FacebookOAuthError";
    this.status = status;
  }
}

async function graphJson(url: string, fetchImpl: typeof fetch): Promise<any> {
  const res = await fetchImpl(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    const message = data?.error?.message || `Facebook Graph request failed (HTTP ${res.status}).`;
    throw new FacebookOAuthError(message, 401);
  }
  return data;
}

export async function exchangeFacebookAuthorizationCode(opts: {
  code: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const appId = facebookAppId();
  const appSecret = facebookAppSecret();
  if (!appId || !appSecret) {
    throw new FacebookOAuthError("Facebook Login is not configured (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET).", 503);
  }
  const version = graphApiVersion();
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: opts.redirectUri,
    code: opts.code,
  });
  const data = await graphJson(
    `https://graph.facebook.com/${version}/oauth/access_token?${params.toString()}`,
    opts.fetchImpl || fetch
  );
  const token = String(data?.access_token || "").trim();
  if (!token) {
    throw new FacebookOAuthError("Facebook authorization code exchange did not return an access token.");
  }
  return token;
}

export async function inspectFacebookAccessToken(opts: {
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<{ appId: string; isValid: boolean; userId?: string }> {
  const appId = facebookAppId();
  const appSecret = facebookAppSecret();
  if (!appId || !appSecret) {
    throw new FacebookOAuthError("Facebook Login is not configured (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET).", 503);
  }
  const appToken = `${appId}|${appSecret}`;
  const params = new URLSearchParams({
    input_token: opts.accessToken,
    access_token: appToken,
  });
  const data = await graphJson(`https://graph.facebook.com/debug_token?${params.toString()}`, opts.fetchImpl || fetch);
  const payload = data?.data || {};
  return {
    appId: String(payload.app_id || ""),
    isValid: Boolean(payload.is_valid),
    userId: payload.user_id ? String(payload.user_id) : undefined,
  };
}

export async function fetchFacebookMe(opts: { accessToken: string; fetchImpl?: typeof fetch }): Promise<FacebookProfile> {
  const version = graphApiVersion();
  const params = new URLSearchParams({
    fields: "id,name,email,picture.type(large)",
    access_token: opts.accessToken,
  });
  const data = await graphJson(`https://graph.facebook.com/${version}/me?${params.toString()}`, opts.fetchImpl || fetch);
  const email = String(data?.email || "").trim().toLowerCase();
  if (!email) {
    throw new FacebookOAuthError(
      "Facebook did not return a verified email. Grant the email permission and retry Facebook Login."
    );
  }
  return {
    id: String(data?.id || ""),
    email,
    name: String(data?.name || email.split("@")[0]),
    avatarUrl: String(data?.picture?.data?.url || ""),
  };
}

/**
 * Verifies Facebook identity via authorization code or user access token.
 * Uses app secret for code exchange and debug_token app-id matching.
 */
export async function verifyFacebookIdentity(opts: {
  code?: string;
  accessToken?: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<FacebookProfile> {
  if (!facebookOAuthConfigured()) {
    throw new FacebookOAuthError("Facebook Login is not configured (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET).", 503);
  }

  let token = String(opts.accessToken || "").trim();
  if (!token && opts.code) {
    token = await exchangeFacebookAuthorizationCode({
      code: opts.code,
      redirectUri: opts.redirectUri,
      fetchImpl: opts.fetchImpl,
    });
  }
  if (!token) {
    throw new FacebookOAuthError("Facebook authorization code or access token is required.");
  }

  const inspection = await inspectFacebookAccessToken({ accessToken: token, fetchImpl: opts.fetchImpl });
  if (!inspection.isValid || inspection.appId !== facebookAppId()) {
    throw new FacebookOAuthError("Facebook access token is invalid for this app.");
  }

  const profile = await fetchFacebookMe({ accessToken: token, fetchImpl: opts.fetchImpl });
  if (inspection.userId && profile.id && inspection.userId !== profile.id) {
    throw new FacebookOAuthError("Facebook token subject does not match /me id.");
  }
  return profile;
}

export type FederatedIdentity = {
  provider: string;
  email: string;
  name: string;
  avatarUrl: string;
  facebookId?: string;
  sandbox?: boolean;
};

/**
 * Production: Facebook requires Graph-verified identity; client-supplied email is rejected.
 * Non-prod: SANDBOX / DEV-ONLY client email is allowed when no Facebook token is presented.
 */
export async function resolveFederatedIdentity(opts: {
  provider: string;
  code?: string;
  accessToken?: string;
  redirectUri: string;
  clientEmail?: string;
  clientName?: string;
  clientAvatarUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<FederatedIdentity> {
  const provider = opts.provider || "google";

  if (provider === "facebook") {
    const hasToken = Boolean(opts.code || opts.accessToken);
    if (hasToken || isProduction()) {
      const profile = await verifyFacebookIdentity({
        code: opts.code,
        accessToken: opts.accessToken,
        redirectUri: opts.redirectUri,
        fetchImpl: opts.fetchImpl,
      });
      return {
        provider: "facebook",
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        facebookId: profile.id,
      };
    }

    const email = String(opts.clientEmail || "").trim().toLowerCase();
    if (!email) {
      throw new FacebookOAuthError("SANDBOX Facebook login requires an email or a Facebook token.", 400);
    }
    return {
      provider: "facebook",
      email,
      name: String(opts.clientName || email.split("@")[0]),
      avatarUrl: String(opts.clientAvatarUrl || ""),
      sandbox: true,
    };
  }

  if (isProduction()) {
    throw new FacebookOAuthError(
      `Client-trusted ${provider} email OAuth is disabled in production. Use Facebook Login with server-side token exchange.`,
      403
    );
  }

  const email = String(opts.clientEmail || "").trim().toLowerCase();
  if (!email) {
    throw new FacebookOAuthError("Valid email required for SANDBOX / DEV-ONLY OAuth.", 400);
  }
  return {
    provider,
    email,
    name: String(opts.clientName || email.split("@")[0]),
    avatarUrl: String(opts.clientAvatarUrl || ""),
    sandbox: true,
  };
}

export function oauthPublicConfig() {
  return {
    facebookConfigured: facebookOAuthConfigured(),
    facebookAppId: facebookAppId() || null,
    facebookRedirectUri: facebookOAuthConfigured() ? facebookRedirectUri() : null,
    sandboxClientOAuthAllowed: !isProduction(),
    notice: isProduction()
      ? "Production requires Facebook Login server-side token exchange. Client-supplied emails are rejected. Missing FACEBOOK_APP_ID/SECRET is a hard configuration error."
      : "SANDBOX / DEV-ONLY: Facebook App credentials are optional. Client-supplied OAuth email is accepted only when NODE_ENV is not production.",
  };
}

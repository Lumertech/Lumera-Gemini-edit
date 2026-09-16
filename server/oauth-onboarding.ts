import jwt from "jsonwebtoken";
import { getJwtSecret } from "./auth.ts";

export type OauthOnboardingProvider = "google" | "facebook";

export type OauthOnboardingIdentity = {
  purpose: "oauth_onboarding";
  provider: OauthOnboardingProvider;
  email: string;
  name: string;
  avatarUrl?: string;
};

/** Short-lived proof that Graph/Google already verified this email + name. */
export function signOauthOnboardingToken(identity: {
  provider: OauthOnboardingProvider;
  email: string;
  name: string;
  avatarUrl?: string;
}): string {
  const email = String(identity.email || "").trim().toLowerCase();
  const name = String(identity.name || "").trim();
  const payload: OauthOnboardingIdentity = {
    purpose: "oauth_onboarding",
    provider: identity.provider,
    email,
    name,
    avatarUrl: String(identity.avatarUrl || ""),
  };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "30m" });
}

export function parseOauthOnboardingToken(token: string): OauthOnboardingIdentity | null {
  try {
    const decoded = jwt.verify(String(token || "").trim(), getJwtSecret());
    if (!decoded || typeof decoded !== "object") return null;
    const d = decoded as OauthOnboardingIdentity;
    if (d.purpose !== "oauth_onboarding") return null;
    if (d.provider !== "google" && d.provider !== "facebook") return null;
    const email = String(d.email || "").trim().toLowerCase();
    const name = String(d.name || "").trim();
    if (!email || !name) return null;
    return {
      purpose: "oauth_onboarding",
      provider: d.provider,
      email,
      name,
      avatarUrl: String(d.avatarUrl || ""),
    };
  } catch {
    return null;
  }
}

export function unregisteredOauthLoginPath(identity: {
  provider: OauthOnboardingProvider;
  email: string;
  name: string;
  avatarUrl?: string;
}): string {
  const params = new URLSearchParams({
    oauth: identity.provider,
    unregistered: "1",
    email: String(identity.email || "").trim().toLowerCase(),
    name: String(identity.name || "").trim(),
    oauthToken: signOauthOnboardingToken(identity),
  });
  return `/login?${params.toString()}`;
}

export const OAUTH_ONBOARDING_COOKIE = "lumera_oauth_onboard";

export function unregisteredOauthRedirectTarget(identity: {
  provider: OauthOnboardingProvider;
  email: string;
  name: string;
  avatarUrl?: string;
}): { path: string; cookie: string } {
  const path = unregisteredOauthLoginPath(identity);
  const token = new URL(path, "https://www.mylumera.in").searchParams.get("oauthToken") || "";
  return { path, cookie: token ? oauthOnboardingSetCookieHeader(token) : "" };
}

export type OauthOnboardingRead =
  | { present: false }
  | { present: true; ok: false; error: string }
  | { present: true; ok: true; identity: OauthOnboardingIdentity };

export function oauthOnboardingSetCookieHeader(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${OAUTH_ONBOARDING_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=1800${secure}`;
}

function tokenFromCookieHeader(header?: string): string {
  if (!header) return "";
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key !== OAUTH_ONBOARDING_COOKIE) continue;
    const val = part.slice(idx + 1).trim();
    try {
      return decodeURIComponent(val);
    } catch {
      return val;
    }
  }
  return "";
}

/** Prefer body `oauthToken` from the create-clinic form; cookie is a fallback. */
export function readOauthOnboardingFromRequest(req: {
  body?: { oauthToken?: unknown; oauth_token?: unknown };
  cookies?: { lumera_oauth_onboard?: unknown };
  headers?: { cookie?: unknown };
}): OauthOnboardingRead {
  const token = String(
    req.body?.oauthToken ||
      req.body?.oauth_token ||
      req.cookies?.lumera_oauth_onboard ||
      tokenFromCookieHeader(typeof req.headers?.cookie === "string" ? req.headers.cookie : "") ||
      ""
  ).trim();
  if (!token) return { present: false };
  const identity = parseOauthOnboardingToken(token);
  if (!identity) {
    return {
      present: true,
      ok: false,
      error: "Facebook/Google identity expired. Sign in with Facebook or Google again.",
    };
  }
  return { present: true, ok: true, identity };
}

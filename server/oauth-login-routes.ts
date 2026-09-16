import { Router, type Request, type Response } from "express";
import { issueLumeraSession } from "./auth.ts";
import { getDb, writeAudit, type DbUser } from "./db.ts";
import {
  FacebookOAuthError,
  facebookLoginDialogUrl,
  facebookOAuthConfigured,
  facebookRedirectUri,
  parseFacebookOAuthState,
  resolveFederatedIdentity,
  signFacebookOAuthState,
} from "./facebook-oauth.ts";
import {
  GoogleOAuthError,
  googleLoginDialogUrl,
  googleOAuthConfigured,
  googleRedirectUri,
  signGoogleOAuthState,
  verifyGoogleOAuthState,
} from "./google-oauth.ts";
import { unregisteredOauthRedirectTarget } from "./oauth-onboarding.ts";
import { clinicTenantAccessError } from "./platform-tenants.ts";
import { appPublicUrl, isProduction } from "./runtime.ts";

function redirectUnregisteredOauth(
  res: Response,
  appUrl: string,
  identity: { provider: "google" | "facebook"; email: string; name: string; avatarUrl?: string }
) {
  const { path, cookie } = unregisteredOauthRedirectTarget(identity);
  if (cookie) res.setHeader("Set-Cookie", cookie);
  return res.redirect(`${appUrl}${path}`);
}

function finishOauthSession(
  res: Response,
  user: DbUser,
  identity: { email: string; avatarUrl?: string; provider: string }
) {
  issueLumeraSession(res, user);
  getDb()
    .prepare("UPDATE users SET last_login = ?, whatsapp_verified = 1, avatar_url = COALESCE(NULLIF(?, ''), avatar_url) WHERE id = ?")
    .run(new Date().toISOString(), identity.avatarUrl || "", user.id);
  const via = identity.provider === "google" ? "google (Google-verified)" : "facebook (Graph-verified)";
  writeAudit(getDb(), user.id, user.name, "OAuth Sign In", `${user.email} signed in via ${via}`);
}

export function attachOauthLoginRoutes(api: Router) {
  api.get("/auth/facebook", (req: Request, res: Response) => {
    if (!facebookOAuthConfigured()) {
      if (isProduction()) {
        return res.status(503).json({
          error:
            "Facebook Login is not configured (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET, or FACEBOOK_CLIENT_ID / FACEBOOK_CLIENT_SECRET).",
        });
      }
      return res.redirect("/login?oauth=facebook&error=not_configured");
    }
    const host = req.get("host") || undefined;
    const proto = req.get("x-forwarded-proto") || req.protocol;
    const redirectUri = facebookRedirectUri(host, proto);
    const state = signFacebookOAuthState(redirectUri);
    return res.redirect(facebookLoginDialogUrl({ redirectUri, state }));
  });

  api.get("/auth/google", (req: Request, res: Response) => {
    if (!googleOAuthConfigured()) {
      if (isProduction()) {
        return res.status(503).json({ error: "Google Sign-in is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)." });
      }
      return res.redirect("/login?oauth=google&error=not_configured");
    }
    const host = req.get("host") || undefined;
    const proto = req.get("x-forwarded-proto") || req.protocol;
    const redirectUri = googleRedirectUri(host, proto);
    const state = signGoogleOAuthState();
    return res.redirect(googleLoginDialogUrl({ redirectUri, state }));
  });

  api.get("/auth/google/callback", async (req: Request, res: Response) => {
    const host = req.get("host") || undefined;
    const proto = req.get("x-forwarded-proto") || req.protocol;
    const appUrl = appPublicUrl(host, proto);
    const fail = (reason: string) => res.redirect(`${appUrl}/login?oauth=google&error=${encodeURIComponent(reason)}`);

    const errorParam = String(req.query.error || "").trim();
    if (errorParam) return fail(errorParam);

    const code = String(req.query.code || "").trim();
    const state = String(req.query.state || "").trim();
    if (!code) return fail("missing_code");
    if (!verifyGoogleOAuthState(state)) return fail("invalid_state");

    try {
      const identity = await resolveFederatedIdentity({
        provider: "google",
        code,
        redirectUri: googleRedirectUri(host, proto),
      });
      const user = getDb().prepare("SELECT * FROM users WHERE email = ?").get(identity.email) as unknown as DbUser | undefined;
      if (!user) {
        return redirectUnregisteredOauth(res, appUrl, {
          provider: "google",
          email: identity.email,
          name: identity.name,
          avatarUrl: identity.avatarUrl,
        });
      }
      if (user.status === "disabled") return fail("account_disabled");
      const tenantBlocked = clinicTenantAccessError(user);
      if (tenantBlocked) return fail("tenant_suspended");
      finishOauthSession(res, user, { email: user.email, avatarUrl: identity.avatarUrl, provider: "google" });
      return res.redirect(`${appUrl}/login?oauth=google&status=ok`);
    } catch (err) {
      const message = err instanceof GoogleOAuthError || err instanceof FacebookOAuthError ? err.message : "google_oauth_failed";
      return fail(message);
    }
  });

  api.get("/auth/facebook/callback", async (req: Request, res: Response) => {
    const host = req.get("host") || undefined;
    const proto = req.get("x-forwarded-proto") || req.protocol;
    const appUrl = appPublicUrl(host, proto);
    const fail = (reason: string) => res.redirect(`${appUrl}/login?oauth=facebook&error=${encodeURIComponent(reason)}`);

    const errorParam = String(req.query.error || "").trim();
    if (errorParam) {
      if (errorParam === "access_denied" || errorParam === "user_denied") return fail("access_denied");
      const desc = String(req.query.error_description || "").trim();
      return fail(desc || errorParam);
    }

    const code = String(req.query.code || "").trim();
    const state = String(req.query.state || "").trim();
    if (!code) return fail("missing_code");
    const parsedState = parseFacebookOAuthState(state);
    if (!parsedState) return fail("invalid_state");

    try {
      const identity = await resolveFederatedIdentity({
        provider: "facebook",
        code,
        redirectUri: parsedState.redirectUri || facebookRedirectUri(host, proto),
      });
      const user = getDb().prepare("SELECT * FROM users WHERE email = ?").get(identity.email) as unknown as DbUser | undefined;
      if (!user) {
        return redirectUnregisteredOauth(res, appUrl, {
          provider: "facebook",
          email: identity.email,
          name: identity.name,
          avatarUrl: identity.avatarUrl,
        });
      }
      if (user.status === "disabled") return fail("account_disabled");
      const tenantBlocked = clinicTenantAccessError(user);
      if (tenantBlocked) return fail("tenant_suspended");
      finishOauthSession(res, user, { email: user.email, avatarUrl: identity.avatarUrl, provider: "facebook" });
      return res.redirect(`${appUrl}/login?oauth=facebook&status=ok`);
    } catch (err) {
      const message = err instanceof FacebookOAuthError ? err.message : "facebook_oauth_failed";
      return fail(message);
    }
  });
}

export function createOauthLoginRouter() {
  const api = Router();
  attachOauthLoginRoutes(api);
  return api;
}

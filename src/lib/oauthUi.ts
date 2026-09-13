/** Login SSO visibility helpers. Server Google Identity routes live in PR #64. */

export type PublicOauthConfig = {
  facebookConfigured?: boolean;
  googleConfigured?: boolean;
  sandboxClientOAuthAllowed?: boolean;
} | null | undefined;

/**
 * Show Google Sign-In when real Google Identity is configured, or when
 * SANDBOX/DEV client-email OAuth is allowed. Hide while config is loading
 * (null) and when production has neither path (no GOOGLE_* creds).
 *
 * Do not gate on `!sandboxClientOAuthAllowed` alone — that would hide Google
 * after PR #64 lands with credentials.
 */
export function showGoogleOAuthButton(oauthConfig: PublicOauthConfig): boolean {
  return Boolean(oauthConfig?.googleConfigured || oauthConfig?.sandboxClientOAuthAllowed);
}

/**
 * Show Facebook Sign-In only when GET /api/auth/oauth-config reports
 * facebookConfigured:true. Hide while config is loading (null) and when
 * Facebook App credentials are unset — same honesty as #65 hide-Google
 * when not configured. Do not invent FACEBOOK_APP_ID/SECRET to force this on.
 */
export function showFacebookOAuthButton(oauthConfig: PublicOauthConfig): boolean {
  return Boolean(oauthConfig?.facebookConfigured);
}

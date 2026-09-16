/** Login SSO visibility helpers. Server Google Identity routes live in PR #64. */

export type PublicOauthConfig = {
  facebookConfigured?: boolean;
  googleConfigured?: boolean;
  sandboxClientOAuthAllowed?: boolean;
} | null | undefined;

/**
 * Public login always offers Google + Facebook side-by-side. Click hits
 * `/api/auth/google` or `/api/auth/facebook` (no client-email sandbox path).
 */
export function showGoogleOAuthButton(_oauthConfig?: PublicOauthConfig): boolean {
  return true;
}

export function showFacebookOAuthButton(_oauthConfig?: PublicOauthConfig): boolean {
  return true;
}

/** Map Facebook/Google callback `error` query values to login-page copy. */
export function publicOauthErrorMessage(provider: "google" | "facebook", oauthError: string): string {
  const label = provider === "google" ? "Google" : "Facebook";
  const code = String(oauthError || "").trim();
  if (code === "not_configured") {
    return provider === "google"
      ? "Google Sign-in is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)."
      : "Facebook Login is not configured (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET).";
  }
  if (code === "access_denied" || code === "user_denied") {
    return `${label} sign-in was cancelled. You can try again or continue with email.`;
  }
  if (code === "missing_code") {
    return `${label} did not return an authorization code. Please try again.`;
  }
  if (code === "invalid_state") {
    return `${label} sign-in could not be verified. Please try again.`;
  }
  try {
    return decodeURIComponent(code);
  } catch {
    return `${label} authorization failed. Please try again.`;
  }
}

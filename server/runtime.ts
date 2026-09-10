/** Shared environment helpers. Simulators stay SANDBOX / DEV-ONLY. */

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function envFlag(name: string): boolean {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Live Meta / Facebook app values are provisioned separately.
 * `.env.example` placeholders must not count as configured credentials.
 */
export function isUnsetOrPlaceholder(value?: string | null): boolean {
  const v = String(value || "").trim();
  if (!v) return true;
  if (/^(replace-with-|changeme|change\.me|your-|todo\b|xxx+|placeholder)/i.test(v)) return true;
  if (/replace-with-|not-a-secret|dummy-secret|example\.invalid/i.test(v)) return true;
  return false;
}

/** First non-placeholder env var among the given names. */
export function readSecret(...names: string[]): string {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (!isUnsetOrPlaceholder(value)) return value;
  }
  return "";
}

/** Non-prod simulators and fake-success Meta routes. Always false in production. */
export function sandboxSimulatorsEnabled(): boolean {
  return !isProduction();
}

export function graphApiVersion(): string {
  const version = String(process.env.META_GRAPH_API_VERSION || "v21.0").trim();
  return version.startsWith("v") ? version : `v${version}`;
}

export function appPublicUrl(reqHost?: string, reqProto?: string): string {
  const fromEnv = String(process.env.APP_URL || "").trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (reqHost) {
    const proto = reqProto === "https" ? "https" : "http";
    return `${proto}://${reqHost}`;
  }
  return "http://localhost:3000";
}

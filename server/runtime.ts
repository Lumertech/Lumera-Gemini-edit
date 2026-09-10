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
  if (/^(undefined|null)$/i.test(v)) return true;
  if (/^(replace-with-|changeme|change-me|change\.me|your-|todo\b|xxx+|placeholder)/i.test(v)) return true;
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

/** Hostinger (and most Node hosts) inject PORT. Default 3000 for local production smoke. */
export function resolveListenPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = String(env.PORT || "").trim();
  if (!raw) return 3000;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`PORT must be an integer 1–65535 (got ${JSON.stringify(raw)})`);
  }
  return n;
}

/**
 * Hostinger's entry file is `dist/server.cjs` and may omit NODE_ENV.
 * Treat a bundled server start as production unless NODE_ENV is already set.
 */
export function applyBundledServerNodeEnv(
  argv1 = process.argv[1],
  env: NodeJS.ProcessEnv = process.env
): void {
  if (String(env.NODE_ENV || "").trim()) return;
  if (/(^|[\\/])server\.cjs$/.test(String(argv1 || ""))) {
    env.NODE_ENV = "production";
  }
}

/**
 * Production hosting (App Review URL stage) requires JWT_SECRET.
 * Meta / Facebook / Razorpay secrets stay optional until the founder provisions them.
 */
export function assertRequiredProductionEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const jwt = String(env.JWT_SECRET || "").trim();
  if (!jwt || isUnsetOrPlaceholder(jwt)) {
    throw new Error(
      "JWT_SECRET is required in production (no weak default). Set it in Hostinger environment variables."
    );
  }
  const appUrl = String(env.APP_URL || "").trim().replace(/\/$/, "");
  if (!appUrl) {
    console.warn(
      "[Lumera] APP_URL is unset. Set APP_URL=https://www.mylumera.in for Meta OAuth and policy links."
    );
  }
}

/** Shared environment helpers. Simulators stay SANDBOX / DEV-ONLY. */

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function envFlag(name: string): boolean {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
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

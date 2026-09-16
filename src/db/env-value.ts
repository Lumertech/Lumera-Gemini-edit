/**
 * Shared placeholder detection for env vars.
 * Kept out of server/runtime.ts so src/db/url.ts can use it without a cycle.
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
export function readEnvSecret(env: NodeJS.ProcessEnv, ...names: string[]): string {
  for (const name of names) {
    const value = String(env[name] || "").trim();
    if (!isUnsetOrPlaceholder(value)) return value;
  }
  return "";
}

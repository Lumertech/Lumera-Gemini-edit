/** Shared environment helpers. Simulators stay SANDBOX / DEV-ONLY. */

import { databaseUrlFromEnv } from "../src/db/url.ts";
import { isUnsetOrPlaceholder, readEnvSecret } from "../src/db/env-value.ts";
import { assertOptionalEnvShape } from "./env-catalog.ts";

export { databaseUrlFromEnv };
export { isUnsetOrPlaceholder };

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function envFlag(name: string): boolean {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** First non-placeholder env var among the given names. */
export function readSecret(...names: string[]): string {
  return readEnvSecret(process.env, ...names);
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
    const first = String(reqProto || "").split(",")[0].trim().toLowerCase();
    const proto = first === "https" ? "https" : "http";
    return `${proto}://${reqHost}`;
  }
  return "http://localhost:3000";
}

/**
 * Cloud Run injects PORT (AI Studio services often use 3000; classic default is 8080).
 * Honor that value. Never hardcode 8080 for listen(). Unset → 3000 for local smoke only.
 */
export function resolveListenPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = String(env.PORT || "").trim();
  if (!raw) return 3000;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`PORT must be an integer 1–65535 (got ${JSON.stringify(raw)})`);
  }
  return n;
}

/** Cloud Run surfaces this line when production exits before listen. */
export const JWT_SECRET_REQUIRED_MESSAGE =
  "JWT_SECRET is required in production (no weak default). Set JWT_SECRET on the Cloud Run service (Secret Manager or Console), then rebuild. This process exits before listen(0.0.0.0, PORT); Cloud Run will report a PORT timeout even though bind is not the bug.";

/**
 * Cloud Run is stateless. A local data/lumera.db is discarded on every deploy,
 * scale-to-zero wake, and extra instance. Production must use Cloud SQL.
 */
export const DATABASE_URL_REQUIRED_MESSAGE =
  "DATABASE_URL is required in production (Cloud Run is stateless; node:sqlite files are discarded on deploy/scale). Set DATABASE_URL to the Cloud SQL unix-socket URI (postgres://user:pass@/dbname?host=/cloudsql/PROJECT:asia-south1:INSTANCE) or INSTANCE_CONNECTION_NAME + SQL_USER + SQL_PASSWORD + SQL_DB_NAME, plus Cloud Run --add-cloudsql-instances. This process exits before listen(0.0.0.0, PORT); Cloud Run will report a PORT timeout even though bind is not the bug.";

/**
 * Cloud Run / `npm start` entry is `dist/server.cjs` and may omit NODE_ENV.
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
 * Production hosting requires JWT_SECRET and a durable Postgres URL.
 * Meta / Facebook / Razorpay secrets stay optional until the founder provisions them.
 * Malformed usage-billing / Cloud SQL / Graph pairs fail in every environment.
 */
export function assertRequiredProductionEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const jwt = String(env.JWT_SECRET || "").trim();
  if (!jwt || isUnsetOrPlaceholder(jwt)) {
    throw new Error(JWT_SECRET_REQUIRED_MESSAGE);
  }
  const dbUrl = databaseUrlFromEnv(env);
  if (!dbUrl || isUnsetOrPlaceholder(dbUrl)) {
    throw new Error(DATABASE_URL_REQUIRED_MESSAGE);
  }
  const appUrl = String(env.APP_URL || "").trim().replace(/\/$/, "");
  if (!appUrl) {
    console.warn(
      "[Lumera] APP_URL is unset. Set APP_URL=https://www.mylumera.in for Google/Meta OAuth and policy links."
    );
  }
  assertOptionalEnvShape(env);
}

/**
 * Fail-closed on missing/placeholder JWT_SECRET or DATABASE_URL in production,
 * and on malformed optional env in every NODE_ENV. Logs `[Lumera] BOOT FATAL:`
 * then exits. Does not listen — that crash is not a PORT/bind bug.
 */
export function failFastRequiredProductionEnv(
  env: NodeJS.ProcessEnv = process.env,
  exitProcess: (code: number) => void = (code) => {
    process.exit(code);
  }
): void {
  try {
    assertOptionalEnvShape(env);
    assertRequiredProductionEnv(env);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Lumera] BOOT FATAL: ${msg}`);
    exitProcess(1);
  }
}

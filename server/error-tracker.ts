/**
 * GCP Error Reporting for Cloud Run, with a console fallback locally.
 * Lumera is not a certified Meta Tech Provider. Contact ravee@lumer.me.
 *
 * No Sentry. Structured Cloud Logging events are ingested by Error Reporting
 * on Cloud Run (K_SERVICE / metadata server). Missing ADC must not crash tests.
 */

import type { ErrorRequestHandler } from "express";
import { isProduction, isUnsetOrPlaceholder } from "./runtime.ts";

export type ErrorTrackerMode = "gcp" | "console";

export type ErrorTrackerStatus = {
  mode: ErrorTrackerMode;
  initialized: boolean;
  service: string;
};

const GCP_REPORTED_ERROR_TYPE =
  "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent";

const DEFAULT_SERVICE = "lumera-gemini-edit";

const PLACEHOLDER_DSN_MESSAGE =
  "ERROR_REPORTING / SENTRY_DSN is a placeholder or unsupported DSN in production. Lumera uses GCP Error Reporting on Cloud Run (not Sentry). Unset it or set ERROR_REPORTING=gcp. Contact ravee@lumer.me.";

const PLACEHOLDER_PROJECT_MESSAGE =
  "ERROR_REPORTING_PROJECT_ID is a placeholder in production. Unset it to use Cloud Run default Error Reporting, or set the real GCP project id. Contact ravee@lumer.me.";

let status: ErrorTrackerStatus = {
  mode: "console",
  initialized: false,
  service: DEFAULT_SERVICE,
};

type ProcessWithGuard = NodeJS.Process & { __lumeraErrorHandlers?: boolean };

export function getErrorTrackerStatus(): ErrorTrackerStatus {
  return { ...status };
}

export function resetErrorTrackerForTests(): void {
  status = { mode: "console", initialized: false, service: DEFAULT_SERVICE };
}

export function readErrorReportingDsn(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.ERROR_REPORTING || env.SENTRY_DSN || env.ERROR_TRACKING_DSN || "").trim();
}

export function readErrorReportingProjectId(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.ERROR_REPORTING_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || "").trim();
}

function looksLikeHttpDsn(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Production hosting fails closed on a misconfigured DSN / project id.
 * Unset config is fine: Cloud Run uses the default Error Reporting agent.
 */
export function assertErrorTrackerConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;

  const explicitProject = String(env.ERROR_REPORTING_PROJECT_ID || "").trim();
  if (explicitProject && isUnsetOrPlaceholder(explicitProject)) {
    throw new Error(PLACEHOLDER_PROJECT_MESSAGE);
  }

  const dsn = readErrorReportingDsn(env);
  if (!dsn) return;
  const normalized = dsn.toLowerCase();
  if (normalized === "gcp" || normalized === "console" || normalized === "off") return;
  if (isUnsetOrPlaceholder(dsn) || looksLikeHttpDsn(dsn)) {
    throw new Error(PLACEHOLDER_DSN_MESSAGE);
  }
}

export function failFastErrorTrackerConfig(
  env: NodeJS.ProcessEnv = process.env,
  exitProcess: (code: number) => void = (code) => {
    process.exit(code);
  }
): void {
  try {
    assertErrorTrackerConfig(env);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Lumera] BOOT FATAL: ${msg}`);
    exitProcess(1);
  }
}

function resolveServiceName(env: NodeJS.ProcessEnv): string {
  return String(env.K_SERVICE || env.ERROR_REPORTING_SERVICE || "").trim() || DEFAULT_SERVICE;
}

function onCloudRun(env: NodeJS.ProcessEnv): boolean {
  return Boolean(String(env.K_SERVICE || "").trim());
}

function wantsGcp(env: NodeJS.ProcessEnv): boolean {
  const dsn = readErrorReportingDsn(env).toLowerCase();
  if (dsn === "console" || dsn === "off") return false;
  if (dsn === "gcp") return true;
  if (onCloudRun(env)) return true;
  const project = readErrorReportingProjectId(env);
  return Boolean(project && !isUnsetOrPlaceholder(project));
}

/** Initialize the tracker. Local/test without GCP creds: console fallback, never throw. */
export function initErrorTracker(env: NodeJS.ProcessEnv = process.env): ErrorTrackerStatus {
  assertErrorTrackerConfig(env);
  const service = resolveServiceName(env);

  if (wantsGcp(env)) {
    status = { mode: "gcp", initialized: true, service };
    console.log(`[Lumera] error tracker: gcp (Cloud Run Error Reporting, service=${service})`);
    return getErrorTrackerStatus();
  }

  if (isProduction() && !onCloudRun(env) && readErrorReportingDsn(env).toLowerCase() !== "console") {
    console.error(
      "[Lumera] error tracker: GCP reporting expected on Cloud Run but K_SERVICE unset; using console fallback"
    );
  }

  status = { mode: "console", initialized: true, service };
  console.log("[Lumera] error tracker: console fallback");
  return getErrorTrackerStatus();
}

function ensureInitialized(): void {
  if (!status.initialized) {
    status = { mode: "console", initialized: true, service: DEFAULT_SERVICE };
  }
}

function asError(err: unknown, fallbackMessage: string): Error {
  if (err instanceof Error) return err;
  if (typeof err === "string" && err.trim()) return new Error(err);
  return new Error(fallbackMessage);
}

export function reportError(err: unknown, context?: Record<string, unknown>): void {
  ensureInitialized();
  const error = asError(err, "Unknown error");
  const message = error.stack || error.message || String(err);

  if (status.mode === "gcp") {
    const payload: Record<string, unknown> = {
      "@type": GCP_REPORTED_ERROR_TYPE,
      message,
      serviceContext: {
        service: status.service,
      },
    };
    if (context && Object.keys(context).length) {
      payload.context = { reportLocation: context };
    }
    console.error(JSON.stringify(payload));
    return;
  }

  if (context && Object.keys(context).length) {
    console.error("[Lumera] error tracker:", message, context);
  } else {
    console.error("[Lumera] error tracker:", message);
  }
}

/** Log a swallowed catch without changing caller control-flow. */
export function reportCaughtError(err: unknown, label: string): void {
  reportError(asError(err, label), { kind: "caught", label });
}

export function installProcessErrorHandlers(proc: NodeJS.Process = process): void {
  const tagged = proc as ProcessWithGuard;
  if (tagged.__lumeraErrorHandlers) return;
  tagged.__lumeraErrorHandlers = true;

  proc.on("uncaughtException", (err) => {
    reportError(err, { kind: "uncaughtException" });
  });
  proc.on("unhandledRejection", (reason) => {
    reportError(reason, { kind: "unhandledRejection" });
  });
}

export const expressErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  reportError(err, {
    kind: "express",
    method: req.method,
    path: req.path,
  });
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(500).json({ error: "Internal server error" });
};

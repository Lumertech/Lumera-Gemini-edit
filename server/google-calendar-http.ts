/**
 * Google Calendar HTTP + credential helpers.
 *
 * Production talks to Google with live GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
 * Automated tests and GitHub Actions never have those secrets — and must never
 * open sockets to googleapis.com. In NODE_ENV=test / CI=true we:
 *   1. Fall back to dummy Calendar client id/secret when env is unset.
 *   2. Route Calendar + OAuth token HTTP through an in-process mock.
 *
 * Sign-in (`googleOAuthConfigured` / `googleClientId`) is unchanged so
 * production-unconfigured 503 tests keep failing closed.
 */

import { googleClientId, googleClientSecret } from "./google-oauth.ts";
import { envFlag } from "./runtime.ts";

export const GOOGLE_CALENDAR_TEST_CLIENT_ID = "1234567890-ci-test.apps.googleusercontent.com";
export const GOOGLE_CALENDAR_TEST_CLIENT_SECRET = "GOCSPX-ci-test-calendar-secret";
export const GOOGLE_CALENDAR_TEST_ACCESS_TOKEN = "ya29.ci-test-access-token";
export const GOOGLE_CALENDAR_TEST_REFRESH_TOKEN = "1//ci-test-refresh-token";
export const GOOGLE_CALENDAR_TEST_EMAIL = "ci-calendar@example.com";
export const GOOGLE_CALENDAR_TEST_EVENT_ID = "gcal-evt-mock-1";

export function isGoogleCalendarTestMode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isProductionEnv(env)) return false;
  if (String(env.NODE_ENV || "").trim() === "test") return true;
  if (envFlagFrom(env, "CI")) return true;
  if (envFlagFrom(env, "GITHUB_ACTIONS")) return true;
  return false;
}

function isProductionEnv(env: NodeJS.ProcessEnv): boolean {
  return String(env.NODE_ENV || "").trim() === "production";
}

function envFlagFrom(env: NodeJS.ProcessEnv, name: string): boolean {
  if (env === process.env) return envFlag(name);
  const raw = String(env[name] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function isGoogleApiUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "googleapis.com" || host.endsWith(".googleapis.com");
  } catch {
    return /googleapis\.com/i.test(url);
  }
}

/** Calendar OAuth client id — live env, else dummy in test/CI. Never dummy in production. */
export function googleCalendarClientId(): string {
  const live = googleClientId();
  if (live) return live;
  if (isGoogleCalendarTestMode()) return GOOGLE_CALENDAR_TEST_CLIENT_ID;
  return "";
}

/** Calendar OAuth client secret — live env, else dummy in test/CI. Never dummy in production. */
export function googleCalendarClientSecret(): string {
  const live = googleClientSecret();
  if (live) return live;
  if (isGoogleCalendarTestMode()) return GOOGLE_CALENDAR_TEST_CLIENT_SECRET;
  return "";
}

export function googleCalendarOAuthConfigured(): boolean {
  return Boolean(googleCalendarClientId() && googleCalendarClientSecret());
}

let calendarFetchImpl: typeof fetch | null = null;
let networkGuardInstalled = false;
let originalFetch: typeof fetch | null = null;

export function setGoogleCalendarFetchImpl(impl: typeof fetch | null) {
  calendarFetchImpl = impl;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return String((input as Request).url);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return String(init.method).toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

/**
 * In-process stand-in for oauth2.googleapis.com token exchange and Calendar v3
 * (freeBusy, events.list/insert/patch/delete, events.watch, userinfo).
 */
export const mockGoogleCalendarFetch: typeof fetch = async (input, init) => {
  const url = requestUrl(input);
  const method = requestMethod(input, init);

  if (url.includes("oauth2.googleapis.com/token")) {
    return jsonResponse({
      access_token: GOOGLE_CALENDAR_TEST_ACCESS_TOKEN,
      refresh_token: GOOGLE_CALENDAR_TEST_REFRESH_TOKEN,
      expires_in: 3600,
      token_type: "Bearer",
      email: GOOGLE_CALENDAR_TEST_EMAIL,
    });
  }

  if (url.includes("oauth2/v3/userinfo") || url.includes("oauth2/v2/userinfo")) {
    return jsonResponse({
      sub: "google-calendar-ci-sub",
      email: GOOGLE_CALENDAR_TEST_EMAIL,
      email_verified: true,
      name: "CI Calendar Doctor",
    });
  }

  if (url.includes("/calendar/v3/freeBusy")) {
    return jsonResponse({
      calendars: {
        primary: { busy: [] },
      },
    });
  }

  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    /* keep raw */
  }

  if (/\/calendars\/[^/]+\/events\/watch\/?$/.test(pathname) && method === "POST") {
    return jsonResponse({
      kind: "api#channel",
      id: "ci-channel",
      resourceId: "ci-resource",
      expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
  }

  if (/\/calendars\/[^/]+\/events\/[^/]+\/?$/.test(pathname)) {
    const eventId = decodeURIComponent(pathname.split("/events/")[1]?.replace(/\/$/, "") || GOOGLE_CALENDAR_TEST_EVENT_ID);
    if (method === "DELETE") return new Response(null, { status: 204 });
    return jsonResponse({ id: eventId, status: "confirmed" });
  }

  if (/\/calendars\/[^/]+\/events\/?$/.test(pathname)) {
    if (method === "POST") {
      return jsonResponse({ id: GOOGLE_CALENDAR_TEST_EVENT_ID, status: "confirmed" });
    }
    // events.list
    return jsonResponse({ kind: "calendar#events", items: [], nextPageToken: undefined });
  }

  if (isGoogleApiUrl(url)) {
    return jsonResponse({});
  }

  throw new Error(`Google Calendar mock received a non-Google URL: ${url}`);
};

export function resolveGoogleCalendarFetch(): typeof fetch {
  if (calendarFetchImpl) return calendarFetchImpl;
  if (isGoogleCalendarTestMode()) return mockGoogleCalendarFetch;
  return fetch;
}

/**
 * Intercept global fetch to googleapis.com so a missed fetchImpl cannot
 * leak a live request from the test process. Localhost (test HTTP servers)
 * still uses the real fetch.
 */
export function installGoogleCalendarNetworkGuard(): void {
  if (networkGuardInstalled) return;
  if (!isGoogleCalendarTestMode()) return;
  originalFetch = globalThis.fetch.bind(globalThis);
  networkGuardInstalled = true;
  const native = originalFetch;
  const guarded: typeof fetch = async (input, init) => {
    const url = requestUrl(input);
    if (isGoogleApiUrl(url)) {
      if (calendarFetchImpl) return calendarFetchImpl(input, init);
      return mockGoogleCalendarFetch(input, init);
    }
    return native(input, init);
  };
  globalThis.fetch = guarded;
}

export function googleCalendarNetworkGuardInstalled(): boolean {
  return networkGuardInstalled;
}

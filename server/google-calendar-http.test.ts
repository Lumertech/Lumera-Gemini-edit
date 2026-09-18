import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { googleOAuthConfigured } from "./google-oauth.ts";
import {
  exchangeGoogleCalendarAuthorizationCode,
  googleCalendarDialogUrl,
  googleCalendarOAuthConfigured,
  refreshGoogleCalendarAccessToken,
} from "./google-calendar-oauth.ts";
import {
  GOOGLE_CALENDAR_TEST_ACCESS_TOKEN,
  GOOGLE_CALENDAR_TEST_CLIENT_ID,
  GOOGLE_CALENDAR_TEST_CLIENT_SECRET,
  GOOGLE_CALENDAR_TEST_EMAIL,
  GOOGLE_CALENDAR_TEST_EVENT_ID,
  GOOGLE_CALENDAR_TEST_REFRESH_TOKEN,
  googleCalendarClientId,
  googleCalendarClientSecret,
  installGoogleCalendarNetworkGuard,
  isGoogleApiUrl,
  isGoogleCalendarTestMode,
  mockGoogleCalendarFetch,
  resolveGoogleCalendarFetch,
} from "./google-calendar-http.ts";

function saveEnv(names: string[]): () => void {
  const prev: Record<string, string | undefined> = {};
  for (const name of names) prev[name] = process.env[name];
  return () => {
    for (const name of names) {
      if (prev[name] === undefined) delete process.env[name];
      else process.env[name] = prev[name];
    }
  };
}

describe("Google Calendar test-mode credentials", () => {
  const restore = saveEnv([
    "NODE_ENV",
    "CI",
    "GITHUB_ACTIONS",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
  ]);
  after(restore);

  it("falls back to dummy Calendar credentials when GOOGLE_CLIENT_* are unset under NODE_ENV=test", () => {
    process.env.NODE_ENV = "test";
    delete process.env.CI;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    assert.equal(isGoogleCalendarTestMode(), true);
    assert.equal(googleCalendarClientId(), GOOGLE_CALENDAR_TEST_CLIENT_ID);
    assert.equal(googleCalendarClientSecret(), GOOGLE_CALENDAR_TEST_CLIENT_SECRET);
    assert.equal(googleCalendarOAuthConfigured(), true);
    assert.equal(googleOAuthConfigured(), false);
  });

  it("falls back to dummy Calendar credentials when CI=true even if NODE_ENV is unset", () => {
    delete process.env.NODE_ENV;
    process.env.CI = "true";
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    assert.equal(isGoogleCalendarTestMode(), true);
    assert.equal(googleCalendarClientId(), GOOGLE_CALENDAR_TEST_CLIENT_ID);
    assert.equal(googleCalendarOAuthConfigured(), true);
    assert.equal(googleOAuthConfigured(), false);
  });

  it("never injects dummy Calendar credentials in production", () => {
    process.env.NODE_ENV = "production";
    process.env.CI = "true";
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    assert.equal(isGoogleCalendarTestMode(), false);
    assert.equal(googleCalendarClientId(), "");
    assert.equal(googleCalendarClientSecret(), "");
    assert.equal(googleCalendarOAuthConfigured(), false);
  });

  it("prefers live GOOGLE_CLIENT_* when they are set in test", () => {
    process.env.NODE_ENV = "test";
    process.env.GOOGLE_CLIENT_ID = "1234567890-abc.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-unit-test-not-a-real-secret";
    assert.equal(googleCalendarClientId(), "1234567890-abc.apps.googleusercontent.com");
    const url = new URL(
      googleCalendarDialogUrl({
        redirectUri: "http://localhost:3000/api/tenant/doctor/google-calendar/callback",
        state: "unit-state",
      })
    );
    assert.equal(url.searchParams.get("client_id"), "1234567890-abc.apps.googleusercontent.com");
  });
});

describe("Google Calendar API mock", () => {
  const restore = saveEnv(["NODE_ENV", "CI", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
  after(restore);

  it("classifies oauth2 and calendar hosts as Google API URLs", () => {
    assert.equal(isGoogleApiUrl("https://oauth2.googleapis.com/token"), true);
    assert.equal(isGoogleApiUrl("https://www.googleapis.com/calendar/v3/calendars/primary/events"), true);
    assert.equal(isGoogleApiUrl("http://127.0.0.1:9/api/auth/login"), false);
    assert.equal(isGoogleApiUrl("https://accounts.google.com/o/oauth2/v2/auth"), false);
  });

  it("mocks token exchange, events.list, and events.insert without a network", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    const tokens = await exchangeGoogleCalendarAuthorizationCode({
      code: "unit-code",
      redirectUri: "http://localhost:3000/api/tenant/doctor/google-calendar/callback",
    });
    assert.equal(tokens.accessToken, GOOGLE_CALENDAR_TEST_ACCESS_TOKEN);
    assert.equal(tokens.refreshToken, GOOGLE_CALENDAR_TEST_REFRESH_TOKEN);

    const refreshed = await refreshGoogleCalendarAccessToken({ refreshToken: "1//test" });
    assert.equal(refreshed.accessToken, GOOGLE_CALENDAR_TEST_ACCESS_TOKEN);

    const list = await mockGoogleCalendarFetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=10"
    );
    assert.equal(list.status, 200);
    const listed = (await list.json()) as { items?: unknown[] };
    assert.deepEqual(listed.items, []);

    const inserted = await mockGoogleCalendarFetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      { method: "POST", body: JSON.stringify({ summary: "OPD" }) }
    );
    const created = (await inserted.json()) as { id?: string };
    assert.equal(created.id, GOOGLE_CALENDAR_TEST_EVENT_ID);
  });

  it("resolveGoogleCalendarFetch uses the in-process mock under NODE_ENV=test", async () => {
    process.env.NODE_ENV = "test";
    installGoogleCalendarNetworkGuard();
    const impl = resolveGoogleCalendarFetch();
    const res = await impl("https://www.googleapis.com/oauth2/v3/userinfo");
    const body = (await res.json()) as { email?: string };
    assert.equal(body.email, GOOGLE_CALENDAR_TEST_EMAIL);
  });

  it("intercepts global fetch to googleapis.com so tests never open a socket", async () => {
    process.env.NODE_ENV = "test";
    installGoogleCalendarNetworkGuard();
    const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { items?: unknown[] };
    assert.deepEqual(body.items, []);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import jwt from "jsonwebtoken";
import {
  OAUTH_ONBOARDING_COOKIE,
  parseOauthOnboardingToken,
  readOauthOnboardingFromRequest,
  signOauthOnboardingToken,
  unregisteredOauthLoginPath,
  unregisteredOauthRedirectTarget,
} from "./oauth-onboarding.ts";

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "test-jwt-secret-oauth-onboarding";
}

describe("OAuth onboarding token", () => {
  it("signs a 30-minute oauth_onboarding JWT and round-trips email/name/provider", () => {
    const token = signOauthOnboardingToken({
      provider: "facebook",
      email: "  Dr.Clinic@Example.COM ",
      name: " Dr. Ravi ",
      avatarUrl: "https://example.com/a.png",
    });
    const identity = parseOauthOnboardingToken(token);
    assert.ok(identity);
    assert.equal(identity.purpose, "oauth_onboarding");
    assert.equal(identity.provider, "facebook");
    assert.equal(identity.email, "dr.clinic@example.com");
    assert.equal(identity.name, "Dr. Ravi");
    assert.equal(identity.avatarUrl, "https://example.com/a.png");
    const decoded = jwt.decode(token) as { exp?: number; iat?: number };
    assert.ok(decoded.exp && decoded.iat);
    assert.equal(decoded.exp - decoded.iat, 30 * 60);
  });

  it("rejects session JWTs and garbage", () => {
    const session = jwt.sign({ userId: "user-1", tenantId: "t-1" }, process.env.JWT_SECRET as string, {
      expiresIn: "1h",
    });
    assert.equal(parseOauthOnboardingToken(session), null);
    assert.equal(parseOauthOnboardingToken("not-a-jwt"), null);
    assert.equal(parseOauthOnboardingToken(""), null);
  });

  it("puts oauth=facebook&unregistered=1 plus oauthToken on the login path", () => {
    const path = unregisteredOauthLoginPath({
      provider: "facebook",
      email: "new.fb@clinic.example",
      name: "New FB Doctor",
    });
    const url = new URL(path, "https://www.mylumera.in");
    assert.equal(url.pathname, "/login");
    assert.equal(url.searchParams.get("oauth"), "facebook");
    assert.equal(url.searchParams.get("unregistered"), "1");
    assert.equal(url.searchParams.get("email"), "new.fb@clinic.example");
    assert.equal(url.searchParams.get("name"), "New FB Doctor");
    const token = url.searchParams.get("oauthToken") || "";
    assert.ok(token);
    assert.equal(parseOauthOnboardingToken(token)?.email, "new.fb@clinic.example");
    const target = unregisteredOauthRedirectTarget({
      provider: "google",
      email: "new.g@clinic.example",
      name: "New Google Doctor",
    });
    assert.match(target.path, /oauth=google/);
    assert.match(target.path, /unregistered=1/);
    assert.match(target.cookie, new RegExp(`^${OAUTH_ONBOARDING_COOKIE}=`));
    assert.match(target.cookie, /HttpOnly/);
  });

  it("reads oauthToken from the register-practice body and ignores a forged cookie", () => {
    const bodyToken = signOauthOnboardingToken({
      provider: "facebook",
      email: "verified@clinic.example",
      name: "Verified Name",
    });
    const cookieToken = signOauthOnboardingToken({
      provider: "google",
      email: "forged@clinic.example",
      name: "Forged",
    });
    const read = readOauthOnboardingFromRequest({
      body: { oauthToken: bodyToken },
      headers: { cookie: `${OAUTH_ONBOARDING_COOKIE}=${encodeURIComponent(cookieToken)}` },
    });
    assert.equal(read.present, true);
    assert.equal(read.present && read.ok, true);
    if (read.present && read.ok) {
      assert.equal(read.identity.email, "verified@clinic.example");
      assert.equal(read.identity.provider, "facebook");
    }
  });

  it("falls back to the raw Cookie header when cookie-parser is not mounted", () => {
    const token = signOauthOnboardingToken({
      provider: "google",
      email: "cookie@clinic.example",
      name: "Cookie Name",
    });
    const read = readOauthOnboardingFromRequest({
      body: {},
      headers: { cookie: `${OAUTH_ONBOARDING_COOKIE}=${encodeURIComponent(token)}` },
    });
    assert.equal(read.present && read.ok, true);
    if (read.present && read.ok) {
      assert.equal(read.identity.email, "cookie@clinic.example");
    }
  });

  it("returns a 401-style error for an expired/invalid onboarding token", () => {
    const read = readOauthOnboardingFromRequest({ body: { oauthToken: "expired.token.value" } });
    assert.deepEqual(read, {
      present: true,
      ok: false,
      error: "Facebook/Google identity expired. Sign in with Facebook or Google again.",
    });
  });
});

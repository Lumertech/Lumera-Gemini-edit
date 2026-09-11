import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_PRACTICE_TYPE, initialRegisterPracticeType } from "../lib/practiceOnboarding.ts";

const here = dirname(fileURLToPath(import.meta.url));
const loginSrc = readFileSync(join(here, "LoginPage.tsx"), "utf8");

describe("LoginPage create-clinic / register defaults (founder P0)", () => {
  it("never initializes practice-type state to Multispecialty", () => {
    assert.equal(loginSrc.includes('useState<"individual" | "multispecialty">("multispecialty")'), false);
    assert.equal(loginSrc.includes('useState("multispecialty")'), false);
    assert.equal(/useState<PracticeType>\(\s*"multispecialty"\s*\)/.test(loginSrc), false);
    assert.equal(/useState<PracticeType>\(\s*"polyclinic"\s*\)/.test(loginSrc), false);
    assert.match(loginSrc, /initialRegisterPracticeType/);
    assert.match(loginSrc, /registerPracticeTypePayload/);
    assert.match(loginSrc, /DEFAULT_PRACTICE_TYPE/);
  });

  it("open create-clinic/register selects Individual before any click", () => {
    assert.equal(DEFAULT_PRACTICE_TYPE, "individual");
    assert.equal(initialRegisterPracticeType("?practiceType=multispecialty&practice=polyclinic"), "individual");
    assert.match(loginSrc, /data-default="individual"/);
    assert.match(loginSrc, /data-testid="register-practice-individual"/);
    assert.match(loginSrc, /setExplicitPolyclinicChoice\(true\)/);
  });

  it("does not read URL params to select Multispecialty", () => {
    assert.equal(loginSrc.includes('params.get("practiceType")'), false);
    assert.equal(loginSrc.includes('searchParams.get("practice")'), false);
    assert.match(loginSrc, /initialRegisterPracticeType\(window\.location\.search\)/);
  });
});

describe("LoginPage Google SSO visibility (CoS UX hotfix)", () => {
  it("hides Google until oauth-config explicitly allows sandbox client OAuth", () => {
    assert.match(
      loginSrc,
      /const showGoogleOAuth = oauthConfig\?\.sandboxClientOAuthAllowed === true/
    );
    assert.match(loginSrc, /useState<\{[\s\S]*sandboxClientOAuthAllowed: boolean;[\s\S]*\} \| null>\(null\)/);
    assert.match(loginSrc, /provider === "google" && oauthConfig\?\.sandboxClientOAuthAllowed !== true/);
  });

  it("gates both Google button clusters and leaves Facebook always rendered", () => {
    const googleClicks = loginSrc.match(/handleOAuthSignIn\("google"\)/g) || [];
    const facebookClicks = loginSrc.match(/handleOAuthSignIn\("facebook"\)/g) || [];
    assert.equal(googleClicks.length, 2);
    assert.equal(facebookClicks.length, 2);
    assert.match(loginSrc, /data-testid="oauth-google-signin"/);
    assert.match(loginSrc, /data-testid="oauth-google-register"/);
    assert.match(loginSrc, /data-testid="oauth-facebook-signin"/);
    assert.match(loginSrc, /data-testid="oauth-facebook-register"/);

    const signinGoogleBlock = loginSrc.slice(
      loginSrc.indexOf("data-testid=\"oauth-google-signin\""),
      loginSrc.indexOf("data-testid=\"oauth-facebook-signin\"")
    );
    const registerGoogleBlock = loginSrc.slice(
      loginSrc.indexOf("data-testid=\"oauth-google-register\""),
      loginSrc.indexOf("data-testid=\"oauth-facebook-register\"")
    );
    assert.match(loginSrc, /\{showGoogleOAuth && \(/);
    assert.equal((loginSrc.match(/\{showGoogleOAuth && \(/g) || []).length, 2);
    assert.match(signinGoogleBlock, /Google/);
    assert.match(registerGoogleBlock, /Google Sign-In/);
  });
});

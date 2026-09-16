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

  it("starts Google Sign-in at /api/auth/google when credentials are configured", () => {
    assert.match(loginSrc, /oauthConfig\?\.googleConfigured/);
    assert.match(loginSrc, /window\.location\.href = provider === "google" \? "\/api\/auth\/google" : "\/api\/auth\/facebook"/);
    assert.match(loginSrc, /GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/);
    assert.match(loginSrc, /oauth !== "google"/);
  });

  it("starts Facebook Login at /api/auth/facebook when credentials are configured", () => {
    assert.match(loginSrc, /oauthConfig\?\.facebookConfigured/);
    assert.match(loginSrc, /window\.location\.href = provider === "google" \? "\/api\/auth\/google" : "\/api\/auth\/facebook"/);
    assert.match(loginSrc, /FACEBOOK_APP_ID and FACEBOOK_APP_SECRET/);
    assert.match(loginSrc, /FACEBOOK_CLIENT_ID \/ FACEBOOK_CLIENT_SECRET/);
  });

  it("does not read URL params to select Multispecialty", () => {
    assert.equal(loginSrc.includes('params.get("practiceType")'), false);
    assert.equal(loginSrc.includes('searchParams.get("practice")'), false);
    assert.match(loginSrc, /initialRegisterPracticeType\(window\.location\.search\)/);
  });
});

describe("LoginPage WhatsApp country code (founder P0)", () => {
  it("places country code adjacent to the WhatsApp number on one row", () => {
    assert.match(loginSrc, /WhatsAppPhoneRow/);
    assert.match(loginSrc, /testId="login-whatsapp"/);
    assert.match(loginSrc, /flex items-stretch rounded-xl/);
    assert.match(loginSrc, /aria-label="Country code"/);
    assert.match(loginSrc, /composeWhatsAppNumber\(loginCountry\.code, whatsappPhone\)/);
    assert.match(loginSrc, /data-testid=\{\`\$\{testId\}-country\`\}/);
    assert.doesNotMatch(loginSrc, /id="login-whatsapp"[\s\S]{0,400}className="w-full pl-9/);
  });
});

describe("LoginPage Google + Facebook SSO (side-by-side, no demo logins)", () => {
  it("always offers Google and Facebook via /api/auth/{provider}", () => {
    assert.match(loginSrc, /showGoogleOAuthButton\(oauthConfig\)/);
    assert.match(loginSrc, /googleConfigured\?: boolean/);
    assert.match(loginSrc, /useState<\{[\s\S]*sandboxClientOAuthAllowed: boolean;[\s\S]*\} \| null>\(null\)/);
    assert.match(loginSrc, /oauthConfig\?\.googleConfigured/);
    assert.match(loginSrc, /window\.location\.href = provider === "google" \? "\/api\/auth\/google" : "\/api\/auth\/facebook"/);
    assert.equal(loginSrc.includes("oauthConfig?.sandboxClientOAuthAllowed === true"), false);
    assert.equal(loginSrc.includes("oauthConfig?.sandboxClientOAuthAllowed !== true"), false);
  });

  it("places Google and Facebook side-by-side with matching handlers", () => {
    const googleClicks = loginSrc.match(/handleOAuthSignIn\("google"\)/g) || [];
    const facebookClicks = loginSrc.match(/handleOAuthSignIn\("facebook"\)/g) || [];
    assert.equal(googleClicks.length, 2);
    assert.equal(facebookClicks.length, 2);
    assert.match(loginSrc, /googleTestId="oauth-google-signin"/);
    assert.match(loginSrc, /googleTestId="oauth-google-register"/);
    assert.match(loginSrc, /facebookTestId="oauth-facebook-signin"/);
    assert.match(loginSrc, /facebookTestId="oauth-facebook-register"/);
    assert.match(loginSrc, /showFacebookOAuthButton\(oauthConfig\)/);
    assert.match(loginSrc, /grid grid-cols-2 gap-3/);
    assert.match(loginSrc, /data-testid="oauth-social-row"/);
    assert.doesNotMatch(loginSrc, /DEMO_LOGIN_MATRIX/);
    assert.doesNotMatch(loginSrc, /demo-account-picker/);
    assert.doesNotMatch(loginSrc, /handleQuickDemoClinician/);
    assert.doesNotMatch(loginSrc, /SANDBOX \/ DEMO logins/);
    assert.doesNotMatch(loginSrc, /physio\.doctor@lumera\.me/);
  });

  it("locks verified OAuth name/email and makes the master password optional", () => {
    assert.match(loginSrc, /params\.get\("unregistered"\) === "1"/);
    assert.match(loginSrc, /params\.get\("oauthToken"\)/);
    assert.match(loginSrc, /oauthOnboarding/);
    assert.match(loginSrc, /readOnly=\{oauthOnboarding\}/);
    assert.match(loginSrc, /aria-readonly=\{oauthOnboarding\}/);
    assert.match(loginSrc, /data-oauth-locked=\{oauthOnboarding \? "true" : "false"\}/);
    assert.match(loginSrc, /required=\{!oauthOnboarding\}/);
    assert.match(loginSrc, /minLength=\{oauthOnboarding \? undefined : 6\}/);
    assert.match(loginSrc, /Fallback password for email sign-in/);
    assert.match(loginSrc, /REGISTER_OAUTH_PASSWORD_PLACEHOLDER/);
    assert.match(loginSrc, /data-testid="register-oauth-token"/);
    assert.match(loginSrc, /data-testid="register-oauth-password-hint"/);
    assert.match(loginSrc, /oauthToken: oauthToken \|\| undefined/);
    assert.match(loginSrc, /password: oauthOnboarding \? adminPassword\.trim\(\) \|\| undefined : adminPassword/);
    assert.match(loginSrc, /Your name and email are locked|Those fields are locked/);
    const authSrc = readFileSync(join(here, "../auth/AuthContext.tsx"), "utf8");
    assert.match(authSrc, /oauthToken\?: string/);
    assert.match(authSrc, /oauthProvider\?: "google" \| "facebook"/);
    assert.match(authSrc, /oauthToken: data\.oauthToken \|\| undefined/);
  });
});

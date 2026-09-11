import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  emptyPublicLoginFields,
  LOGIN_PASSWORD_PLACEHOLDER,
  LOGIN_WHATSAPP_PLACEHOLDER,
  isSeededDemoEmail,
  persistRememberedLoginEmail,
  readRememberedLoginEmail,
  REMEMBER_EMAIL_KEY,
  sanitizePhoneDigits,
  stripSeededPublicLoginValue,
} from "./loginFormDefaults";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loginPage = fs.readFileSync(path.join(__dirname, "../pages/LoginPage.tsx"), "utf8");
const landingPage = fs.readFileSync(path.join(__dirname, "../components/LandingPage.tsx"), "utf8");

describe("public login form defaults", () => {
  it("starts every public credential field empty", () => {
    const fields = emptyPublicLoginFields();
    assert.equal(fields.email, "");
    assert.equal(fields.password, "");
    assert.equal(fields.whatsappPhone, "");
    assert.equal(fields.adminPassword, "");
    assert.equal(fields.oauthEmail, "");
    assert.equal(fields.oauthName, "");
  });

  it("strips only known seeded demo emails, not arbitrary clinic emails", () => {
    assert.equal(isSeededDemoEmail("doctor@lumera.me"), true);
    assert.equal(isSeededDemoEmail("  ADMIN@lumera.me  "), true);
    assert.equal(isSeededDemoEmail("clinic.admin@example.com"), false);
    assert.equal(stripSeededPublicLoginValue("email", "doctor@lumera.me"), "");
    assert.equal(stripSeededPublicLoginValue("email", "doc@clinic-a.example"), "doc@clinic-a.example");
    assert.equal(stripSeededPublicLoginValue("password", "Lumera@2026"), "");
    assert.equal(stripSeededPublicLoginValue("password", "user-chosen-secret"), "user-chosen-secret");
    assert.equal(stripSeededPublicLoginValue("phone", "+91 98234 55667"), "");
  });

  it("keeps WhatsApp/tel input digits-only with an optional leading plus", () => {
    assert.equal(sanitizePhoneDigits("abc"), "");
    assert.equal(sanitizePhoneDigits("+91 98234 55667"), "+919823455667");
    assert.equal(sanitizePhoneDigits("98234abc55667"), "9823455667");
    assert.equal(sanitizePhoneDigits("+"), "+");
    assert.equal(sanitizePhoneDigits("++91-90000-11111"), "+919000011111");
  });

  it("never persists demo emails when Remember is opted in", () => {
    const mem = new Map<string, string>();
    const prev = globalThis.window;
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => {
          mem.set(k, v);
        },
        removeItem: (k: string) => {
          mem.delete(k);
        },
      },
    };
    try {
      persistRememberedLoginEmail("doctor@lumera.me", true);
      assert.equal(mem.has(REMEMBER_EMAIL_KEY), false);
      persistRememberedLoginEmail("clinic.admin@example.com", true);
      assert.equal(readRememberedLoginEmail(), "clinic.admin@example.com");
      persistRememberedLoginEmail("clinic.admin@example.com", false);
      assert.equal(readRememberedLoginEmail(), "");
      mem.set(REMEMBER_EMAIL_KEY, "admin@lumera.me");
      assert.equal(readRememberedLoginEmail(), "");
    } finally {
      if (prev === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = prev;
    }
  });

  it("uses placeholders (not seeded useState values) on the public login page", () => {
    assert.match(loginPage, /emptyPublicLoginFields\(\)/);
    assert.match(loginPage, /placeholder=\{LOGIN_EMAIL_PLACEHOLDER\}/);
    assert.match(loginPage, /placeholder=\{LOGIN_PASSWORD_PLACEHOLDER\}/);
    assert.match(loginPage, /placeholder=\{LOGIN_WHATSAPP_PLACEHOLDER\}/);
    assert.equal(LOGIN_PASSWORD_PLACEHOLDER, "Password");
    assert.equal(LOGIN_WHATSAPP_PLACEHOLDER, "WhatsApp number");
    assert.doesNotMatch(LOGIN_PASSWORD_PLACEHOLDER, /•|●|Lumera@2026/);
    assert.doesNotMatch(LOGIN_WHATSAPP_PLACEHOLDER, /98234|\+91/);
    assert.match(loginPage, /placeholder=\{REGISTER_EMAIL_PLACEHOLDER\}/);
    assert.match(loginPage, /placeholder=\{REGISTER_PASSWORD_PLACEHOLDER\}/);
    assert.doesNotMatch(loginPage, /useState\(loginDemo \? "/);
    assert.doesNotMatch(loginPage, /useState\("doctor@lumera\.me"\)/);
    assert.doesNotMatch(loginPage, /useState\("Lumera@2026"\)/);
    assert.doesNotMatch(loginPage, /useState\("\+91 98234 55667"\)/);
    assert.doesNotMatch(loginPage, /defaultValue=/);
    assert.match(loginPage, /autoComplete="username"/);
    assert.match(loginPage, /autoComplete="current-password"/);
    assert.match(loginPage, /autoComplete="email"/);
    assert.match(loginPage, /autoComplete="new-password"/);
    assert.match(loginPage, /autoComplete="tel"/);
    assert.match(loginPage, /sanitizePhoneDigits/);
    assert.match(loginPage, /data-testid="admin-password-login-note"/);
    assert.match(loginPage, /data-testid="login-password"/);
    assert.match(loginPage, /data-testid="login-whatsapp"/);
    assert.match(loginPage, /useState\(publicLoginDefaults\.password\)/);
    assert.match(loginPage, /useState\(publicLoginDefaults\.whatsappPhone\)/);
  });

  it("keeps Remember email opt-in and hides public Admin chrome", () => {
    assert.match(loginPage, /useState\(Boolean\(rememberedEmail\)\)/);
    assert.doesNotMatch(loginPage, /useState\(true\)/);
    assert.doesNotMatch(loginPage, /handleAdminLogin/);
    assert.doesNotMatch(loginPage, /System Administrator/);
    assert.doesNotMatch(landingPage, />\s*Admin\s*</);
    assert.doesNotMatch(landingPage, /loginNext:\s*"admin"/);
    assert.match(landingPage, /loginMode:\s*"register"/);
    assert.match(landingPage, /Try for free/);
  });

  it("keeps the create-clinic card fluid on phone, tablet, and desktop", () => {
    const appShell = fs.readFileSync(path.join(__dirname, "../App.tsx"), "utf8");
    assert.match(appShell, /h-dvh/);
    assert.match(appShell, /min-h-0/);
    assert.match(loginPage, /overflow-x-hidden/);
    assert.match(loginPage, /overscroll-y-contain/);
    assert.match(loginPage, /mode === "register".*items-start/s);
    assert.match(loginPage, /grid grid-cols-1 md:grid-cols-2 gap-2/);
    assert.match(loginPage, /grid grid-cols-1 lg:grid-cols-2 gap-3/);
    assert.match(loginPage, /flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5/);
    assert.match(loginPage, /min-h-11/);
    assert.match(loginPage, /max-w-lg md:max-w-xl xl:max-w-2xl/);
    assert.match(loginPage, /register-sticky-actions/);
    assert.match(loginPage, /sticky bottom-0/);
    assert.match(loginPage, /safe-area-inset-bottom/);
    assert.match(loginPage, /form="create-clinic-form"/);
  });
});

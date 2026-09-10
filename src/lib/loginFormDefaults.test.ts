import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  emptyPublicLoginFields,
  isSeededDemoEmail,
  stripSeededPublicLoginValue,
} from "./loginFormDefaults";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loginPage = fs.readFileSync(path.join(__dirname, "../pages/LoginPage.tsx"), "utf8");

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

  it("uses placeholders (not seeded useState values) on the public login page", () => {
    assert.match(loginPage, /emptyPublicLoginFields\(\)/);
    assert.match(loginPage, /placeholder=\{LOGIN_EMAIL_PLACEHOLDER\}/);
    assert.match(loginPage, /placeholder=\{LOGIN_PASSWORD_PLACEHOLDER\}/);
    assert.match(loginPage, /placeholder=\{LOGIN_WHATSAPP_PLACEHOLDER\}/);
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
  });
});

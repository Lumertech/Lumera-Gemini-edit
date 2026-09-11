import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEMO_ACCOUNTS,
  DEMO_LOGIN_MATRIX,
  DEMO_PACK_ALIAS_LOGINS,
  DEMO_PASSWORD,
  PRODUCT_DEMO_EMAILS,
} from "./demoAccounts.ts";

const here = dirname(fileURLToPath(import.meta.url));
const loginSrc = readFileSync(join(here, "../pages/LoginPage.tsx"), "utf8");
const demoDocs = readFileSync(join(here, "../../docs/DEMO_ACCOUNTS.md"), "utf8");

describe("demo login matrix", () => {
  it("keeps the shared sandbox password", () => {
    assert.equal(DEMO_PASSWORD, "Lumera@2026");
  });

  it("seeds #55 sibling emails and lists #56 pack aliases in the picker", () => {
    const sibling = [
      "dentist@lumera.me",
      "physio@lumera.me",
      "wellness@lumera.me",
      "receptionist@lumera.me",
      "clinic.admin@lumera.me",
      "cardiology@lumera.me",
    ];
    for (const email of sibling) {
      assert.ok(DEMO_ACCOUNTS.some((a) => a.email === email), email);
    }
    const aliases = [
      "gp.doctor@lumera.me",
      "physio.doctor@lumera.me",
      "dentist.doctor@lumera.me",
      "spa.doctor@lumera.me",
    ];
    for (const email of aliases) {
      assert.ok(DEMO_PACK_ALIAS_LOGINS.some((a) => a.email === email), email);
      assert.ok(DEMO_LOGIN_MATRIX.some((a) => a.email === email), email);
      assert.equal(DEMO_ACCOUNTS.some((a) => a.email === email), false, `${email} must not be re-seeded by #55`);
    }
    assert.match(loginSrc, /DEMO_LOGIN_MATRIX/);
    assert.match(loginSrc, /data-testid="demo-account-picker"/);
  });

  it("lists Product table emails first and keeps dentist@ / physio@ as extras", () => {
    const emails = DEMO_LOGIN_MATRIX.map((a) => a.email);
    assert.deepEqual(emails.slice(0, PRODUCT_DEMO_EMAILS.length), [...PRODUCT_DEMO_EMAILS]);
    assert.ok(emails.indexOf("dentist@lumera.me") > emails.indexOf("dentist.doctor@lumera.me"));
    assert.ok(emails.indexOf("physio@lumera.me") > emails.indexOf("physio.doctor@lumera.me"));
    assert.ok(emails.indexOf("wellness@lumera.me") > emails.indexOf("spa.doctor@lumera.me"));
  });

  it("seed emails already match Individual vs Polyclinic vs Super Admin role model (#70)", () => {
    const admin = DEMO_ACCOUNTS.find((a) => a.email === "admin@lumera.me");
    const doctor = DEMO_ACCOUNTS.find((a) => a.email === "doctor@lumera.me");
    const reception = DEMO_ACCOUNTS.find((a) => a.email === "reception@lumera.me");
    const clinic = DEMO_ACCOUNTS.find((a) => a.email === "clinic.admin@lumera.me");
    assert.equal(admin?.role, "super_admin");
    assert.equal(doctor?.role, "doctor");
    assert.equal(doctor?.practiceType, "individual");
    assert.equal(reception?.role, "receptionist");
    assert.equal(reception?.practiceType, "individual");
    assert.equal(clinic?.role, "CLINIC_ADMIN");
    assert.equal(clinic?.practiceType, "polyclinic");
    assert.match(demoDocs, /already match/);
    assert.match(demoDocs, /Product #70/);
    assert.match(demoDocs, /doctor@lumera\.me/);
    assert.match(demoDocs, /clinic\.admin@lumera\.me/);
    assert.match(demoDocs, /support-only/);
    assert.doesNotMatch(demoDocs, /Super Admin owns Branches/);
  });
});

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
} from "./demoAccounts.ts";

const here = dirname(fileURLToPath(import.meta.url));
const loginSrc = readFileSync(join(here, "../pages/LoginPage.tsx"), "utf8");

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
});

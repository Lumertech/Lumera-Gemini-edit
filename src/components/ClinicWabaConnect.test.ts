import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("role-scoped WhatsApp Embedded Signup UI", () => {
  it("tenant clinic connect uses Meta Embedded Signup, not manual tokens", () => {
    const src = readFileSync(join(here, "ClinicWabaConnect.tsx"), "utf8");
    assert.match(src, /\/api\/integrations\/whatsapp\/embedded-signup/);
    assert.match(src, /launchEmbeddedSignupV4/);
    assert.match(src, /whatsapp_business_management/);
    assert.match(src, /whatsapp_business_messaging/);
    assert.match(src, /clinic-waba-status-badges/);
    assert.match(src, /Meta Business Verification/);
    assert.match(src, /WABA ID/);
    assert.match(src, /Phone Number Status/);
    assert.match(src, /shared test number/);
    assert.doesNotMatch(src, /metaAccessToken/);
    assert.doesNotMatch(src, /type="password"/);
    assert.match(src, /ravee@lumer\.me/);
    assert.match(src, /not a[\s\S]+certified Tech Provider/);
  });

  it("Super Admin Meta console keeps platform credentials and does not trigger Embedded Signup", () => {
    const meta = readFileSync(join(here, "admin", "AdminMetaTechProvider.tsx"), "utf8");
    assert.match(meta, /admin-meta-platform-credentials/);
    assert.match(meta, /\/api\/admin\/meta\/platform-credentials/);
    assert.match(meta, /does not trigger Embedded Signup/);
    assert.match(meta, /META_GRAPH_TOKEN/);
    assert.match(meta, /MasterAdmin Graph token/);
    assert.match(meta, /Platform WABA ID/);
    assert.match(meta, /admin-meta-graph-token/);
    assert.match(meta, /admin-meta-waba-id/);
    assert.match(meta, /Central webhook receiver/);
    assert.equal(meta.includes("launchEmbeddedSignupV4"), false);
    assert.equal(meta.includes("handleSimulateEmbeddedSignup"), false);
    assert.equal(meta.includes("simulate-embedded-signup"), false);
    assert.match(meta, /does not launch FB\.login/);
    assert.doesNotMatch(meta, /System User Access Token/);
  });
});

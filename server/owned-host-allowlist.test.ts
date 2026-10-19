import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_HOSTS,
  findUnownedHosts,
  scanUserFacingHosts,
} from "./owned-host-allowlist.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("owned host allowlist", () => {
  it("keeps a short justified list and names the hosts this product actually uses", () => {
    const hosts = ALLOWED_HOSTS.map((entry) => entry.host);
    for (const required of [
      "mylumera.in",
      "lumer.me",
      "graph.facebook.com",
      "facebook.com",
      "whatsapp.com",
      "wa.me",
      "fonts.googleapis.com",
      "fonts.gstatic.com",
    ]) {
      assert.ok(hosts.includes(required), `missing ${required}`);
    }
    assert.ok(ALLOWED_HOSTS.length <= 16, `allowlist grew to ${ALLOWED_HOSTS.length}`);
    for (const entry of ALLOWED_HOSTS) {
      assert.ok(entry.why.length > 20, entry.host);
    }
  });

  it("fails an unowned host and a payable upi intent, and exempts @lumera.me demo logins", () => {
    const sample = [
      'export const contact = "ravee@lumer.me";',
      'export const demo = "doctor@lumera.me";',
      'export const bad = "https://lumera.health/portal";',
      'export const mail = "care@lumeraclinic.in";',
      'const pay = "upi://pay?pa=demo@upi";',
      "https://www.facebook.com/dialog",
      "https://fonts.googleapis.com/css",
    ].join("\n");
    const hits = findUnownedHosts(sample, "src/example.tsx");
    const hosts = hits.map((hit) => `${hit.kind}:${hit.host}`);
    assert.ok(hosts.some((item) => item.includes("lumera.health")), hosts.join(","));
    assert.ok(hosts.some((item) => item.includes("lumeraclinic.in")), hosts.join(","));
    assert.ok(hosts.some((item) => item.startsWith("upi:")), hosts.join(","));
    assert.equal(hosts.some((item) => item.includes("lumera.me")), false);
    assert.equal(hosts.some((item) => item.includes("lumer.me")), false);
    assert.equal(hosts.some((item) => item.includes("facebook.com")), false);
    assert.equal(hosts.some((item) => item.includes("fonts.googleapis.com")), false);
  });

  it("does not treat a lumera.me URL as a demo-login exemption", () => {
    const hits = findUnownedHosts('const site = "https://lumera.me/login";\n', "src/example.tsx");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].host, "lumera.me");
  });

  it("leaves the PrescriptionWriter Rx QR lines for PR #164", () => {
    const source = [
      "export const other = `https://lumera.health/portal`;",
      "qrVerificationUrl: `https://lumera.health/rx/${rxNumber}`,",
      "<p>URL: https://lumera.health/rx/{rxNumber}</p>",
    ].join("\n");
    const hits = findUnownedHosts(source, "src/components/PrescriptionWriter.tsx");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 1);
    assert.equal(hits[0].host, "lumera.health");
  });

  it("scans user-facing source and fails closed on any other host", () => {
    const violations = scanUserFacingHosts(root);
    assert.deepEqual(
      violations,
      [],
      violations.map((item) => `${item.file}:${item.line} [${item.kind}] ${item.host}`).join("\n")
    );
  });
});

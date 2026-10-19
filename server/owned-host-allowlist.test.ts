import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_HOSTS,
  HOST_SUFFIXES,
  findUnownedHosts,
  hostAllowed,
  scanUserFacingHosts,
  scannedFiles,
  stripComments,
  unusedPr164Exemptions,
} from "./owned-host-allowlist.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("owned host allowlist", () => {
  it("keeps the compliance categories and a short justified list", () => {
    const hosts = ALLOWED_HOSTS.map((entry) => entry.host);
    for (const required of [
      "mylumera.in",
      "lumer.me",
      "example.com",
      "fonts.googleapis.com",
      "accounts.google.com",
      "fonts.gstatic.com",
      "facebook.com",
      "whatsapp.com",
      "wa.me",
      "abdm.gov.in",
      "ndhm.gov.in",
      "nrces.in",
      "hl7.org",
      "snomed.info",
      "loinc.org",
      "razorpay.com",
    ]) {
      assert.ok(hosts.includes(required), `missing ${required}`);
    }
    assert.ok(hosts.includes("clinic.example"), "missing clinic.example");
    assert.ok(ALLOWED_HOSTS.length <= 28, `allowlist grew to ${ALLOWED_HOSTS.length}`);
    for (const entry of ALLOWED_HOSTS) {
      assert.ok(entry.why.length > 20, entry.host);
    }
  });

  it("fails an unowned host and exempts only @lumera.me mailboxes", () => {
    const sample = [
      'export const contact = "ravee@lumer.me";',
      'export const demo = "doctor@lumera.me";',
      'export const legacy = "dr.malhotra@lumera.health";',
      'export const clinic = "care@example.com";',
      'export const bad = "https://lumera.health/portal";',
      'export const bare = "lumera.health/hep/{uhid}";',
      'export const mail = "care@lumeraclinic.in";',
      "https://www.facebook.com/dialog",
      "https://fonts.googleapis.com/css",
      "https://api.razorpay.com/v1",
      "https://images.unsplash.com/photo-1",
      "https://evil.googleapis.com/token",
    ].join("\n");
    const hits = findUnownedHosts(sample, "src/example.tsx");
    const hosts = hits.map((hit) => `${hit.kind}:${hit.host}`);
    assert.ok(hosts.some((item) => item.includes("lumera.health")), hosts.join(","));
    assert.ok(hosts.some((item) => item.includes("lumeraclinic.in")), hosts.join(","));
    assert.ok(hosts.some((item) => item.includes("bare:lumera.health")), hosts.join(","));
    assert.ok(hosts.some((item) => item.includes("unsplash.com")), hosts.join(","));
    assert.ok(hosts.some((item) => item.includes("evil.googleapis.com")), hosts.join(","));
    assert.equal(hosts.some((item) => item.includes("lumera.me")), false);
    assert.equal(hosts.some((item) => item.includes("lumer.me")), false);
    assert.equal(hosts.some((item) => item.includes("example.com")), false);
    assert.equal(hosts.some((item) => item.includes("facebook.com")), false);
    assert.equal(hosts.some((item) => item.includes("fonts.googleapis.com")), false);
    assert.equal(hosts.some((item) => item.includes("razorpay.com")), false);
  });

  it("keeps //host inside strings and only allows suffix families that are listed hosts", () => {
    const kept = stripComments('const label = "see //lumera.health/hep";\n// lumera.health in a comment\n');
    assert.match(kept, /lumera\.health\/hep/);
    assert.doesNotMatch(kept, /in a comment/);
    const hits = findUnownedHosts(kept, "src/example.tsx");
    assert.ok(hits.some((hit) => hit.kind === "bare" && hit.host === "lumera.health"));
    const allowed = new Set(ALLOWED_HOSTS.map((entry) => entry.host));
    for (const suffix of HOST_SUFFIXES) {
      assert.equal(allowed.has(suffix), true, suffix);
      assert.ok(suffix.split(".").filter(Boolean).length >= 2, suffix);
    }
    assert.equal(HOST_SUFFIXES.includes("unsplash.com"), false);
    assert.equal(HOST_SUFFIXES.includes("googleapis.com"), false);
    assert.equal(hostAllowed("fonts.googleapis.com"), true);
    assert.equal(hostAllowed("accounts.google.com"), true);
    assert.equal(hostAllowed("images.unsplash.com"), false);
    assert.equal(hostAllowed("evil.googleapis.com"), false);
  });

  it("does not treat a lumera.me URL as a demo-login exemption", () => {
    const hits = findUnownedHosts('const site = "https://lumera.me/login";\n', "src/example.tsx");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].host, "lumera.me");
  });

  it("leaves only the URL shapes PR #164 already replaces", () => {
    const lines = [
      "export const other = `https://lumera.health/portal`;",
      "qrVerificationUrl: `https://lumera.health/rx/${rxNumber}`,",
      "<p>URL: https://lumera.health/rx/{rxNumber}</p>",
    ];
    const hits = findUnownedHosts(lines.join("\n"), "src/components/PrescriptionWriter.tsx");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 1);
    assert.equal(hits[0].host, "lumera.health");
    const clinical = findUnownedHosts(
      'const payload = "https://lumera.health/rx/{{3}}";\nconst other = "https://lumera.health/account";\n',
      "src/data/clinicalData.ts"
    );
    assert.deepEqual(
      clinical.map((hit) => hit.line),
      [2]
    );
  });

  it("scans src, server, public, hosting, server.ts, and index.html, and fails closed on any other host", () => {
    const files = scannedFiles(root).map((file) => file.replace(/\\/g, "/"));
    assert.ok(files.some((file) => file.endsWith("/server.ts") || file.endsWith("/index.html")));
    assert.equal(
      unusedPr164Exemptions(root).join("\n"),
      "",
      "delete PR #164 exemptions that match nothing"
    );
    const violations = scanUserFacingHosts(root);
    assert.deepEqual(
      violations,
      [],
      violations.map((item) => `${item.file}:${item.line} [${item.kind}] ${item.host}`).join("\n")
    );
  });
});

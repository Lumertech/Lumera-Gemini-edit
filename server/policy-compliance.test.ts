import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApiRouter } from "./api.ts";
import {
  CMS_POLICY_UPSERTS,
  DATA_DELETION_INSTRUCTIONS_BODY,
  PRIVACY_POLICY_BODY,
  TERMS_OF_SERVICE_BODY,
} from "./cms-policy-seed.ts";
import { GOVERNMENT_DATA_REQUEST_POLICY_BODY } from "./government-data-request-policy.ts";
import {
  META_TECH_PROVIDER_STATEMENT,
  WHATSAPP_APP_REVIEW_SENTENCE,
  WHATSAPP_CLOUD_API_SECTION,
} from "../src/lib/metaStatus.ts";
import { ensureMetaTechProviderAndPolicies, getDb, initDatabase } from "./db.ts";
import { createMetaRouter } from "./meta.ts";
import { attachPublicPolicyHtml, PUBLIC_POLICY_HTML_PATHS } from "./policy-html.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function policySeedSource(): string {
  return [
    readRepo("server/cms-policy-seed.ts"),
    readRepo("server/db.ts"),
    readRepo("server/db-seed.ts"),
    readRepo("server/db-seed-maps.ts"),
    readRepo("server/db-seed-clinical.ts"),
    readRepo("server/db-seed-meta.ts"),
  ].join("\n");
}

function overclaimWithoutHonesty(src: string): string[] {
  const leftovers: string[] = [];
  const lines = src.split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hasOfficial = /official Meta Tech Provider/i.test(line);
    const hasAuthorized = /Authorized Tech Provider/i.test(line);
    const hasBsp = /Business Solution Provider/i.test(line);
    // No honesty-window exemption: a nearby "not a certified" does not excuse BSP.
    if (hasOfficial || hasAuthorized || hasBsp) {
      leftovers.push(`L${i + 1}: ${line.trim()}`);
    }
  }
  return leftovers;
}

/**
 * Public copy Meta reviewers and clinics can read.
 * PR #117's stripHonestTechProviderNegation is not applied: it would hide
 * "not a certified…" from the certified ban. The only exemption is the
 * physio biography at server/db-seed-maps.ts:61.
 */
const PUBLIC_COPY_SURFACES = [
  "server/cms-policy-seed.ts",
  "server/db.ts",
  "server/db-seed.ts",
  "server/db-seed-maps.ts",
  "server/db-seed-clinical.ts",
  "server/db-seed-meta.ts",
  "server/government-data-request-policy.ts",
  "server/policy-html.ts",
  "src/pages/PolicyPage.tsx",
  "src/components/LandingPage.tsx",
  "server/pricing-html.ts",
  "server/pricing-catalog.ts",
  "src/lib/pricingCopy.ts",
  "src/lib/pricingModel.ts",
  "src/pages/PricingPage.tsx",
  "index.html",
];

const STALE_TECH_PROVIDER_COPY =
  /not a certified (Meta )?Tech Provider|not (Meta )?Tech Provider certif|building toward Meta Tech Provider|Tech Provider path|App Review (is )?not submitted/i;

const TECH_PROVIDER_OVERCLAIM =
  /Meta (Business )?partner|official WhatsApp partner|Solution Partner|Business Solution Provider|\bBSP\b|official Meta|Official Tech Provider|Authorized Tech Provider|Tech Provider Verified|Meta[- ](certified|approved|verified)|App Review (approved|complete)/i;

const CERTIFIED_WORD = /\bcertified\b/i;
const PHYSIO_BIO_REL = "server/db-seed-maps.ts";
const PHYSIO_BIO_LINE = 61;
const PHYSIO_BIO_TEXT =
  "Lead Musculoskeletal & Sports Physiotherapist certified in Spinal Mobilization, Dry Needling & Post-Operative Knee Rehab.";

/** #18/#47 theatre this PR must not reintroduce on landing/CMS/policy surfaces. */
const RESKIM_THEATRE: Array<{ id: string; re: RegExp }> = [
  { id: "Certified M1-M3", re: /Certified M1.?M3|ABDM M1,\s*M2,\s*M3 Certified|M1.?M3 Certified/i },
  { id: "Official TP", re: /Official Tech Provider|Official Meta WhatsApp Tech Provider|official Meta Tech Provider/i },
  { id: "HIPAA Grade", re: /HIPAA Grade|HIPAA-grade|\bHIPAA\b/i },
  { id: "feat-6 ABDM Compliant", re: /ABDM Compliant/i },
];

const RESKIM_SURFACES = [
  "src/components/LandingPage.tsx",
  "src/pages/PolicyPage.tsx",
  "server/cms-policy-seed.ts",
  "server/government-data-request-policy.ts",
  "server/db.ts",
  "server/policy-html.ts",
  "server/meta.ts",
];

describe("Compliance #26 re-skim bar", () => {
  it("1. does not reintroduce #18/#47 Certified M1-M3 / Official TP / HIPAA Grade / feat-6 ABDM Compliant", () => {
    const leftovers: string[] = [];
    for (const rel of RESKIM_SURFACES) {
      const lines = readRepo(rel).split(/\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const rule of RESKIM_THEATRE) {
          if (!rule.re.test(line)) continue;
          leftovers.push(`${rel}:${i + 1} [${rule.id}] ${line.trim()}`);
        }
      }
    }
    assert.deepEqual(leftovers, [], leftovers.join("\n"));

    const feat6 = [
      readRepo("server/db.ts"),
      readRepo("server/db-seed.ts"),
      readRepo("server/db-seed-maps.ts"),
      readRepo("server/db-seed-clinical.ts"),
      readRepo("server/db-seed-meta.ts"),
    ].join("\n");
    assert.match(feat6, /id = 'feat-6'/);
    assert.match(feat6, /title: "ABDM records"/);
    assert.equal(/ABDM-aligned \(NHA sandbox\)/.test(feat6), false);
    assert.equal(/feat-6[\s\S]{0,400}ABDM Compliant/i.test(feat6), false);
  });

  it("4. documents APP_URL=https://www.mylumera.in so deletion callback urls use www", () => {
    const envEx = readRepo(".env.example");
    const runbook = readRepo("docs/FIREBASE_CLOUD_RUN_DEPLOY.md");
    const meta = readRepo("server/meta.ts");
    assert.match(envEx, /APP_URL=https:\/\/www\.mylumera\.in/);
    assert.match(envEx, /data-deletion confirmation URLs/);
    assert.match(runbook, /APP_URL=https:\/\/www\.mylumera\.in/);
    assert.match(runbook, /deletion confirmation/);
    assert.match(meta, /APP_URL=https:\/\/www\.mylumera\.in/);
    assert.match(meta, /appPublicUrl/);
  });
});

describe("Compliance #26 policy seed grep", () => {
  it("fails overclaim phrases; requires the Tech Provider statement, STOP, and absolute deletion URL", () => {
    const src = policySeedSource();
    assert.deepEqual(overclaimWithoutHonesty(src), []);
    assert.equal(/official Meta Tech Provider/i.test(src), false);
    assert.equal(/Authorized Tech Provider/i.test(src), false);
    assert.match(src, /\bSTOP\b/);
    assert.match(src, /https:\/\/www\.mylumera\.in\/api\/meta\/data-deletion/);
    assert.equal(
      META_TECH_PROVIDER_STATEMENT,
      "Lumera Solutions LLP is a Meta Tech Provider for the WhatsApp Business Platform."
    );
    assert.equal(PRIVACY_POLICY_BODY.includes(META_TECH_PROVIDER_STATEMENT), true);
    assert.equal(PRIVACY_POLICY_BODY.includes(WHATSAPP_CLOUD_API_SECTION), true);
    assert.equal(TERMS_OF_SERVICE_BODY.includes(META_TECH_PROVIDER_STATEMENT), true);
    assert.equal(TERMS_OF_SERVICE_BODY.includes(WHATSAPP_CLOUD_API_SECTION), true);
    assert.equal(TERMS_OF_SERVICE_BODY.includes("This does not mean Meta endorses Lumera."), true);
    assert.equal(DATA_DELETION_INSTRUCTIONS_BODY.includes(META_TECH_PROVIDER_STATEMENT), true);
    assert.equal(DATA_DELETION_INSTRUCTIONS_BODY.includes(WHATSAPP_APP_REVIEW_SENTENCE), true);
    assert.equal(GOVERNMENT_DATA_REQUEST_POLICY_BODY.includes(META_TECH_PROVIDER_STATEMENT), true);
    assert.match(PRIVACY_POLICY_BODY, /replying \*\*STOP\*\*/);
    assert.match(DATA_DELETION_INSTRUCTIONS_BODY, /https:\/\/www\.mylumera\.in\/api\/meta\/data-deletion/);
    assert.ok(CMS_POLICY_UPSERTS.some((row) => row.slug === "privacy-policy"));
  });

  it("bans stale Tech Provider denials and widened overclaims on public surfaces", () => {
    const leftovers: string[] = [];
    for (const rel of PUBLIC_COPY_SURFACES) {
      const lines = readRepo(rel).split(/\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const n = i + 1;
        if (STALE_TECH_PROVIDER_COPY.test(line)) {
          leftovers.push(`${rel}:${n} stale: ${line.trim()}`);
        }
        if (TECH_PROVIDER_OVERCLAIM.test(line)) {
          leftovers.push(`${rel}:${n} overclaim: ${line.trim()}`);
        }
        if (!CERTIFIED_WORD.test(line)) continue;
        if (rel === PHYSIO_BIO_REL && n === PHYSIO_BIO_LINE) {
          if (line.includes(PHYSIO_BIO_TEXT)) continue;
          leftovers.push(`${rel}:${n} physio bio exemption did not match: ${line.trim()}`);
          continue;
        }
        leftovers.push(`${rel}:${n} certified: ${line.trim()}`);
      }
    }
    assert.deepEqual(leftovers, [], leftovers.join("\n"));
  });

  it("founder lock: public policy contacts are ravee@lumer.me only", () => {
    const seed = readRepo("server/cms-policy-seed.ts");
    const policyPage = readRepo("src/pages/PolicyPage.tsx");
    const retired = [
      "dpo@lumera.me",
      "compliance@lumera.health",
      "privacy@lumera.health",
      "legal@lumera.health",
    ];
    for (const email of retired) {
      assert.equal(seed.includes(email), false, `seed still lists ${email}`);
      assert.equal(policyPage.includes(email), false, `PolicyPage still lists ${email}`);
    }
    assert.match(PRIVACY_POLICY_BODY, /ravee@lumer\.me/);
    assert.match(TERMS_OF_SERVICE_BODY, /ravee@lumer\.me/);
    assert.match(DATA_DELETION_INSTRUCTIONS_BODY, /ravee@lumer\.me/);
    assert.match(GOVERNMENT_DATA_REQUEST_POLICY_BODY, /ravee@lumer\.me/);
    assert.match(policyPage, /ravee@lumer\.me/);
    const govPolicy = readRepo("server/government-data-request-policy.ts");
    for (const email of retired) {
      assert.equal(govPolicy.includes(email), false, `government policy still lists ${email}`);
    }
    assert.equal(
      /dpo@|compliance@lumera|privacy@lumera|legal@lumera/i.test(`${seed}\n${policyPage}\n${govPolicy}`),
      false
    );
  });

  it("government data request policy covers Meta Data Handling four areas", () => {
    assert.match(GOVERNMENT_DATA_REQUEST_POLICY_BODY, /## Required Legal Review/);
    assert.match(GOVERNMENT_DATA_REQUEST_POLICY_BODY, /## Challenging Unlawful Requests/);
    assert.match(GOVERNMENT_DATA_REQUEST_POLICY_BODY, /## Data Minimization/);
    assert.match(GOVERNMENT_DATA_REQUEST_POLICY_BODY, /## Documentation & Record-Keeping/);
    assert.match(GOVERNMENT_DATA_REQUEST_POLICY_BODY, /before.*any data is searched/i);
    assert.match(GOVERNMENT_DATA_REQUEST_POLICY_BODY, /absolute minimum personal data necessary/);
    assert.match(GOVERNMENT_DATA_REQUEST_POLICY_BODY, /challenge, object to, or contest/i);
    assert.match(PRIVACY_POLICY_BODY, /government-data-request-policy/);
    assert.ok(CMS_POLICY_UPSERTS.some((row) => row.slug === "government-data-request-policy"));
    assert.ok(CMS_POLICY_UPSERTS.some((row) => row.slug === "government-requests"));
  });
});

describe("Compliance #26 public policy HTML + deletion-status", () => {
  let port = 0;
  let server: Server | undefined;
  const prevAppUrl = process.env.APP_URL;

  before(async () => {
    process.env.APP_URL = "https://www.mylumera.in";
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-policy-compliance";
    initDatabase();
    getDb()
      .prepare("UPDATE cms_policies SET body = ? WHERE slug = ?")
      .run(
        "official Meta Tech Provider / Business Solution Provider — Authorized Tech Provider",
        "privacy-policy"
      );
    ensureMetaTechProviderAndPolicies(getDb());

    const app = express();
    app.use(express.json());
    app.use("/api", createApiRouter());
    app.use("/api/meta", createMetaRouter());
    attachPublicPolicyHtml(app);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const addr = server!.address() as AddressInfo;
    port = addr.port;
  });

  after(async () => {
    if (prevAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prevAppUrl;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("force-upsert replaces overclaim privacy rows on boot", () => {
    const row = getDb()
      .prepare("SELECT body FROM cms_policies WHERE slug = ?")
      .get("privacy-policy") as { body: string };
    assert.equal(row.body.includes(META_TECH_PROVIDER_STATEMENT), true);
    assert.equal(/official Meta Tech Provider/i.test(row.body), false);
    assert.equal(/Authorized Tech Provider/i.test(row.body), false);
    assert.match(row.body, /\bSTOP\b/);
    assert.match(row.body, /ravee@lumer\.me/);
    assert.equal(/dpo@lumera\.me|compliance@lumera\.health|privacy@lumera\.health|legal@lumera\.health/.test(row.body), false);
  });

  it("GET policy HTML embeds cms body (not an empty SPA shell)", async () => {
    for (const p of PUBLIC_POLICY_HTML_PATHS) {
      const res = await fetch(`http://127.0.0.1:${port}${p}`);
      assert.equal(res.status, 200, p);
      assert.match(res.headers.get("content-type") || "", /html/i);
      const html = await res.text();
      const description = html.match(/<meta name="description" content="([^"]*)"/);
      assert.ok(description, `${p} meta description`);
      assert.equal(description[1].includes(META_TECH_PROVIDER_STATEMENT), true, `${p} meta description`);
      assert.equal(
        description[1].includes("Clinics connect their own WhatsApp Business accounts."),
        true,
        `${p} meta description clinics`
      );
      const notice = html.match(/<p class="notice">([\s\S]*?)<\/p>/);
      assert.ok(notice, `${p} notice`);
      assert.equal(notice[1].includes(META_TECH_PROVIDER_STATEMENT), true, `${p} notice`);
      assert.equal(
        notice[1].includes("Clinics connect their own WhatsApp Business accounts."),
        true,
        `${p} notice clinics`
      );
      const article = html.match(/<article>([\s\S]*?)<\/article>/);
      assert.ok(article, `${p} body`);
      assert.equal(article[1].includes(META_TECH_PROVIDER_STATEMENT), true, `${p} body`);
      assert.equal(/id="root"/.test(html), false, `${p} should not be the Vite SPA shell`);
      assert.match(html, /ravee@lumer\.me/);
      assert.equal(/dpo@lumera\.me|compliance@lumera\.health|privacy@lumera\.health|legal@lumera\.health/.test(html), false);
      if (p === "/privacy-policy") {
        assert.match(html, /\bSTOP\b/);
        assert.match(html, /DPDP/i);
        assert.match(html, /data-testid="policy-back"/);
        assert.match(html, /href="\/"[^>]*>Back/);
      }
      if (p === "/data-deletion-instructions") {
        assert.match(html, /https:\/\/www\.mylumera\.in\/api\/meta\/data-deletion/);
      }
      if (p === "/government-data-request-policy") {
        assert.match(html, /Required Legal Review/);
        assert.match(html, /Challenging Unlawful Requests/);
        assert.match(html, /Data Minimization/);
        assert.match(html, /Documentation &amp; Record-Keeping/);
        assert.match(html, /absolute minimum personal data necessary/);
      }
    }
  });

  it("GET /api/public/policies/:slug returns the honest seeded bodies", async () => {
    for (const slug of [
      "privacy-policy",
      "terms-of-service",
      "data-deletion-instructions",
      "government-data-request-policy",
    ]) {
      const res = await fetch(`http://127.0.0.1:${port}/api/public/policies/${slug}`);
      assert.equal(res.status, 200, slug);
      const json = (await res.json()) as { slug: string; body: string; title: string };
      assert.equal(json.slug, slug);
      assert.equal(json.body.includes(META_TECH_PROVIDER_STATEMENT), true);
      assert.match(json.body, /ravee@lumer\.me/);
      assert.equal(/dpo@lumera\.me|compliance@lumera\.health|privacy@lumera\.health|legal@lumera\.health/.test(json.body), false);
      if (slug === "privacy-policy") assert.match(json.body, /\bSTOP\b/);
      if (slug === "data-deletion-instructions") {
        assert.match(json.body, /https:\/\/www\.mylumera\.in\/api\/meta\/data-deletion/);
      }
      if (slug === "government-data-request-policy") {
        assert.match(json.body, /## Required Legal Review/);
        assert.match(json.body, /## Challenging Unlawful Requests/);
        assert.match(json.body, /## Data Minimization/);
        assert.match(json.body, /## Documentation & Record-Keeping/);
      }
    }
  });

  it("GET data-deletion-status for an arbitrary code is never COMPLETED", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/meta/data-deletion-status?code=DEL-TEST`);
    assert.equal(res.status, 404);
    const json = (await res.json()) as { status?: string; confirmationCode?: string };
    assert.equal(json.confirmationCode, "DEL-TEST");
    assert.equal(String(json.status || "").toUpperCase() === "COMPLETED", false);
    assert.equal(json.status, "not_found");
  });

  it("POST data-deletion uses APP_URL and only stored codes can be queried", async () => {
    const created = await fetch(`http://127.0.0.1:${port}/api/meta/data-deletion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: "policy-compliance-test" }),
    });
    assert.equal(created.status, 200);
    const payload = (await created.json()) as { url?: string; confirmation_code?: string };
    assert.match(String(payload.url || ""), /^https:\/\/www\.mylumera\.in\/data-deletion-instructions\?code=/);
    const code = String(payload.confirmation_code || "");
    assert.match(code, /^DEL-/);

    const known = await fetch(
      `http://127.0.0.1:${port}/api/meta/data-deletion-status?code=${encodeURIComponent(code)}`
    );
    assert.equal(known.status, 200);
    const knownJson = (await known.json()) as { status?: string; confirmationCode?: string };
    assert.equal(knownJson.confirmationCode, code);
    assert.equal(knownJson.status, "pending");
    assert.equal(String(knownJson.status).toUpperCase() === "COMPLETED", false);

    const missing = await fetch(
      `http://127.0.0.1:${port}/api/meta/data-deletion-status?code=DEL-NOT-A-REAL-CODE`
    );
    assert.equal(missing.status, 404);
    const missingJson = (await missing.json()) as { status?: string };
    assert.equal(missingJson.status, "not_found");
  });
});

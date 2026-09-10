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
import { ensureMetaTechProviderAndPolicies, getDb, initDatabase } from "./db.ts";
import { createMetaRouter } from "./meta.ts";
import { attachPublicPolicyHtml, PUBLIC_POLICY_HTML_PATHS } from "./policy-html.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function policySeedSource(): string {
  return [readRepo("server/cms-policy-seed.ts"), readRepo("server/db.ts")].join("\n");
}

function overclaimWithoutHonesty(src: string): string[] {
  const leftovers: string[] = [];
  const lines = src.split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hasOfficial = /official Meta Tech Provider/i.test(line);
    const hasAuthorized = /Authorized Tech Provider/i.test(line);
    const hasBsp = /Business Solution Provider/i.test(line);
    if (!hasOfficial && !hasAuthorized && !hasBsp) continue;
    const window = lines.slice(Math.max(0, i - 2), i + 3).join(" ");
    const honest = /not a certified/i.test(window) || /not certified/i.test(window);
    if (hasOfficial || hasAuthorized || (hasBsp && !honest)) {
      leftovers.push(`L${i + 1}: ${line.trim()}`);
    }
  }
  return leftovers;
}

describe("Compliance #26 policy seed grep", () => {
  it("fails overclaim phrases without not-certified honesty; requires STOP and absolute deletion URL", () => {
    const src = policySeedSource();
    assert.deepEqual(overclaimWithoutHonesty(src), []);
    assert.equal(/official Meta Tech Provider/i.test(src), false);
    assert.equal(/Authorized Tech Provider/i.test(src), false);
    assert.match(src, /\bSTOP\b/);
    assert.match(src, /https:\/\/www\.mylumera\.in\/api\/meta\/data-deletion/);
    assert.match(src, /not a certified Meta Tech Provider/i);
    assert.match(src, /App Review is not submitted/);
    assert.match(PRIVACY_POLICY_BODY, /replying \*\*STOP\*\*/);
    assert.match(TERMS_OF_SERVICE_BODY, /not a certified Meta Tech Provider/i);
    assert.match(DATA_DELETION_INSTRUCTIONS_BODY, /https:\/\/www\.mylumera\.in\/api\/meta\/data-deletion/);
    assert.ok(CMS_POLICY_UPSERTS.some((row) => row.slug === "privacy-policy"));
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
    assert.match(row.body, /not a certified Meta Tech Provider/i);
    assert.equal(/official Meta Tech Provider/i.test(row.body), false);
    assert.equal(/Authorized Tech Provider/i.test(row.body), false);
    assert.match(row.body, /\bSTOP\b/);
  });

  it("GET policy HTML embeds cms body (not an empty SPA shell)", async () => {
    for (const p of PUBLIC_POLICY_HTML_PATHS) {
      const res = await fetch(`http://127.0.0.1:${port}${p}`);
      assert.equal(res.status, 200, p);
      assert.match(res.headers.get("content-type") || "", /html/i);
      const html = await res.text();
      assert.match(html, /not a certified Meta Tech Provider/i);
      assert.equal(/id="root"/.test(html), false, `${p} should not be the Vite SPA shell`);
      if (p === "/privacy-policy") {
        assert.match(html, /\bSTOP\b/);
        assert.match(html, /DPDP/i);
      }
      if (p === "/data-deletion-instructions") {
        assert.match(html, /https:\/\/www\.mylumera\.in\/api\/meta\/data-deletion/);
      }
    }
  });

  it("GET /api/public/policies/:slug returns the honest seeded bodies", async () => {
    for (const slug of ["privacy-policy", "terms-of-service", "data-deletion-instructions"]) {
      const res = await fetch(`http://127.0.0.1:${port}/api/public/policies/${slug}`);
      assert.equal(res.status, 200, slug);
      const json = (await res.json()) as { slug: string; body: string; title: string };
      assert.equal(json.slug, slug);
      assert.match(json.body, /not a certified Meta Tech Provider/i);
      if (slug === "privacy-policy") assert.match(json.body, /\bSTOP\b/);
      if (slug === "data-deletion-instructions") {
        assert.match(json.body, /https:\/\/www\.mylumera\.in\/api\/meta\/data-deletion/);
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

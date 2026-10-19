import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request } from "express";
import { createLumeraApp } from "./create-app.ts";
import { initDatabase } from "./db.ts";
import {
  classifyHubSignatureHeader,
  decideWebhookSignature,
  logMetaWebhookSignatureVerified,
  metaHubSignatureHeader,
  resetMetaWebhookSignatureVerifiedLogForTests,
  verifyMetaHubSignature,
} from "./meta-security.ts";

const SECRET = "meta-webhook-secret-aaa";
const FACEBOOK_SECRET = "facebook-webhook-secret-bbb";
const WRONG_SECRET = "wrong-webhook-secret-ccc";

/**
 * Escaped slash, unicode escape, literal Hindi, and an emoji.
 * JSON.parse + JSON.stringify does not reproduce these bytes.
 */
const RAW_WEBHOOK = Buffer.from(
  '{"object":"whatsapp_business_account","entry":[{"id":"waba\\/1","changes":[{"value":{"messages":[{"from":"9198","text":{"body":"हिंदी 😀 \\u0939"}}]}}]}]}',
  "utf8"
);

function sign(secret: string, body: Buffer | string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function saveEnv(names: string[]): () => void {
  const prev: Record<string, string | undefined> = {};
  for (const name of names) prev[name] = process.env[name];
  return () => {
    for (const name of names) {
      if (prev[name] === undefined) delete process.env[name];
      else process.env[name] = prev[name];
    }
  };
}

type LogCapture = { warn: string; info: string; debug: string };

async function withLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: LogCapture }> {
  resetMetaWebhookSignatureVerifiedLogForTests();
  const warn: string[] = [];
  const info: string[] = [];
  const debug: string[] = [];
  const origWarn = console.warn;
  const origInfo = console.info;
  const origDebug = console.debug;
  console.warn = (...args: unknown[]) => {
    warn.push(args.map((part) => String(part)).join(" "));
  };
  console.info = (...args: unknown[]) => {
    info.push(args.map((part) => String(part)).join(" "));
  };
  console.debug = (...args: unknown[]) => {
    debug.push(args.map((part) => String(part)).join(" "));
  };
  try {
    const result = await fn();
    return { result, logs: { warn: warn.join("\n"), info: info.join("\n"), debug: debug.join("\n") } };
  } finally {
    console.warn = origWarn;
    console.info = origInfo;
    console.debug = origDebug;
  }
}

function assertNoSecrets(text: string) {
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes(FACEBOOK_SECRET), false);
  assert.equal(text.includes(WRONG_SECRET), false);
  assert.equal(text.includes("हिंदी"), false);
  assert.equal(text.includes(RAW_WEBHOOK.toString("utf8")), false);
}

describe("Meta webhook signature unit", () => {
  it("compares sha256= with timing-safe hex and rejects a re-serialised body", () => {
    const signature = sign(SECRET, RAW_WEBHOOK);
    assert.equal(verifyMetaHubSignature(RAW_WEBHOOK, signature, SECRET), true);
    assert.equal(verifyMetaHubSignature(RAW_WEBHOOK, signature.toUpperCase(), SECRET), true);
    const roundTrip = JSON.stringify(JSON.parse(RAW_WEBHOOK.toString("utf8")));
    assert.notEqual(roundTrip, RAW_WEBHOOK.toString("utf8"));
    assert.equal(verifyMetaHubSignature(roundTrip, signature, SECRET), false);
    assert.equal(verifyMetaHubSignature(RAW_WEBHOOK, undefined, SECRET), false);
    assert.equal(verifyMetaHubSignature(RAW_WEBHOOK, "sha1=abcd", SECRET), false);
    assert.equal(classifyHubSignatureHeader(undefined), "missing");
    assert.equal(classifyHubSignatureHeader("sha256=abcd"), "malformed");
    assert.equal(classifyHubSignatureHeader(signature), "present");
  });

  it("reads X-Hub-Signature-256 through req.get, which lowercases the name", () => {
    const signature = sign(SECRET, RAW_WEBHOOK);
    const req = {
      get(name: string) {
        assert.equal(name.toLowerCase(), "x-hub-signature-256");
        return signature;
      },
      headers: {},
    } as unknown as Request;
    assert.equal(metaHubSignatureHeader(req), signature);
  });

  it("names missing header and mismatch separately and does not accept unsigned in production", () => {
    const missing = decideWebhookSignature({
      rawBody: RAW_WEBHOOK,
      signatureHeader: undefined,
      appSecret: SECRET,
      production: true,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.status, 403);
      assert.equal(missing.reason, "missing_header");
    }

    const mismatch = decideWebhookSignature({
      rawBody: RAW_WEBHOOK,
      signatureHeader: sign(WRONG_SECRET, RAW_WEBHOOK),
      appSecret: SECRET,
      production: true,
    });
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) {
      assert.equal(mismatch.status, 403);
      assert.equal(mismatch.reason, "mismatch");
    }

    const noSecret = decideWebhookSignature({
      rawBody: RAW_WEBHOOK,
      signatureHeader: undefined,
      appSecret: "",
      production: true,
      allowUnsignedDevFlag: true,
    });
    assert.equal(noSecret.ok, false);
    if (!noSecret.ok) {
      assert.equal(noSecret.status, 500);
      assert.equal(noSecret.error, "Webhook signature verification is unavailable.");
      assert.doesNotMatch(noSecret.error, /META_APP_SECRET|FACEBOOK_APP_SECRET|WHATSAPP_APP_SECRET/);
    }
  });

  it("logs a verified signature at debug once per secret env name", () => {
    resetMetaWebhookSignatureVerifiedLogForTests();
    const lines: string[] = [];
    const origDebug = console.debug;
    console.debug = (...args: unknown[]) => {
      lines.push(args.map((part) => String(part)).join(" "));
    };
    try {
      logMetaWebhookSignatureVerified("META_APP_SECRET");
      logMetaWebhookSignatureVerified("META_APP_SECRET");
      logMetaWebhookSignatureVerified("FACEBOOK_APP_SECRET");
    } finally {
      console.debug = origDebug;
      resetMetaWebhookSignatureVerifiedLogForTests();
    }
    assert.deepEqual(
      lines,
      [
        "[Meta Webhook] Signature verified. secretEnv=META_APP_SECRET",
        "[Meta Webhook] Signature verified. secretEnv=FACEBOOK_APP_SECRET",
      ]
    );
    assert.equal(lines.join("\n").includes(SECRET), false);
  });
});

describe("POST /api/meta/webhook through createLumeraApp", () => {
  let server: Server | undefined;
  let port = 0;
  let restore: () => void = () => {};

  before(async () => {
    restore = saveEnv([
      "NODE_ENV",
      "ALLOWED_ORIGINS",
      "APP_URL",
      "JWT_SECRET",
      "META_APP_SECRET",
      "FACEBOOK_APP_SECRET",
      "WHATSAPP_APP_SECRET",
      "META_WEBHOOK_ALLOW_UNSIGNED",
    ]);
    process.env.NODE_ENV = "test";
    initDatabase();
    process.env.NODE_ENV = "production";
    process.env.ALLOWED_ORIGINS = "https://www.mylumera.in";
    process.env.APP_URL = "https://www.mylumera.in";
    process.env.JWT_SECRET = "webhook-suite-jwt-secret-not-for-meta";
    delete process.env.META_WEBHOOK_ALLOW_UNSIGNED;
    process.env.META_APP_SECRET = SECRET;
    delete process.env.FACEBOOK_APP_SECRET;
    delete process.env.WHATSAPP_APP_SECRET;

    const app = createLumeraApp();
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", () => resolve());
      server!.once("error", reject);
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("server did not bind a port");
    port = addr.port;
  });

  after(async () => {
    restore();
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
  });

  function useSecrets(meta?: string, facebook?: string, whatsapp?: string) {
    if (meta === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = meta;
    if (facebook === undefined) delete process.env.FACEBOOK_APP_SECRET;
    else process.env.FACEBOOK_APP_SECRET = facebook;
    if (whatsapp === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = whatsapp;
  }

  async function postRaw(body: Buffer, headers: Record<string, string> = {}, urlPath = "/api/meta/webhook") {
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "facebookexternalua",
        ...headers,
      },
      body,
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = {};
    }
    return { status: res.status, json, text };
  }

  it("mounts raw-body capture before express.json in the app factory", () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "create-app.ts"), "utf8");
    const boot = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server.ts"), "utf8");
    const mountOrder = [
      "attachHttpSecurity(app)",
      "app.use(metaWebhookRawBody)",
      "express.json(",
      "protectWhatsAppDashboard(createWhatsAppRouter())",
      "createLiveRegistrationRouter()",
      "createApiRouter()",
      "attachPublicPricingHtml(app)",
      "mountGeminiClinicalRoutes(app)",
      "attachUnknownApiJsonNotFound(app)",
    ];
    let previous = -1;
    for (const marker of mountOrder) {
      const at = src.indexOf(marker);
      assert.ok(at > previous, `${marker} must stay in main's mount order`);
      previous = at;
    }
    assert.equal(src.indexOf("express.json("), src.lastIndexOf("express.json("));
    assert.match(src, /if \(Buffer\.isBuffer\(request\.rawBody\)\) return;/);
    const securitySrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "meta-security.ts"), "utf8");
    assert.match(securitySrc, /limit: "1mb"/);
    assert.match(boot, /createLumeraApp\(/);
    assert.ok(boot.indexOf("createLumeraApp()") < boot.indexOf("attachProductionSpaFallback(app)"));
    assert.equal(boot.includes("express.json("), false);
    const metaSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "meta.ts"), "utf8");
    assert.equal(metaSrc.includes("JSON.stringify(req.body"), false);
  });

  it("accepts the exact unicode bytes and rejects the re-serialised form", async () => {
    useSecrets(SECRET);
    const roundTrip = Buffer.from(JSON.stringify(JSON.parse(RAW_WEBHOOK.toString("utf8"))));
    assert.equal(roundTrip.equals(RAW_WEBHOOK), false);

    const good = await withLogs(() => postRaw(RAW_WEBHOOK, { "X-Hub-Signature-256": sign(SECRET, RAW_WEBHOOK) }));
    assert.equal(good.result.status, 200, good.result.text);
    assert.equal(good.result.json.status, "EVENT_RECEIVED");
    assert.match(good.logs.debug, /secretEnv=META_APP_SECRET/);
    assert.equal(good.logs.info.includes("Signature verified"), false);
    assert.match(good.logs.warn, /Unknown phone_number_id/);
    assertNoSecrets(`${good.logs.warn}\n${good.logs.info}\n${good.logs.debug}`);

    const alias = await postRaw(RAW_WEBHOOK, { "X-Hub-Signature-256": sign(SECRET, RAW_WEBHOOK) }, "/meta/webhook");
    assert.equal(alias.status, 200, alias.text);

    const reserialized = await withLogs(() =>
      postRaw(RAW_WEBHOOK, { "X-Hub-Signature-256": sign(SECRET, roundTrip) })
    );
    assert.equal(reserialized.result.status, 403);
    assert.match(reserialized.logs.warn, /reason=mismatch/);
    assert.match(reserialized.logs.warn, /secretEnv=META_APP_SECRET/);
    assertNoSecrets(reserialized.logs.warn);
  });

  it("accepts a signed text/plain body because HMAC uses the raw buffer, not the JSON parser", async () => {
    useSecrets(SECRET);
    const res = await postRaw(RAW_WEBHOOK, {
      "Content-Type": "text/plain",
      "X-Hub-Signature-256": sign(SECRET, RAW_WEBHOOK),
    });
    assert.equal(res.status, 200, res.text);
  });

  it("returns 403 for a tampered body, a missing header, a malformed header, and a wrong secret", async () => {
    useSecrets(SECRET);
    const signature = sign(SECRET, RAW_WEBHOOK);

    const tampered = Buffer.from(RAW_WEBHOOK);
    const fromAt = tampered.indexOf("9198");
    assert.ok(fromAt > 0);
    tampered.write("9199", fromAt, "utf8");
    const tamperedValid = await withLogs(() => postRaw(tampered, { "X-Hub-Signature-256": signature }));
    assert.equal(tamperedValid.result.status, 403);
    assert.match(tamperedValid.logs.warn, /reason=mismatch/);
    assert.doesNotMatch(tamperedValid.logs.warn, /Unknown phone_number_id/);
    assertNoSecrets(tamperedValid.logs.warn);

    const broken = Buffer.concat([RAW_WEBHOOK, Buffer.from("!!!")]);
    const tamperedBroken = await withLogs(() => postRaw(broken, { "X-Hub-Signature-256": signature }));
    assert.equal(tamperedBroken.result.status, 403);
    assert.match(tamperedBroken.logs.warn, /reason=mismatch/);
    assert.equal(tamperedBroken.result.text.includes("<!DOCTYPE"), false);
    assertNoSecrets(tamperedBroken.logs.warn);

    const missing = await withLogs(() => postRaw(RAW_WEBHOOK, {}));
    assert.equal(missing.result.status, 403);
    assert.equal(missing.result.json.error, "Invalid or missing X-Hub-Signature-256.");
    assert.match(missing.logs.warn, /reason=missing_header/);
    assert.doesNotMatch(missing.logs.warn, /reason=mismatch/);
    assertNoSecrets(missing.logs.warn);

    const malformed = await withLogs(() => postRaw(RAW_WEBHOOK, { "X-Hub-Signature-256": "sha256=not-a-signature" }));
    assert.equal(malformed.result.status, 403);
    assert.match(malformed.logs.warn, /reason=malformed_header/);
    assertNoSecrets(malformed.logs.warn);

    const wrong = await withLogs(() => postRaw(RAW_WEBHOOK, { "X-Hub-Signature-256": sign(WRONG_SECRET, RAW_WEBHOOK) }));
    assert.equal(wrong.result.status, 403);
    assert.match(wrong.logs.warn, /reason=mismatch/);
    assert.match(wrong.logs.warn, /secretEnv=META_APP_SECRET/);
    assertNoSecrets(wrong.logs.warn);
  });

  it("accepts FACEBOOK_APP_SECRET when META_APP_SECRET does not match, and still rejects a third secret", async () => {
    useSecrets(WRONG_SECRET, FACEBOOK_SECRET);
    const viaFacebook = await withLogs(() =>
      postRaw(RAW_WEBHOOK, { "X-Hub-Signature-256": sign(FACEBOOK_SECRET, RAW_WEBHOOK) })
    );
    assert.equal(viaFacebook.result.status, 200, viaFacebook.result.text);
    assert.match(viaFacebook.logs.debug, /secretEnv=FACEBOOK_APP_SECRET/);
    assertNoSecrets(`${viaFacebook.logs.warn}\n${viaFacebook.logs.info}\n${viaFacebook.logs.debug}`);

    const viaMeta = await withLogs(() => postRaw(RAW_WEBHOOK, { "X-Hub-Signature-256": sign(WRONG_SECRET, RAW_WEBHOOK) }));
    assert.equal(viaMeta.result.status, 200, viaMeta.result.text);
    assert.match(viaMeta.logs.debug, /secretEnv=META_APP_SECRET/);

    const neither = await withLogs(() => postRaw(RAW_WEBHOOK, { "X-Hub-Signature-256": sign(SECRET, RAW_WEBHOOK) }));
    assert.equal(neither.result.status, 403);
    assert.match(neither.logs.warn, /reason=mismatch/);
    assert.match(neither.logs.warn, /META_APP_SECRET/);
    assert.match(neither.logs.warn, /FACEBOOK_APP_SECRET/);
    assertNoSecrets(neither.logs.warn);

    useSecrets(undefined, FACEBOOK_SECRET);
    const onlyFacebook = await withLogs(() =>
      postRaw(RAW_WEBHOOK, { "X-Hub-Signature-256": sign(FACEBOOK_SECRET, RAW_WEBHOOK) })
    );
    assert.equal(onlyFacebook.result.status, 200, onlyFacebook.result.text);
    assert.match(onlyFacebook.logs.debug, /secretEnv=FACEBOOK_APP_SECRET/);
    assertNoSecrets(onlyFacebook.logs.debug);
  });

  it("does not let a missing Origin or a session cookie through, except the exempt webhook", async () => {
    useSecrets(SECRET);
    const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "x" }),
    });
    const loginJson = (await login.json()) as { error?: string };
    assert.equal(login.status, 403);
    assert.match(String(loginJson.error), /Origin not allowed/);

    const csrf = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://www.mylumera.in",
        Cookie: `__session=${encodeURIComponent("fake.credential~csrf-secret-value")}`,
      },
      body: JSON.stringify({ email: "a@b.c", password: "x" }),
    });
    const csrfJson = (await csrf.json()) as { error?: string };
    assert.equal(csrf.status, 403);
    assert.match(String(csrfJson.error), /CSRF/);

    const webhook = await postRaw(
      RAW_WEBHOOK,
      {
        "X-Hub-Signature-256": sign(SECRET, RAW_WEBHOOK),
        Cookie: `__session=${encodeURIComponent("fake.credential~csrf-secret-value")}`,
      }
    );
    assert.equal(webhook.status, 200, webhook.text);
  });

  it("rejects an unsigned production webhook instead of accepting it", async () => {
    useSecrets();
    const unsigned = await withLogs(() => postRaw(RAW_WEBHOOK, {}));
    assert.equal(unsigned.result.status, 500);
    assert.equal(unsigned.result.json.error, "Webhook signature verification is unavailable.");
    assert.doesNotMatch(JSON.stringify(unsigned.result.json), /META_APP_SECRET|FACEBOOK_APP_SECRET|WHATSAPP_APP_SECRET/);
    assert.doesNotMatch(unsigned.logs.warn, /META_APP_SECRET|FACEBOOK_APP_SECRET|WHATSAPP_APP_SECRET/);
    assert.match(unsigned.logs.warn, /reason=secret_missing/);
    assert.notEqual(unsigned.result.status, 200);

    useSecrets(SECRET);
    const signedButUnsignedHeader = await postRaw(RAW_WEBHOOK, {});
    assert.equal(signedButUnsignedHeader.status, 403);
  });

  it("rejects a webhook body above the 1mb raw limit", async () => {
    useSecrets(SECRET);
    const big = Buffer.alloc(1024 * 1024 + 64, 0x61);
    const res = await postRaw(big, { "X-Hub-Signature-256": sign(SECRET, big) });
    assert.equal(res.status, 413, res.text);
    assert.equal(res.text.includes(SECRET), false);
  });

  it("still mounts pricing, unknown /api JSON 404, WhatsApp auth, Gemini, and live registration", async () => {
    const origin = { Origin: "https://www.mylumera.in" };

    const pricing = await fetch(`http://127.0.0.1:${port}/pricing`);
    const pricingHtml = await pricing.text();
    assert.equal(pricing.status, 200, pricingHtml.slice(0, 200));
    assert.match(pricing.headers.get("content-type") || "", /html/);
    assert.match(pricingHtml, /<title>[^<]*Lumera<\/title>/);

    const missing = await fetch(`http://127.0.0.1:${port}/api/not-a-mounted-route`, { headers: origin });
    const missingText = await missing.text();
    assert.equal(missing.status, 404, missingText);
    assert.match(missing.headers.get("content-type") || "", /json/);
    assert.equal(missingText, JSON.stringify({ error: "Not found" }));

    const inbox = await fetch(`http://127.0.0.1:${port}/api/whatsapp/conversations`, { headers: origin });
    const inboxJson = (await inbox.json()) as { error?: string };
    assert.equal(inbox.status, 401);
    assert.equal(inboxJson.error, "Authentication required");

    const gemini = await fetch(`http://127.0.0.1:${port}/api/gemini/generate-soap`, {
      method: "POST",
      headers: { ...origin, "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "patient reports fever for two days" }),
    });
    const geminiJson = (await gemini.json()) as { error?: string };
    assert.equal(gemini.status, 401);
    assert.equal(geminiJson.error, "Authentication required");

    const register = await fetch(`http://127.0.0.1:${port}/api/auth/register-practice`, {
      method: "POST",
      headers: { ...origin, "Content-Type": "application/json" },
      body: "{}",
    });
    const registerJson = (await register.json()) as { error?: string };
    assert.equal(register.status, 400, JSON.stringify(registerJson));
    assert.match(String(registerJson.error), /Practice Name, Director Name, Email, and WhatsApp Phone are required/);
  });
});

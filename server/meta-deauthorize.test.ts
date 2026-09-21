import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { createMetaRouter } from "./meta.ts";
import { rememberFacebookAppUser, signMetaSignedRequest } from "./meta-signed-request.ts";

const SECRET = "deauthorize-hmac-secret";

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

function seedLinkedUser(label: string, facebookId: string): { id: string; email: string } {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const id = `user-deauth-${label}-${suffix}`;
  const email = `${label}.${suffix}@deauth-test.example`.toLowerCase();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO users (id, email, password_hash, name, role, status, phone, clinic_name, created_at)
       VALUES (?, ?, ?, ?, 'doctor', 'active', '', 'Deauth Clinic', ?)`
    )
    .run(id, email, hashPassword("Lumera@2026"), `Dr ${label}`, now);
  rememberFacebookAppUser(getDb(), id, facebookId);
  return { id, email };
}

function facebookIdOf(userId: string): string {
  const row = getDb().prepare("SELECT facebook_id FROM users WHERE id = ?").get(userId) as { facebook_id?: string };
  return String(row?.facebook_id || "");
}

/** Open sqlite before NODE_ENV=production; production refuses a fresh sqlite open. */
function ensureDatabase() {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === "production") process.env.NODE_ENV = "test";
  try {
    initDatabase();
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }
}

async function listenApp(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use("/api/meta", createMetaRouter());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("server did not bind a port");
  return {
    port: addr.port,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

describe("POST /api/meta/deauthorize", () => {
  const restoreEnv = saveEnv(["META_APP_SECRET", "NODE_ENV"]);

  after(() => {
    restoreEnv();
  });

  it("documents the live Deauthorize Callback URL", () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const runbook = fs.readFileSync(path.join(root, "docs/FIREBASE_CLOUD_RUN_DEPLOY.md"), "utf8");
    const meta = fs.readFileSync(path.join(root, "server/meta.ts"), "utf8");
    assert.match(runbook, /https:\/\/www\.mylumera\.in\/api\/meta\/deauthorize/);
    assert.match(runbook, /https:\/\/www\.mylumera\.in\/api\/meta\/data-deletion/);
    assert.match(runbook, /Do not paste `https:\/\/www\.mylumera\.in\/data-deletion-instructions`/);
    assert.match(meta, /router\.post\("\/deauthorize", handleMetaDeauthorizePost\)/);
    assert.match(meta, /router\.get\("\/deauthorize", handleMetaCallbackGetProbe\)/);
  });

  it("GET /api/meta/deauthorize returns 200 and does not unlink anyone", async () => {
    process.env.META_APP_SECRET = SECRET;
    process.env.NODE_ENV = "production";
    ensureDatabase();
    const linked = seedLinkedUser("probe", "probe-fb-1");
    const { port, close } = await listenApp();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/meta/deauthorize`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok?: boolean; status?: string };
      assert.equal(body.ok, true);
      assert.equal(body.status, "ok");
      assert.equal(facebookIdOf(linked.id), "probe-fb-1");
    } finally {
      await close();
    }
  });

  it("accepts a valid signed_request, unlinks that Facebook id, and rejects a tampered one", async () => {
    process.env.META_APP_SECRET = SECRET;
    process.env.NODE_ENV = "test";
    ensureDatabase();
    const target = seedLinkedUser("target", "218471");
    const other = seedLinkedUser("other", "999001");
    assert.equal(facebookIdOf(target.id), "218471");
    assert.equal(facebookIdOf(other.id), "999001");
    const { port, close } = await listenApp();
    try {
      const signed = signMetaSignedRequest({ user_id: "218471", issued_at: 1291836800 }, SECRET);
      const good = await fetch(`http://127.0.0.1:${port}/api/meta/deauthorize`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ signed_request: signed, user_id: "999001" }),
      });
      assert.equal(good.status, 200);
      assert.deepEqual(await good.json(), {});
      assert.equal(facebookIdOf(target.id), "");
      assert.equal(facebookIdOf(other.id), "999001");

      const audit = getDb()
        .prepare("SELECT action, details, user_id FROM audit_logs WHERE user_id = ? AND action = ?")
        .get(target.id, "Facebook Deauthorize") as { action: string; details: string; user_id: string };
      assert.equal(audit.action, "Facebook Deauthorize");
      assert.match(audit.details, /HMAC-SHA256 verified/);
      assert.match(audit.details, /218471/);
      assert.match(audit.details, new RegExp(target.id));
      assert.equal(audit.details.includes("999001"), false);

      const dot = signed.indexOf(".");
      const badSig = `${signed[0] === "A" ? "B" : "A"}${signed.slice(1, dot)}${signed.slice(dot)}`;
      const bad = await fetch(`http://127.0.0.1:${port}/api/meta/deauthorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signed_request: badSig }),
      });
      assert.equal(bad.status, 403);
      const badJson = (await bad.json()) as { error?: string };
      assert.match(badJson.error || "", /HMAC-SHA256/);

      const corruptPayload = await fetch(`http://127.0.0.1:${port}/api/meta/deauthorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signed_request: `${signed.slice(0, -2)}xx` }),
      });
      assert.equal(corruptPayload.status, 403);

      const missing = await fetch(`http://127.0.0.1:${port}/api/meta/deauthorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: "999001" }),
      });
      assert.equal(missing.status, 403);
      assert.equal(facebookIdOf(other.id), "999001");
    } finally {
      await close();
    }
  });

  it("returns 200 when the signed user is not linked", async () => {
    process.env.META_APP_SECRET = SECRET;
    process.env.NODE_ENV = "production";
    ensureDatabase();
    const { port, close } = await listenApp();
    try {
      const signed = signMetaSignedRequest({ user_id: "not-in-lumera" }, SECRET);
      const res = await fetch(`http://127.0.0.1:${port}/api/meta/deauthorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signed_request: signed }),
      });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {});
      const audit = getDb()
        .prepare(
          "SELECT details FROM audit_logs WHERE action = 'Facebook Deauthorize' AND details LIKE ? ORDER BY timestamp DESC"
        )
        .get("%not-in-lumera%") as { details: string };
      assert.match(audit.details, /no matching Lumera account/);
    } finally {
      await close();
    }
  });

  it("requires META_APP_SECRET in production and allows the SANDBOX bypass only when it is unset", async () => {
    ensureDatabase();
    const sandboxUser = seedLinkedUser("sandbox", "sandbox-fb-7");
    const { port, close } = await listenApp();
    try {
      delete process.env.META_APP_SECRET;
      process.env.NODE_ENV = "production";
      const blocked = await fetch(`http://127.0.0.1:${port}/api/meta/deauthorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: "sandbox-fb-7" }),
      });
      assert.equal(blocked.status, 500);
      assert.equal(facebookIdOf(sandboxUser.id), "sandbox-fb-7");

      process.env.NODE_ENV = "test";
      const allowed = await fetch(`http://127.0.0.1:${port}/api/meta/deauthorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: "sandbox-fb-7" }),
      });
      assert.equal(allowed.status, 200);
      assert.equal(facebookIdOf(sandboxUser.id), "");
      const audit = getDb()
        .prepare("SELECT details FROM audit_logs WHERE user_id = ? AND action = ?")
        .get(sandboxUser.id, "Facebook Deauthorize") as { details: string };
      assert.match(audit.details, /SANDBOX unsigned/);
    } finally {
      await close();
    }
  });
});

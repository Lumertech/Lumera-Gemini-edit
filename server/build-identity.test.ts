import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import express from "express";
import { fileURLToPath } from "node:url";
import {
  assertCloudRunCommitStamp,
  COMMIT_STAMP_MISMATCH_MESSAGE,
  isFullCommitSha,
  LUMERA_COMMIT_HEADER,
  lumeraCommitHeaderMiddleware,
  readStampedCommit,
} from "./build-identity.ts";
import { assertRequiredProductionEnv } from "./runtime.ts";

const SHA = "abc56f2898c48e090bcade7212f506c960c9b0a8";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("build identity stamp", () => {
  it("accepts only a full lowercase git sha", () => {
    assert.equal(isFullCommitSha(SHA), true);
    assert.equal(isFullCommitSha(SHA.slice(0, 7)), false);
    assert.equal(isFullCommitSha("unknown"), false);
    assert.equal(isFullCommitSha(`${SHA.toUpperCase()}`), false);
  });

  it("reads dist/build.json and ignores a missing file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumera-stamp-"));
    assert.equal(readStampedCommit(dir), "unknown");
    fs.mkdirSync(path.join(dir, "dist"));
    fs.writeFileSync(path.join(dir, "dist", "build.json"), `${JSON.stringify({ commit: SHA })}\n`);
    assert.equal(readStampedCommit(dir), SHA);
  });

  it("stamps a sha file and rejects anything else", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumera-stamp-script-"));
    const out = path.join(dir, "dist", "build.json");
    const script = path.join(root, "scripts", "stamp-build-json.mjs");
    const ok = spawnSync(process.execPath, [script, SHA, out], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(fs.readFileSync(out, "utf8")).commit, SHA);
    const bad = spawnSync(process.execPath, [script, "latest", out], { encoding: "utf8" });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /40 lowercase hex/);
  });

  it("does not block boot off Cloud Run", () => {
    assert.doesNotThrow(() => assertCloudRunCommitStamp({} as NodeJS.ProcessEnv, "unknown"));
    assert.doesNotThrow(() =>
      assertRequiredProductionEnv({
        NODE_ENV: "production",
        JWT_SECRET: "a-sufficiently-long-cloud-run-secret",
        DATABASE_URL: "postgres://lumera:local@127.0.0.1:5432/lumera",
      } as NodeJS.ProcessEnv)
    );
  });

  it("refuses to listen on Cloud Run when the stamp and env sha differ", () => {
    const env = {
      NODE_ENV: "production",
      K_SERVICE: "lumera-gemini-edit",
      JWT_SECRET: "a-sufficiently-long-cloud-run-secret",
      DATABASE_URL: "postgres://lumera:local@127.0.0.1:5432/lumera",
      LUMERA_COMMIT_SHA: SHA,
    } as NodeJS.ProcessEnv;
    assert.throws(() => assertCloudRunCommitStamp(env, "unknown"), /stamped=unknown/);
    assert.throws(() => assertCloudRunCommitStamp(env, "9734631fc2a80360e42fb246afb4a0e09aca6c38"), /claimed=/);
    assert.doesNotThrow(() => assertCloudRunCommitStamp(env, SHA));
    assert.throws(() => assertRequiredProductionEnv({ ...env, LUMERA_COMMIT_SHA: "" }), /dist\/build.json/);
    assert.match(COMMIT_STAMP_MISMATCH_MESSAGE, /PORT timeout even though bind is not the bug/);
  });

  it("sets X-Lumera-Commit on responses including /healthz", async () => {
    const app = express();
    app.use(lumeraCommitHeaderMiddleware(SHA));
    app.get("/healthz", (_req, res) => {
      res.type("text/plain").send("ok");
    });
    const server = await new Promise<import("node:http").Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/healthz`);
      assert.equal(res.status, 200);
      assert.equal(await res.text(), "ok");
      assert.equal(res.headers.get(LUMERA_COMMIT_HEADER.toLowerCase()), SHA);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});

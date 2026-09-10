import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { after, describe, it } from "node:test";
import express from "express";
import {
  applyBundledServerNodeEnv,
  assertRequiredProductionEnv,
  resolveListenPort,
} from "./runtime.ts";
import {
  attachProductionSpaFallback,
  isBackendPath,
  isSpaHistoryFallbackPath,
  PUBLIC_SPA_PATHS,
  resolveClientDist,
} from "./spa-fallback.ts";

describe("production listen / env helpers", () => {
  it("uses PORT from the environment for Cloud Run", () => {
    assert.equal(resolveListenPort({} as NodeJS.ProcessEnv), 3000);
    assert.equal(resolveListenPort({ PORT: "8080" } as NodeJS.ProcessEnv), 8080);
    assert.throws(() => resolveListenPort({ PORT: "nope" } as NodeJS.ProcessEnv), /PORT/);
  });

  it("treats bundled dist/server.cjs as production when NODE_ENV is unset", () => {
    const env: NodeJS.ProcessEnv = {};
    applyBundledServerNodeEnv("/app/dist/server.cjs", env);
    assert.equal(env.NODE_ENV, "production");

    const already: NodeJS.ProcessEnv = { NODE_ENV: "development" };
    applyBundledServerNodeEnv("/home/user/dist/server.cjs", already);
    assert.equal(already.NODE_ENV, "development");

    const fromTsx: NodeJS.ProcessEnv = {};
    applyBundledServerNodeEnv("/workspace/server.ts", fromTsx);
    assert.equal(fromTsx.NODE_ENV, undefined);
  });

  it("requires JWT_SECRET in production and leaves Meta secrets optional", () => {
    const prevJwt = process.env.JWT_SECRET;
    const prevNode = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.JWT_SECRET;
      assert.throws(() => assertRequiredProductionEnv(), /JWT_SECRET/);
      process.env.JWT_SECRET = "change-me-to-a-long-random-secret";
      assert.throws(() => assertRequiredProductionEnv(), /JWT_SECRET/);
      process.env.JWT_SECRET = "a-sufficiently-long-cloud-run-secret";
      assert.doesNotThrow(() => assertRequiredProductionEnv());
    } finally {
      if (prevJwt === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevJwt;
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
    }
  });
});

describe("production SPA history fallback", () => {
  it("classifies Meta policy URLs as SPA routes and API as backend", () => {
    for (const p of PUBLIC_SPA_PATHS) {
      assert.equal(isSpaHistoryFallbackPath(p), true, p);
      assert.equal(isBackendPath(p), false, p);
    }
    assert.equal(isSpaHistoryFallbackPath("/privacy"), true);
    assert.equal(isSpaHistoryFallbackPath("/api/public/policies/privacy-policy"), false);
    assert.equal(isSpaHistoryFallbackPath("/assets/index-abc.js"), false);
    assert.equal(isBackendPath("/healthz"), true);
    assert.equal(isBackendPath("/api/meta/webhook"), true);
  });

  it("resolves dist whether cwd is the app root or dist itself", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lumera-dist-"));
    const dist = path.join(root, "dist");
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>Lumera</title>");
    assert.equal(resolveClientDist(root), dist);
    assert.equal(resolveClientDist(dist), dist);
  });

  it("serves index.html for policy paths without login", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lumera-spa-"));
    const dist = path.join(root, "dist");
    fs.mkdirSync(dist);
    fs.writeFileSync(
      path.join(dist, "index.html"),
      "<!doctype html><html><body>Lumera SPA</body></html>"
    );
    fs.writeFileSync(path.join(dist, "ok.txt"), "static-ok");

    const app = express();
    app.get("/api/ping", (_req, res) => res.json({ ok: true }));
    attachProductionSpaFallback(app, dist);

    const server: Server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const port = addr.port;
    const origin = `http://127.0.0.1:${port}`;

    try {
      for (const p of PUBLIC_SPA_PATHS) {
        const res = await fetch(`${origin}${p}`);
        assert.equal(res.status, 200, p);
        const body = await res.text();
        assert.match(body, /Lumera SPA/);
      }
      const asset = await fetch(`${origin}/ok.txt`);
      assert.equal(asset.status, 200);
      assert.equal(await asset.text(), "static-ok");
      const api = await fetch(`${origin}/api/ping`);
      assert.equal(api.status, 200);
      assert.equal((await api.json()).ok, true);
      const missingJs = await fetch(`${origin}/assets/missing.js`);
      assert.equal(missingJs.status, 404);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});

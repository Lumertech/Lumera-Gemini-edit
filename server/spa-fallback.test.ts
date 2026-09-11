import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  applyBundledServerNodeEnv,
  assertRequiredProductionEnv,
  failFastRequiredProductionEnv,
  JWT_SECRET_REQUIRED_MESSAGE,
  resolveListenPort,
} from "./runtime.ts";
import {
  attachProductionSpaFallback,
  isBackendPath,
  isSpaHistoryFallbackPath,
  resolveClientDist,
} from "./spa-fallback.ts";

describe("production listen / env helpers", () => {
  it("uses PORT from the environment for Cloud Run", () => {
    assert.equal(resolveListenPort({} as NodeJS.ProcessEnv), 3000);
    assert.equal(resolveListenPort({ PORT: "3000" } as NodeJS.ProcessEnv), 3000);
    assert.equal(resolveListenPort({ PORT: "8080" } as NodeJS.ProcessEnv), 8080);
    assert.notEqual(resolveListenPort({ PORT: "3000" } as NodeJS.ProcessEnv), 8080);
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
      assert.match(JWT_SECRET_REQUIRED_MESSAGE, /JWT_SECRET is required/);
    } finally {
      if (prevJwt === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevJwt;
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
    }
  });

  it("fail-fast logs JWT_SECRET is required and exits before listen", () => {
    const lines: string[] = [];
    const orig = console.error;
    let exitCode: number | undefined;
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      failFastRequiredProductionEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv, (code) => {
        exitCode = code;
      });
    } finally {
      console.error = orig;
    }
    assert.equal(exitCode, 1);
    assert.match(lines.join("\n"), /JWT_SECRET is required/);
    assert.match(lines.join("\n"), /PORT timeout even though bind is not the bug/);
  });

  it("fail-fast is a no-op when JWT_SECRET is set or NODE_ENV is not production", () => {
    let exited = false;
    failFastRequiredProductionEnv(
      { NODE_ENV: "production", JWT_SECRET: "a-sufficiently-long-cloud-run-secret" } as NodeJS.ProcessEnv,
      () => {
        exited = true;
      }
    );
    failFastRequiredProductionEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv, () => {
      exited = true;
    });
    assert.equal(exited, false);
  });

  it("Cloud Run-style boot without JWT_SECRET exits in seconds with a clear log", () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const started = Date.now();
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        `
        (async () => {
          process.env.NODE_ENV = "production";
          delete process.env.JWT_SECRET;
          const { failFastRequiredProductionEnv } = await import("./server/runtime.ts");
          failFastRequiredProductionEnv();
          console.log("SHOULD_NOT_REACH");
        })();
        `,
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 8000,
        env: { ...process.env, NODE_ENV: "production" },
      }
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 5000, `fail-fast took ${elapsed}ms — Cloud Run would treat a hang as PORT timeout`);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /JWT_SECRET is required/);
    assert.doesNotMatch(result.stdout || "", /SHOULD_NOT_REACH/);
  });
});

describe("Cloud Run boot order (source contract)", () => {
  it("listens on 0.0.0.0:$PORT after JWT fail-fast and before initDatabase", () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server.ts"), "utf8");
    assert.match(src, /failFastRequiredProductionEnv\(\)/);
    assert.match(src, /app\.listen\(PORT,\s*"0\.0\.0\.0"/);
    const listenIdx = src.indexOf('app.listen(PORT, "0.0.0.0"');
    const initIdx = src.lastIndexOf("initDatabase()");
    assert.ok(listenIdx > 0, "must bind 0.0.0.0");
    assert.ok(initIdx > listenIdx, "initDatabase must run after listen so Cloud Run gets a socket promptly");
    assert.equal(src.includes("assertRequiredProductionEnv()"), false);
    assert.doesNotMatch(src, /app\.listen\(\s*8080/);
  });
});

describe("production SPA history fallback", () => {
  it("classifies landing as SPA, policy URLs as HTML documents, and API as backend", () => {
    assert.equal(isSpaHistoryFallbackPath("/"), true);
    assert.equal(isBackendPath("/"), false);
    for (const p of ["/privacy-policy", "/terms-of-service", "/data-deletion-instructions"]) {
      assert.equal(isSpaHistoryFallbackPath(p), false, p);
      assert.equal(isBackendPath(p), false, p);
    }
    assert.equal(isSpaHistoryFallbackPath("/privacy"), true);
    assert.equal(isSpaHistoryFallbackPath("/app"), true);
    assert.equal(isSpaHistoryFallbackPath("/login"), true);
    assert.equal(isSpaHistoryFallbackPath("/signup"), true);
    assert.equal(isSpaHistoryFallbackPath("/register"), true);
    assert.equal(isSpaHistoryFallbackPath("/dashboard"), true);
    assert.equal(isSpaHistoryFallbackPath("/app/rx"), true);
    assert.equal(isSpaHistoryFallbackPath("/admin/users"), true);
    assert.equal(isSpaHistoryFallbackPath("/app/billing"), true);
    assert.equal(isSpaHistoryFallbackPath("/w/dr-demo-physio/whatsapp"), true);
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
      const home = await fetch(`${origin}/`);
      assert.equal(home.status, 200);
      assert.match(await home.text(), /Lumera SPA/);
      for (const p of ["/app/rx", "/admin/users", "/signup", "/login"]) {
        const res = await fetch(`${origin}${p}`);
        assert.equal(res.status, 200, `${p} must rewrite to the SPA shell`);
        assert.match(await res.text(), /Lumera SPA/);
      }
      for (const p of ["/privacy-policy", "/terms-of-service", "/data-deletion-instructions"]) {
        const res = await fetch(`${origin}${p}`);
        assert.equal(res.status, 404, `${p} must not fall through to an empty SPA shell`);
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

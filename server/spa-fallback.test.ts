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
  DATABASE_URL_REQUIRED_MESSAGE,
  resolveListenPort,
} from "./runtime.ts";
import {
  attachProductionSpaFallback,
  isBackendPath,
  isProspectMediaAsset,
  isSpaHistoryFallbackPath,
  PROSPECT_MEDIA_CACHE_CONTROL,
  resolveClientDist,
} from "./spa-fallback.ts";
import {
  applyHtmlDocumentSecurityHeaders,
  frameAncestorsValue,
  htmlContentSecurityPolicy,
} from "./html-security-headers.ts";
import type { Response } from "express";

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
    const prevDb = process.env.DATABASE_URL;
    const prevService = process.env.K_SERVICE;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.JWT_SECRET;
      delete process.env.DATABASE_URL;
      delete process.env.K_SERVICE;
      assert.throws(() => assertRequiredProductionEnv(), /JWT_SECRET/);
      process.env.JWT_SECRET = "change-me-to-a-long-random-secret";
      assert.throws(() => assertRequiredProductionEnv(), /JWT_SECRET/);
      process.env.JWT_SECRET = "a-sufficiently-long-cloud-run-secret";
      assert.throws(() => assertRequiredProductionEnv(), /DATABASE_URL/);
      process.env.DATABASE_URL = "postgres://lumera:local@127.0.0.1:5432/lumera";
      assert.doesNotThrow(() => assertRequiredProductionEnv());
      assert.match(JWT_SECRET_REQUIRED_MESSAGE, /JWT_SECRET is required/);
      assert.match(DATABASE_URL_REQUIRED_MESSAGE, /DATABASE_URL is required/);
    } finally {
      if (prevJwt === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevJwt;
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevDb;
      if (prevService === undefined) delete process.env.K_SERVICE;
      else process.env.K_SERVICE = prevService;
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
      {
        NODE_ENV: "production",
        JWT_SECRET: "a-sufficiently-long-cloud-run-secret",
        DATABASE_URL: "postgres://lumera:local@127.0.0.1:5432/lumera",
      } as NodeJS.ProcessEnv,
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
    assert.match(src, /failFastErrorTrackerConfig\(\)/);
    assert.match(src, /initErrorTracker\(\)/);
    assert.match(src, /app\.use\(expressErrorHandler\)/);
    assert.match(src, /app\.listen\(PORT,\s*"0\.0\.0\.0"/);
    const listenIdx = src.indexOf('app.listen(PORT, "0.0.0.0"');
    const initIdx = src.lastIndexOf("initDatabase()");
    const trackerIdx = src.indexOf("initErrorTracker()");
    const errMwIdx = src.indexOf("app.use(expressErrorHandler)");
    assert.ok(listenIdx > 0, "must bind 0.0.0.0");
    assert.ok(trackerIdx > 0 && trackerIdx < listenIdx, "error tracker must initialize before listen");
    assert.ok(errMwIdx > 0 && errMwIdx < listenIdx, "Express error middleware must be attached before listen");
    assert.ok(initIdx > listenIdx, "initDatabase must run after listen so Cloud Run gets a socket promptly");
    assert.equal(src.includes("assertRequiredProductionEnv()"), false);
    assert.doesNotMatch(src, /app\.listen\(\s*8080/);
  });
});

describe("production SPA history fallback", () => {
  it("classifies landing as SPA, policy URLs as HTML documents, and API as backend", () => {
    assert.equal(isSpaHistoryFallbackPath("/"), true);
    assert.equal(isBackendPath("/"), false);
    for (const p of [
      "/privacy-policy",
      "/terms-of-service",
      "/data-deletion-instructions",
      "/government-data-request-policy",
    ]) {
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
    assert.equal(isSpaHistoryFallbackPath("/w/lumera-apex-polyclinic/whatsapp"), true);
    assert.equal(isSpaHistoryFallbackPath("/w/lumera-apex-polyclinic/queue"), true);
    assert.equal(isBackendPath("/w/lumera-apex-polyclinic/whatsapp"), false);
    assert.equal(isBackendPath("/w/lumera-apex-polyclinic/queue"), false);
    assert.equal(isBackendPath("/w/dr-demo-physio/whatsapp"), false);
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
    fs.writeFileSync(path.join(dist, "build.json"), '{"commit":"abc56f2898c48e090bcade7212f506c960c9b0a8"}\n');

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
      const csp = home.headers.get("content-security-policy") || "";
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /https:\/\/connect\.facebook\.net/);
      assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
      assert.equal(home.headers.get("x-content-type-options"), "nosniff");
      assert.equal(home.headers.get("x-frame-options"), "DENY");
      assert.match(home.headers.get("permissions-policy") || "", /microphone=\(self\)/);
      assert.match(home.headers.get("permissions-policy") || "", /camera=\(self\)/);
      assert.equal(home.headers.get("cache-control"), "private, no-cache");
      assert.match(home.headers.get("referrer-policy") || "", /strict-origin-when-cross-origin/);
      for (const p of ["/app/rx", "/admin/users", "/signup", "/login", "/w/lumera-apex-polyclinic/queue"]) {
        const res = await fetch(`${origin}${p}`);
        assert.equal(res.status, 200, `${p} must rewrite to the SPA shell`);
        assert.match(await res.text(), /Lumera SPA/);
      }
      for (const p of [
        "/privacy-policy",
        "/terms-of-service",
        "/data-deletion-instructions",
        "/government-data-request-policy",
      ]) {
        const res = await fetch(`${origin}${p}`);
        assert.equal(res.status, 404, `${p} must not fall through to an empty SPA shell`);
      }
      const indexHtml = await fetch(`${origin}/index.html`);
      assert.equal(indexHtml.status, 200);
      assert.equal(indexHtml.headers.get("cache-control"), "private, no-cache");
      const asset = await fetch(`${origin}/ok.txt`);
      assert.equal(asset.status, 200);
      assert.equal(await asset.text(), "static-ok");
      const buildJson = await fetch(`${origin}/build.json`);
      assert.equal(buildJson.status, 200);
      assert.equal(buildJson.headers.get("cache-control"), "no-store");
      assert.equal((await buildJson.json()).commit, "abc56f2898c48e090bcade7212f506c960c9b0a8");
      const api = await fetch(`${origin}/api/ping`);
      assert.equal(api.status, 200);
      assert.equal((await api.json()).ok, true);
      const deepClinic = await fetch(`${origin}/w/x/patients/123`);
      assert.equal(deepClinic.status, 200);
      assert.match(deepClinic.headers.get("content-type") || "", /html/);
      assert.match(await deepClinic.text(), /Lumera SPA/);
      const deepRx = await fetch(`${origin}/w/physiodoctor-practice/rx/visit-1`);
      assert.equal(deepRx.status, 200);
      assert.match(await deepRx.text(), /Lumera SPA/);
      const adminDeep = await fetch(`${origin}/admin/tenants`);
      assert.equal(adminDeep.status, 200);
      assert.match(await adminDeep.text(), /Lumera SPA/);
      const missingApi = await fetch(`${origin}/api/nope`);
      const missingApiText = await missingApi.text();
      assert.equal(missingApi.status, 404);
      assert.match(missingApi.headers.get("content-type") || "", /json/);
      assert.equal(JSON.parse(missingApiText).error, "Not found");
      assert.doesNotMatch(missingApiText, /<!doctype/i);
      const missingJs = await fetch(`${origin}/assets/missing.js`);
      assert.equal(missingJs.status, 404);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("serves prospect advert media with a shared cache and byte ranges", async () => {
    assert.equal(isProspectMediaAsset("/app/dist/media/lumera-prospect-16x9.mp4"), true);
    assert.equal(isProspectMediaAsset("/app/dist/media/lumera-prospect-9x16.mp4"), true);
    assert.equal(isProspectMediaAsset("/app/dist/media/lumera-poster-16x9.jpg"), true);
    assert.equal(isProspectMediaAsset("/app/dist/index.html"), false);
    assert.equal(isProspectMediaAsset("/app/dist/ok.txt"), false);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lumera-media-"));
    const dist = path.join(root, "dist");
    const media = path.join(dist, "media");
    fs.mkdirSync(media, { recursive: true });
    fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><html><body>Lumera SPA</body></html>");
    const video = Buffer.alloc(8192);
    for (let i = 0; i < video.length; i++) video[i] = i % 251;
    fs.writeFileSync(path.join(media, "lumera-prospect-16x9.mp4"), video);
    fs.writeFileSync(path.join(media, "lumera-poster-16x9.jpg"), Buffer.from("poster-bytes"));
    fs.writeFileSync(path.join(dist, "ok.txt"), "static-ok");

    const app = express();
    attachProductionSpaFallback(app, dist);
    const server: Server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const origin = `http://127.0.0.1:${addr.port}`;

    try {
      const full = await fetch(`${origin}/media/lumera-prospect-16x9.mp4`);
      assert.equal(full.status, 200);
      assert.equal(full.headers.get("accept-ranges"), "bytes");
      assert.equal(full.headers.get("cache-control"), PROSPECT_MEDIA_CACHE_CONTROL);
      assert.match(full.headers.get("content-type") || "", /video\/mp4/);
      assert.equal((await full.arrayBuffer()).byteLength, video.length);

      const ranged = await fetch(`${origin}/media/lumera-prospect-16x9.mp4`, {
        headers: { Range: "bytes=100-149" },
      });
      assert.equal(ranged.status, 206);
      assert.equal(ranged.headers.get("accept-ranges"), "bytes");
      assert.equal(ranged.headers.get("content-range"), `bytes 100-149/${video.length}`);
      assert.equal(ranged.headers.get("cache-control"), PROSPECT_MEDIA_CACHE_CONTROL);
      const body = Buffer.from(await ranged.arrayBuffer());
      assert.equal(body.length, 50);
      assert.deepEqual(body, video.subarray(100, 150));

      const poster = await fetch(`${origin}/media/lumera-poster-16x9.jpg`);
      assert.equal(poster.status, 200);
      assert.equal(poster.headers.get("cache-control"), PROSPECT_MEDIA_CACHE_CONTROL);
      assert.match(poster.headers.get("content-type") || "", /image\/jpeg/);

      const other = await fetch(`${origin}/ok.txt`);
      assert.equal(other.status, 200);
      assert.notEqual(other.headers.get("cache-control"), PROSPECT_MEDIA_CACHE_CONTROL);

      const shell = await fetch(`${origin}/`);
      assert.equal(shell.headers.get("cache-control"), "private, no-cache");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});

describe("FRAME_ANCESTORS allowlist", () => {
  function capture(env: NodeJS.ProcessEnv) {
    const headers = new Map<string, string | number>();
    const res = {
      setHeader(name: string, value: string | number) {
        headers.set(name.toLowerCase(), value);
      },
    } as unknown as Response;
    applyHtmlDocumentSecurityHeaders(res, env);
    return headers;
  }

  it("defaults to frame-ancestors 'none' and X-Frame-Options DENY", () => {
    assert.equal(frameAncestorsValue({} as NodeJS.ProcessEnv), "'none'");
    assert.equal(frameAncestorsValue({ FRAME_ANCESTORS: "none" } as NodeJS.ProcessEnv), "'none'");
    assert.match(htmlContentSecurityPolicy({} as NodeJS.ProcessEnv), /frame-ancestors 'none'/);
    const headers = capture({} as NodeJS.ProcessEnv);
    assert.match(String(headers.get("content-security-policy")), /frame-ancestors 'none'/);
    assert.equal(headers.get("x-frame-options"), "DENY");
  });

  it("allowlists specific origins and drops a bare star", () => {
    assert.equal(frameAncestorsValue({ FRAME_ANCESTORS: "*" } as NodeJS.ProcessEnv), "'none'");
    assert.equal(
      frameAncestorsValue({
        FRAME_ANCESTORS: "https://aistudio.google.com https://ai.studio *",
      } as NodeJS.ProcessEnv),
      "https://aistudio.google.com https://ai.studio"
    );
    assert.equal(
      frameAncestorsValue({
        FRAME_ANCESTORS: "https://aistudio.google.com https://*.googleusercontent.com",
      } as NodeJS.ProcessEnv),
      "https://aistudio.google.com https://*.googleusercontent.com"
    );

    const headers = capture({
      FRAME_ANCESTORS: "https://aistudio.google.com https://ai.studio",
    } as NodeJS.ProcessEnv);
    const csp = String(headers.get("content-security-policy"));
    assert.match(csp, /frame-ancestors https:\/\/aistudio\.google\.com https:\/\/ai\.studio(?:;|$)/);
    assert.doesNotMatch(csp, /frame-ancestors[^;]* \*(?:;|$)/);
    assert.doesNotMatch(csp, /frame-ancestors \*/);
    assert.equal(headers.has("x-frame-options"), false);

    const open = capture({ FRAME_ANCESTORS: "*" } as NodeJS.ProcessEnv);
    assert.match(String(open.get("content-security-policy")), /frame-ancestors 'none'/);
    assert.equal(open.get("x-frame-options"), "DENY");
  });
});

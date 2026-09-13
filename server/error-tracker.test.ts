import assert from "node:assert/strict";
import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  assertErrorTrackerConfig,
  expressErrorHandler,
  failFastErrorTrackerConfig,
  getErrorTrackerStatus,
  initErrorTracker,
  reportCaughtError,
  reportError,
  resetErrorTrackerForTests,
} from "./error-tracker.ts";

afterEach(() => {
  resetErrorTrackerForTests();
});

describe("error tracker", () => {
  it("uses console fallback locally without GCP creds and does not throw", () => {
    const logs: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const status = initErrorTracker({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
      assert.equal(status.mode, "console");
      assert.equal(status.initialized, true);
      assert.match(logs.join("\n"), /error tracker: console fallback/);
      assert.doesNotThrow(() => reportError(new Error("local-test-error"), { kind: "unit" }));
      assert.doesNotThrow(() => reportCaughtError(new Error("swallowed"), "unit.caught"));
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
  });

  it("uses GCP structured reporting on Cloud Run (K_SERVICE)", () => {
    const logs: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const status = initErrorTracker({
        NODE_ENV: "production",
        K_SERVICE: "lumera-gemini-edit",
        JWT_SECRET: "a-sufficiently-long-cloud-run-secret",
      } as NodeJS.ProcessEnv);
      assert.equal(status.mode, "gcp");
      assert.match(logs.join("\n"), /error tracker: gcp/);
      reportError(new Error("cloud-run-boom"));
      const jsonLine = logs.find((line) => line.includes("google.devtools.clouderrorreporting"));
      assert.ok(jsonLine, "must emit a Cloud Error Reporting structured event");
      const parsed = JSON.parse(jsonLine!) as { message?: string; serviceContext?: { service?: string } };
      assert.match(String(parsed.message), /cloud-run-boom/);
      assert.equal(parsed.serviceContext?.service, "lumera-gemini-edit");
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
  });

  it("fails closed on a placeholder DSN or Sentry URL in production", () => {
    assert.throws(
      () =>
        assertErrorTrackerConfig({
          NODE_ENV: "production",
          ERROR_REPORTING: "replace-with-sentry-dsn",
        } as NodeJS.ProcessEnv),
      /placeholder|Sentry|GCP Error Reporting/i
    );
    assert.throws(
      () =>
        assertErrorTrackerConfig({
          NODE_ENV: "production",
          SENTRY_DSN: "https://example.invalid/1",
        } as NodeJS.ProcessEnv),
      /Sentry|GCP Error Reporting/i
    );
    assert.throws(
      () =>
        assertErrorTrackerConfig({
          NODE_ENV: "production",
          ERROR_REPORTING_PROJECT_ID: "replace-with-gcp-project",
        } as NodeJS.ProcessEnv),
      /ERROR_REPORTING_PROJECT_ID/
    );
    assert.doesNotThrow(() =>
      assertErrorTrackerConfig({
        NODE_ENV: "production",
        K_SERVICE: "lumera-gemini-edit",
      } as NodeJS.ProcessEnv)
    );
    assert.doesNotThrow(() =>
      assertErrorTrackerConfig({ NODE_ENV: "development", ERROR_REPORTING: "replace-with-sentry-dsn" } as NodeJS.ProcessEnv)
    );
  });

  it("fail-fast logs BOOT FATAL and exits before listen on a misconfigured DSN", () => {
    const lines: string[] = [];
    const orig = console.error;
    let exitCode: number | undefined;
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      failFastErrorTrackerConfig(
        { NODE_ENV: "production", SENTRY_DSN: "https://sentry.example/1" } as NodeJS.ProcessEnv,
        (code) => {
          exitCode = code;
        }
      );
    } finally {
      console.error = orig;
    }
    assert.equal(exitCode, 1);
    assert.match(lines.join("\n"), /BOOT FATAL/);
    assert.equal(getErrorTrackerStatus().initialized, false);
  });

  it("Express error middleware reports route handler errors and returns 500", async () => {
    initErrorTracker({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    const reports: string[] = [];
    const origErr = console.error;
    console.error = (...args: unknown[]) => {
      reports.push(args.map(String).join(" "));
    };

    const app = express();
    app.get("/boom", () => {
      throw new Error("route-handler-boom");
    });
    app.use(expressErrorHandler);

    const server: Server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const origin = `http://127.0.0.1:${addr.port}`;

    try {
      const res = await fetch(`${origin}/boom`);
      assert.equal(res.status, 500);
      const body = (await res.json()) as { error?: string };
      assert.equal(body.error, "Internal server error");
      assert.match(reports.join("\n"), /route-handler-boom/);
    } finally {
      console.error = origErr;
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});

describe("CI gating files", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

  it("GitHub Actions workflow uses package.json test globs and Node 22", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts: { test: string; lint: string };
      engines: { node: string };
    };
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
    const testGlobs = pkg.scripts.test.replace(/^tsx\s+/, "");
    assert.match(pkg.engines.node, />=22 <25/);
    assert.equal(pkg.scripts.lint, "tsc --noEmit");
    assert.match(workflow, /on:\s*\n\s+push:\s*\n\s+pull_request:/);
    assert.match(workflow, /node-version:\s*"22"/);
    assert.match(workflow, /npm ci/);
    assert.match(workflow, /npm run lint/);
    assert.ok(workflow.includes(testGlobs), "ci.yml must copy exact package.json test globs");
    assert.match(workflow, /JWT_SECRET:\s*test-jwt-secret/);
    assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  });
});

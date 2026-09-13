import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  assertRequiredProductionEnv,
  DATABASE_URL_REQUIRED_MESSAGE,
  JWT_SECRET_REQUIRED_MESSAGE,
} from "./runtime.ts";
import { sqliteFallbackForbidden } from "./sql-engine.ts";

const PROD_JWT = "a-sufficiently-long-cloud-run-secret";
const PROD_DB = "postgres://lumera:local@127.0.0.1:5432/lumera";

describe("production DATABASE_URL fail-fast (Epic 0.2)", () => {
  it("requires DATABASE_URL after JWT_SECRET in production", () => {
    assert.throws(
      () => assertRequiredProductionEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv),
      /JWT_SECRET/
    );
    assert.throws(
      () =>
        assertRequiredProductionEnv({
          NODE_ENV: "production",
          JWT_SECRET: PROD_JWT,
        } as NodeJS.ProcessEnv),
      /DATABASE_URL/
    );
    assert.throws(
      () =>
        assertRequiredProductionEnv({
          NODE_ENV: "production",
          JWT_SECRET: PROD_JWT,
          DATABASE_URL: "replace-with-postgres-url",
        } as NodeJS.ProcessEnv),
      /DATABASE_URL/
    );
    assert.doesNotThrow(() =>
      assertRequiredProductionEnv({
        NODE_ENV: "production",
        JWT_SECRET: PROD_JWT,
        DATABASE_URL: PROD_DB,
      } as NodeJS.ProcessEnv)
    );
    assert.match(DATABASE_URL_REQUIRED_MESSAGE, /DATABASE_URL is required/);
    assert.match(JWT_SECRET_REQUIRED_MESSAGE, /JWT_SECRET is required/);
  });

  it("does not require DATABASE_URL outside production (sqlite tests)", () => {
    assert.doesNotThrow(() => assertRequiredProductionEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
    assert.doesNotThrow(() => assertRequiredProductionEnv({} as NodeJS.ProcessEnv));
  });

  it("forbids sqlite fallback on Cloud Run / bundled server.cjs only", () => {
    assert.equal(sqliteFallbackForbidden({} as NodeJS.ProcessEnv, "/workspace/server.ts"), false);
    assert.equal(
      sqliteFallbackForbidden({ K_SERVICE: "lumera-gemini-edit" } as NodeJS.ProcessEnv, "/workspace/server.ts"),
      true
    );
    assert.equal(sqliteFallbackForbidden({} as NodeJS.ProcessEnv, "/app/dist/server.cjs"), true);
  });

  it("Cloud Run bundle aliases node:sqlite to the pg/sqlite dual-mode class", () => {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: { build: string };
    };
    assert.match(pkg.scripts.build, /alias:node:sqlite=\.\/server\/sqlite-compat\.ts/);
    assert.match(pkg.scripts.build, /cp server\/pg-sync-worker\.cjs dist\/pg-sync-worker\.cjs/);
  });
});

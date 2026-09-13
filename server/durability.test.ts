import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  openConfiguredDatabase,
  resolveSqlEngineKind,
} from "./sql-open.ts";
import {
  assertRequiredProductionEnv,
  DATABASE_URL_REQUIRED_MESSAGE,
  JWT_SECRET_REQUIRED_MESSAGE,
} from "./runtime.ts";
import { sqliteFallbackForbidden } from "./sql-engine.ts";

const PROD_JWT = "a-sufficiently-long-cloud-run-secret";
const PROD_DB = "postgres://lumera:local@127.0.0.1:5432/lumera";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sqlitePath = path.join(root, "data", "lumera.db");

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

  it("forbids sqlite fallback in production, Cloud Run, and bundled server.cjs", () => {
    assert.equal(sqliteFallbackForbidden({} as NodeJS.ProcessEnv, "/workspace/server.ts"), false);
    assert.equal(
      sqliteFallbackForbidden({ NODE_ENV: "test" } as NodeJS.ProcessEnv, "/workspace/server.ts"),
      false
    );
    assert.equal(
      sqliteFallbackForbidden({ NODE_ENV: "production" } as NodeJS.ProcessEnv, "/workspace/server.ts"),
      true
    );
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

describe("getDb / initDatabase engine selection (Epic 0.2 wiring)", () => {
  it("calls sqliteFallbackForbidden from db init and prefers pg-shim when DATABASE_URL is set", () => {
    const dbSrc = fs.readFileSync(path.join(root, "server/db.ts"), "utf8");
    const openSrc = fs.readFileSync(path.join(root, "server/sql-open.ts"), "utf8");
    assert.match(dbSrc, /openConfiguredDatabase/);
    assert.match(openSrc, /sqliteFallbackForbidden\(/);
    assert.match(openSrc, /createPgShim\(/);
    assert.equal(
      resolveSqlEngineKind(
        { DATABASE_URL: "postgres://lumera:lumera@127.0.0.1:54329/lumera" } as NodeJS.ProcessEnv,
        "/workspace/server.ts"
      ),
      "postgres"
    );
    assert.equal(resolveSqlEngineKind({ NODE_ENV: "test" } as NodeJS.ProcessEnv, "/workspace/server.ts"), "sqlite");
    assert.equal(resolveSqlEngineKind({} as NodeJS.ProcessEnv, "/workspace/server.ts"), "sqlite");
  });

  it("production / Cloud Run without DATABASE_URL does not open sqlite", () => {
    const existed = fs.existsSync(sqlitePath);
    const mtime = existed ? fs.statSync(sqlitePath).mtimeMs : 0;

    assert.throws(
      () => resolveSqlEngineKind({ NODE_ENV: "production" } as NodeJS.ProcessEnv, "/workspace/server.ts"),
      /DATABASE_URL/
    );
    assert.throws(
      () =>
        openConfiguredDatabase(
          { NODE_ENV: "production" } as NodeJS.ProcessEnv,
          "/workspace/server.ts"
        ),
      /DATABASE_URL is required/
    );
    assert.throws(
      () =>
        openConfiguredDatabase(
          { K_SERVICE: "lumera-gemini-edit" } as NodeJS.ProcessEnv,
          "/workspace/server.ts"
        ),
      /DATABASE_URL is required/
    );
    assert.throws(
      () => openConfiguredDatabase({} as NodeJS.ProcessEnv, "/app/dist/server.cjs"),
      /DATABASE_URL is required/
    );

    if (existed) {
      assert.equal(fs.statSync(sqlitePath).mtimeMs, mtime, "production fail-fast must not touch lumera.db");
    } else {
      assert.equal(fs.existsSync(sqlitePath), false, "production fail-fast must not create lumera.db");
    }
  });

  it("platform tenant helpers accept SqlDatabase, not node:sqlite DatabaseSync", () => {
    const src = fs.readFileSync(path.join(root, "server/platform-tenants.ts"), "utf8");
    assert.match(src, /from "\.\/sql-engine\.ts"/);
    assert.match(src, /ensurePlatformTenantSchema\(database: SqlDatabase\)/);
    assert.equal(/from "node:sqlite"/.test(src), false);
    assert.equal(/DatabaseSync/.test(src), false);
  });

  it("demo ABHA seed grep still finds LINKED_SANDBOX after db.ts seed split", () => {
    const db = [
      fs.readFileSync(path.join(root, "server/db.ts"), "utf8"),
      fs.readFileSync(path.join(root, "server/db-seed.ts"), "utf8"),
      fs.readFileSync(path.join(root, "server/db-seed-maps.ts"), "utf8"),
      fs.readFileSync(path.join(root, "server/db-seed-clinical.ts"), "utf8"),
      fs.readFileSync(path.join(root, "server/db-seed-meta.ts"), "utf8"),
    ].join("\n");
    assert.equal(/kycStatus:\s*"VERIFIED"/.test(db), false);
    assert.match(db, /kycStatus: "LINKED_SANDBOX"/);
  });

  it("placeholder DATABASE_URL is not a postgres engine", () => {
    assert.throws(
      () =>
        resolveSqlEngineKind(
          { NODE_ENV: "production", DATABASE_URL: "replace-with-postgres-url" } as NodeJS.ProcessEnv,
          "/workspace/server.ts"
        ),
      /DATABASE_URL/
    );
    assert.equal(
      resolveSqlEngineKind(
        { NODE_ENV: "test", DATABASE_URL: "replace-with-postgres-url" } as NodeJS.ProcessEnv,
        "/workspace/server.ts"
      ),
      "sqlite"
    );
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ENV_CATALOG,
  META_GRAPH_PAIR_MESSAGE,
  PARTIAL_CLOUD_SQL_MESSAGE,
  assertEnvExampleDocumentsCatalog,
  assertOptionalEnvShape,
} from "./env-catalog.ts";
import {
  assertRequiredProductionEnv,
  failFastRequiredProductionEnv,
} from "./runtime.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("environment catalog + runtime assertions", () => {
  it("documents every catalog key in .env.example", () => {
    const example = fs.readFileSync(path.join(root, ".env.example"), "utf8");
    assert.doesNotThrow(() => assertEnvExampleDocumentsCatalog(example));
    assert.match(example, /META_ACCESS_TOKEN=/);
    assert.match(example, /META_GRAPH_TOKEN=/);
    assert.match(example, /META_WABA_ID=/);
    assert.match(example, /WHATSAPP_ACCESS_TOKEN=/);
    assert.match(example, /WHATSAPP_PHONE_NUMBER_ID=/);
    assert.match(example, /WHATSAPP_APP_SECRET=/);
    assert.match(example, /CLOUD_SQL_CONNECTION_NAME=/);
    assert.match(example, /INSTANCE_CONNECTION_NAME=/);
    assert.match(example, /postgres:\/\/USER:PASSWORD@\/DBNAME\?host=\/cloudsql\//);
    assert.match(example, /META_BILL_SERVICE_WINDOW=/);
    assert.match(example, /GEMINI_SCRIBE_RAW_COST_INR=/);
    assert.ok(ENV_CATALOG.some((k) => k.name === "DATABASE_URL" && k.requiredInProduction));
    assert.ok(ENV_CATALOG.some((k) => k.name === "JWT_SECRET" && k.requiredInProduction));
  });

  it("accepts local sandbox with Meta / billing / Cloud SQL unset", () => {
    assert.doesNotThrow(() =>
      assertOptionalEnvShape({ NODE_ENV: "development" } as NodeJS.ProcessEnv)
    );
    assert.doesNotThrow(() =>
      assertRequiredProductionEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv)
    );
  });

  it("rejects malformed usage-billing values in every environment", () => {
    assert.throws(
      () =>
        assertOptionalEnvShape({
          GEMINI_SCRIBE_RAW_COST_INR: "not-a-rate",
        } as NodeJS.ProcessEnv),
      /GEMINI_SCRIBE_RAW_COST_INR/
    );
    assert.throws(
      () =>
        assertOptionalEnvShape({
          META_BILL_SERVICE_WINDOW: "sometimes",
        } as NodeJS.ProcessEnv),
      /META_BILL_SERVICE_WINDOW/
    );
    assert.throws(
      () =>
        assertOptionalEnvShape({
          META_SERVICE_WINDOW_CUTOVER: "next-tuesday",
        } as NodeJS.ProcessEnv),
      /META_SERVICE_WINDOW_CUTOVER/
    );
    assert.doesNotThrow(() =>
      assertOptionalEnvShape({
        META_BILL_SERVICE_WINDOW: "true",
        META_FREE_SERVICE_WINDOW: "false",
        META_SERVICE_WINDOW_CUTOVER: "2026-10-01T00:00:00.000Z",
        GEMINI_SCRIBE_RAW_COST_INR: "12.5",
      } as NodeJS.ProcessEnv)
    );
  });

  it("rejects partial Cloud SQL pieces (placeholder DATABASE_URL does not count)", () => {
    assert.throws(
      () =>
        assertOptionalEnvShape({
          INSTANCE_CONNECTION_NAME: "proj:asia-south1:lumera-pg",
          SQL_USER: "lumera",
        } as NodeJS.ProcessEnv),
      new RegExp(PARTIAL_CLOUD_SQL_MESSAGE.slice(0, 24))
    );
    assert.throws(
      () =>
        assertOptionalEnvShape({
          DATABASE_URL: "replace-with-postgres-url",
          CLOUD_SQL_CONNECTION_NAME: "proj:asia-south1:lumera-pg",
        } as NodeJS.ProcessEnv),
      /Partial Cloud SQL/
    );
    assert.doesNotThrow(() =>
      assertOptionalEnvShape({
        INSTANCE_CONNECTION_NAME: "proj:asia-south1:lumera-pg",
        SQL_USER: "lumera",
        SQL_PASSWORD: "s3cret-not-a-placeholder",
        SQL_DB_NAME: "lumera",
      } as NodeJS.ProcessEnv)
    );
  });

  it("production requires the Meta Graph send pair when either half is set", () => {
    assert.throws(
      () =>
        assertOptionalEnvShape({
          NODE_ENV: "production",
          META_ACCESS_TOKEN: "EAAGisAlongEnoughTokenWithoutEllipsis0123456789abcdef",
        } as NodeJS.ProcessEnv),
      new RegExp("META_ACCESS_TOKEN")
    );
    assert.doesNotThrow(() =>
      assertOptionalEnvShape({
        NODE_ENV: "development",
        META_ACCESS_TOKEN: "EAAGisAlongEnoughTokenWithoutEllipsis0123456789abcdef",
      } as NodeJS.ProcessEnv)
    );
    assert.doesNotThrow(() =>
      assertOptionalEnvShape({
        NODE_ENV: "production",
        WHATSAPP_ACCESS_TOKEN: "EAAGisAlongEnoughTokenWithoutEllipsis0123456789abcdef",
        WHATSAPP_PHONE_NUMBER_ID: "123456789012345",
      } as NodeJS.ProcessEnv)
    );
    assert.doesNotThrow(() =>
      assertOptionalEnvShape({
        NODE_ENV: "production",
        META_GRAPH_TOKEN: "EAAGisAlongEnoughTokenWithoutEllipsis0123456789abcdef",
        META_PHONE_NUMBER_ID: "1294483843748285",
      } as NodeJS.ProcessEnv)
    );
    assert.match(META_GRAPH_PAIR_MESSAGE, /META_GRAPH_TOKEN/);
  });

  it("fail-fast runs catalog shape checks before listen in every NODE_ENV", () => {
    const lines: string[] = [];
    const orig = console.error;
    let exitCode: number | undefined;
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      failFastRequiredProductionEnv(
        { NODE_ENV: "development", GEMINI_SCRIBE_RAW_COST_INR: "nope" } as NodeJS.ProcessEnv,
        (code) => {
          exitCode = code;
        }
      );
    } finally {
      console.error = orig;
    }
    assert.equal(exitCode, 1);
    assert.match(lines.join("\n"), /GEMINI_SCRIBE_RAW_COST_INR/);
  });
});

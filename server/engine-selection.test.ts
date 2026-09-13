import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const probe = path.join(root, "server/engine-selection-probe.ts");
const PG_URL = process.env.ENGINE_TEST_DATABASE_URL || "postgres://lumera:lumera@127.0.0.1:55432/lumera";

function runProbe(mode: string, env: Record<string, string | undefined>) {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  delete merged.K_SERVICE;
  delete merged.K_REVISION;
  if (!("K_SERVICE" in env)) delete merged.K_SERVICE;
  if (env.K_SERVICE) merged.K_SERVICE = env.K_SERVICE;
  if (env.K_REVISION) merged.K_REVISION = env.K_REVISION;
  if (!("DATABASE_URL" in env) || env.DATABASE_URL === undefined) delete merged.DATABASE_URL;
  merged.JWT_SECRET = merged.JWT_SECRET || "test-jwt-secret";
  const result = spawnSync(process.execPath, ["--import", "tsx", probe, mode], {
    cwd: root,
    env: merged,
    encoding: "utf8",
    timeout: 90_000,
  });
  const stdout = String(result.stdout || "").trim();
  let parsed: { ok?: boolean; error?: string; n?: number; note?: string; engine?: string } = {};
  try {
    parsed = JSON.parse(stdout) as typeof parsed;
  } catch {
    parsed = { ok: false, error: stdout || String(result.stderr || "unparseable probe output") };
  }
  return { status: result.status, parsed, stderr: String(result.stderr || ""), stdout };
}

describe("getDb / initDatabase engine selection", () => {
  it("DATABASE_URL to real Postgres round-trips through initDatabase()/getDb()", () => {
    const dbSrc = fs.readFileSync(path.join(root, "server/db.ts"), "utf8");
    assert.match(dbSrc, /openConfiguredDatabase/);
    const result = runProbe("postgres", {
      DATABASE_URL: PG_URL,
      NODE_ENV: "test",
      K_SERVICE: undefined,
    });
    assert.equal(result.status, 0, result.stderr || result.parsed.error || result.stdout);
    assert.equal(result.parsed.ok, true, result.parsed.error);
    assert.equal(result.parsed.engine, "postgres");
    assert.equal(result.parsed.n, 1);
    assert.equal(result.parsed.note, "postgres");
  });

  it("DATABASE_URL unset and NODE_ENV !== production uses sqlite fallback via getDb()", () => {
    const result = runProbe("sqlite", {
      DATABASE_URL: undefined,
      NODE_ENV: "test",
      K_SERVICE: undefined,
    });
    assert.equal(result.status, 0, result.stderr || result.parsed.error || result.stdout);
    assert.equal(result.parsed.ok, true, result.parsed.error);
    assert.equal(result.parsed.engine, "sqlite");
    assert.equal(result.parsed.n, 1);
  });

  it("DATABASE_URL unset + K_SERVICE (sqliteFallbackForbidden) makes initDatabase throw", () => {
    const result = runProbe("throw", {
      DATABASE_URL: undefined,
      NODE_ENV: "test",
      K_SERVICE: "lumera-gemini-edit",
    });
    assert.notEqual(result.status, 0);
    assert.equal(result.parsed.ok, false);
    assert.match(String(result.parsed.error || ""), /DATABASE_URL is required/);
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { moduleAnchorUrl } from "./module-anchor.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("moduleAnchorUrl (CJS bundle has no import.meta.url)", () => {
  it("returns a real import.meta.url unchanged", () => {
    const url = "file:///app/server/sqlite-compat.ts";
    assert.equal(moduleAnchorUrl(url, { cwd: "/tmp", argv1: null }), url);
  });

  it("does not hand undefined to createRequire when import.meta.url is missing", () => {
    const script = "/tmp/lumera-anchor/dist/server.cjs";
    const anchor = moduleAnchorUrl(undefined, { cwd: "/tmp/lumera-anchor", argv1: script });
    assert.equal(anchor, pathToFileURL(script).href);
    assert.equal(typeof anchor, "string");
    assert.equal(fileURLToPath(anchor), script);
    assert.equal(path.join(path.dirname(fileURLToPath(anchor)), "pg-sync-worker.cjs"), "/tmp/lumera-anchor/dist/pg-sync-worker.cjs");
    const sqlite = createRequire(anchor)("node:sqlite") as { DatabaseSync: unknown };
    assert.equal(typeof sqlite.DatabaseSync, "function");
  });

  it("treats an empty import.meta.url the same as missing", () => {
    const anchor = moduleAnchorUrl("", { cwd: "/app", argv1: "dist/server.cjs" });
    assert.equal(fileURLToPath(anchor), path.resolve("/app", "dist/server.cjs"));
  });

  it("falls back to cwd/package.json when the script path is missing", () => {
    const anchor = moduleAnchorUrl(undefined, { cwd: "/app", argv1: null });
    assert.equal(anchor, pathToFileURL(path.join("/app", "package.json")).href);
    assert.doesNotThrow(() => createRequire(anchor));
  });

  it("production sources do not pass raw import.meta.url into path APIs", () => {
    const compat = fs.readFileSync(path.join(root, "server/sqlite-compat.ts"), "utf8");
    const shim = fs.readFileSync(path.join(root, "server/pg-shim.ts"), "utf8");
    assert.equal(/createRequire\(\s*import\.meta\.url\s*\)/.test(compat), false);
    assert.match(compat, /createRequire\(moduleAnchorUrl\(import\.meta\.url\)\)/);
    assert.equal(/fileURLToPath\(\s*import\.meta\.url\s*\)/.test(shim), false);
    assert.match(shim, /fileURLToPath\(moduleAnchorUrl\(import\.meta\.url\)\)/);
  });
});

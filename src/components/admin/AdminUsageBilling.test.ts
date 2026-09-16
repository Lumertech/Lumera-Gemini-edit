import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "AdminUsageBilling.tsx"), "utf8");
const shell = readFileSync(join(here, "AdminShell.tsx"), "utf8");

describe("AdminUsageBilling console", () => {
  it("is a new admin file wired into Superadmin tabs, not AdminMetaTechProvider", () => {
    assert.match(src, /data-testid="admin-usage-billing"/);
    assert.match(src, /\/api\/admin\/usage-markup/);
    assert.match(src, /\/api\/admin\/usage-billing\/margin/);
    assert.match(src, /\/api\/admin\/usage-billing\/tenants/);
    assert.match(src, /20% placeholder/);
    assert.match(src, /ravee@lumer\.me/);
    assert.match(src, /not a[\s\S]+certified Meta Tech Provider/);
    assert.match(shell, /AdminUsageBilling/);
    assert.match(shell, /id: "usage"/);
    const meta = readFileSync(join(here, "AdminMetaTechProvider.tsx"), "utf8");
    assert.equal(meta.includes("usage-markup"), false);
  });
});

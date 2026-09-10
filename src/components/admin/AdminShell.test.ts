import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "AdminShell.tsx"), "utf8");

describe("AdminShell tab remounts", () => {
  it("remounts Profile, People, Branches, Settings (and other tabs) on adminTab change", () => {
    assert.match(src, /key=\{adminTab\}/);
    assert.match(src, /data-testid="admin-tab-remount"/);
    assert.match(src, /profile: <AdminProfile \/>/);
    assert.match(src, /people: <AdminPeople \/>/);
    assert.match(src, /branches: <AdminBranches \/>/);
    assert.match(src, /settings: <AdminSettings \/>/);
    assert.match(src, /users: <AdminUsers \/>/);
  });
});

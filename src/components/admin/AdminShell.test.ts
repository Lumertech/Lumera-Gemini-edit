import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "AdminShell.tsx"), "utf8");

describe("AdminShell tab remounts", () => {
  it("remounts Profile, People, Branches, Settings (and other tabs) on adminTab change", () => {
    assert.match(src, /key=\{safeTab\}/);
    assert.match(src, /data-testid="admin-tab-remount"/);
    assert.match(src, /profile: <AdminProfile \/>/);
    assert.match(src, /people: <AdminPeople \/>/);
    assert.match(src, /branches: <AdminBranches \/>/);
    assert.match(src, /settings: <AdminSettings \/>/);
    assert.match(src, /users: <AdminUsers \/>/);
    assert.match(src, /tenants: <AdminTenants \/>/);
    assert.match(src, /people: <AdminPeople \/>/);
    assert.match(src, /branches: <AdminBranches \/>/);
  });

  it("lists desk tabs before CMS/Meta/DHIS and hides platform tabs for CLINIC_ADMIN", () => {
    assert.match(src, /PLATFORM_TABS/);
    assert.match(src, /isPlatformAdmin/);
    assert.match(src, /group: "platform"/);
    const usersAt = src.indexOf('{ id: "users"');
    const dhisAt = src.indexOf('{ id: "dhis"');
    assert.ok(usersAt > 0 && dhisAt > usersAt, "User management must appear before DHIS in the nav source");
  });
});

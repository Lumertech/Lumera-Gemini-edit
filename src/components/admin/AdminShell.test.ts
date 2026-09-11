import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { isAdminNavItemVisible } from "./adminNav";

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
    assert.match(src, /isAdminNavItemVisible/);
    assert.match(src, /SUPERADMIN_TABS/);
    assert.match(src, /isPlatformAdmin/);
    assert.match(src, /group: "platform"/);
    assert.match(src, /group: "superadmin"/);
    const usersAt = src.indexOf('{ id: "users"');
    const tenantsAt = src.indexOf('{ id: "tenants"');
    const dhisAt = src.indexOf('{ id: "dhis"');
    assert.ok(usersAt > 0 && dhisAt > usersAt, "User management must appear before DHIS in the nav source");
    assert.ok(tenantsAt > 0 && dhisAt > tenantsAt, "Tenants must appear before DHIS in the nav source");
    assert.match(src, /data-testid=\{\`admin-nav-\$\{item\.id\}\`\}/);
    assert.match(src, /adminTabToPath\(item\.id\)/);
    assert.equal(isAdminNavItemVisible("CLINIC_ADMIN", "dhis"), false);
    assert.equal(isAdminNavItemVisible("CLINIC_ADMIN", "meta"), false);
    assert.equal(isAdminNavItemVisible("super_admin", "dhis"), true);
  });

  it("hides Branches from super_admin nav and keeps Branches for clinic admins", () => {
    assert.equal(isAdminNavItemVisible("super_admin", "branches"), false);
    assert.equal(isAdminNavItemVisible("CLINIC_ADMIN", "branches"), true);
    assert.equal(isAdminNavItemVisible("polyclinic_admin", "branches"), true);
    assert.equal(isAdminNavItemVisible("super_admin", "people"), true);
    assert.equal(isAdminNavItemVisible("super_admin", "settings"), true);
    assert.equal(isAdminNavItemVisible("super_admin", "tenants"), true);
    assert.equal(isAdminNavItemVisible("super_admin", "subscriptions"), true);
    assert.equal(isAdminNavItemVisible("CLINIC_ADMIN", "tenants"), false);
    assert.equal(isAdminNavItemVisible("CLINIC_ADMIN", "subscriptions"), false);
    assert.equal(isAdminNavItemVisible("polyclinic_admin", "tenants"), false);
    assert.match(src, /\{ id: "branches", label: "Branches"/);
    assert.match(src, /CLINIC_BRANCH_TABS\.has\(adminTab\) && isPlatformAdmin/);
    assert.match(src, /data-testid="clinic-branches-tab-forbidden"/);
    assert.match(src, /data-testid="superadmin-tab-forbidden"/);
    assert.match(src, /Super Admin has no Branches/);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tenants = readFileSync(join(here, "AdminTenants.tsx"), "utf8");
const panel = readFileSync(join(here, "TenantSubscriptionPanel.tsx"), "utf8");
const shell = readFileSync(join(here, "AdminShell.tsx"), "utf8");
const subs = readFileSync(join(here, "AdminSubscriptions.tsx"), "utf8");
const auth = readFileSync(join(here, "../../auth/AuthContext.tsx"), "utf8");
const catalog = readFileSync(join(here, "../../lib/adminTenants.ts"), "utf8");

describe("Superadmin Tenants console (#54 UI)", () => {
  it("lists tenants from Platform APIs and persists create / status / subscription", () => {
    assert.match(tenants, /\/api\/admin\/tenants/);
    assert.match(tenants, /\/api\/admin\/plans/);
    assert.match(tenants, /method: "POST"/);
    assert.match(tenants, /method: "PATCH"/);
    assert.match(tenants, /planCode: form\.planCode/);
    assert.match(tenants, /data-testid="admin-tenant-create-modal"/);
    assert.match(tenants, /data-testid="admin-tenants-empty"/);
    assert.match(tenants, /data-testid="admin-tenants-create"/);
    assert.match(tenants, /data-testid="tenant-suspend"/);
    assert.match(tenants, /data-testid="tenant-reinstate"/);
    assert.match(tenants, /data-testid="tenant-soft-delete"/);
    assert.match(tenants, /Create tenant/);
    assert.doesNotMatch(tenants, /Read-only roster grouped by/);
    assert.equal(tenants.includes("console.log"), false);
  });

  it("subscription panel assigns catalog plans and never claims PSP-paid", () => {
    assert.match(panel, /\/api\/admin\/tenants\/\$\{tenantId\}\/subscription/);
    assert.match(panel, /billingSource: "manual"/);
    assert.match(panel, /data-testid="subscription-honesty-label"/);
    assert.match(panel, /honestyCaption/);
    assert.doesNotMatch(panel, /billingSource: "razorpay"/);
    assert.doesNotMatch(panel, /billingSource: "paid"/);
    assert.match(panel, /SUBSCRIPTION_STATUSES/);
    assert.match(catalog, /"past_due"/);
    assert.match(catalog, /"canceled"/);
    assert.match(subs, /honestyCaption/);
    assert.match(subs, /billingSource: "manual"/);
    assert.match(subs, /Tenant subscriptions \(SoT\)/);
  });

  it("gates Tenants + all-tenant Subs to super_admin and shows tenant context switcher", () => {
    assert.match(shell, /SUPERADMIN_TABS/);
    assert.match(shell, /group: "superadmin"/);
    assert.match(shell, /data-testid="tenant-context-switcher"/);
    assert.match(shell, /Exit to platform/);
    assert.match(shell, /clearScope\(\)/);
    assert.match(shell, /item\.id === "tenants" && !isPlatformAdmin/);
    assert.match(shell, /data-testid="superadmin-tab-forbidden"/);
    const tenantsAt = shell.indexOf('{ id: "tenants"');
    const dhisAt = shell.indexOf('{ id: "dhis"');
    const metaAt = shell.indexOf('{ id: "meta"');
    assert.ok(tenantsAt > 0 && dhisAt > tenantsAt, "Tenants must appear before DHIS/CMS in nav");
    assert.ok(metaAt > tenantsAt, "Tenants must appear before Meta in nav");
    assert.match(auth, /clearTenantScope\(\)/);
  });
});

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { getDb, initDatabase } from "./db.ts";
import { resolveTenantByDomain, seedDemoTenantDomains } from "./tenant-domain.ts";
import { findTenantByPatientPhone } from "./meta.ts";
import { tenantIdFromReceivingPhoneNumberId } from "./whatsapp-tenant-resolve.ts";

describe("Tenant Multi-Tenancy & Domain Routing", () => {
  before(() => {
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const db = getDb();
    seedDemoTenantDomains(db);
  });

  it("1. Resolves Malhotra Individual Practice by dedicated custom domain and subdomain", () => {
    const db = getDb();
    const exact = resolveTenantByDomain(db, "malhotra.mylumera.in");
    assert.ok(exact, "Should resolve by custom domain");
    assert.equal(exact.tenantId, "tenant-demo-individual");
    assert.equal(exact.slug, "malhotra-individual-practice");

    const localSub = resolveTenantByDomain(db, "malhotra.localhost:3000");
    assert.ok(localSub, "Should resolve by local subdomain");
    assert.equal(localSub.tenantId, "tenant-demo-individual");
  });

  it("2. Resolves Iyer City Polyclinic by dedicated domain and subdomain", () => {
    const db = getDb();
    const exact = resolveTenantByDomain(db, "iyer-city.mylumera.in");
    assert.ok(exact, "Should resolve by polyclinic domain");
    assert.equal(exact.tenantId, "tenant-demo-polyclinic");
    assert.equal(exact.slug, "iyer-city-polyclinic");
  });

  it("3. Resolves Sunrise Clinic by dedicated domain", () => {
    const db = getDb();
    const exact = resolveTenantByDomain(db, "sunrise.mylumera.in");
    assert.ok(exact, "Should resolve sunrise clinic");
    assert.equal(exact.tenantId, "tenant-543feff7");
    assert.equal(exact.slug, "sunrise-clinic");
  });

  it("4. Bare platform domains (www.mylumera.in, localhost) return null to preserve platform root", () => {
    const db = getDb();
    assert.equal(resolveTenantByDomain(db, "www.mylumera.in"), null);
    assert.equal(resolveTenantByDomain(db, "mylumera.in"), null);
    assert.equal(resolveTenantByDomain(db, "localhost:3000"), null);
  });

  it("5. Default Lumera host number 1294483843748285 resolves to tenant-lumera-main", () => {
    const tenantId = tenantIdFromReceivingPhoneNumberId("1294483843748285");
    assert.equal(tenantId, "tenant-lumera-main");
  });

  it("6. Inbound message routes to registered patient's demo practice", () => {
    const db = getDb();
    // Ensure test patient exists under Malhotra practice
    try {
      db.prepare(`
        INSERT OR REPLACE INTO patients (id, tenant_id, uhid, name, age, gender, phone, created_at)
        VALUES ('pat-test-malhotra', 'tenant-demo-individual', 'LUM-MAL-01', 'Test Malhotra Patient', 40, 'Male', '+919811101061', datetime('now'))
      `).run();
    } catch {
      /* ignore */
    }

    const resolved = findTenantByPatientPhone(db, "+919811101061");
    assert.equal(resolved, "tenant-demo-individual");
  });
});

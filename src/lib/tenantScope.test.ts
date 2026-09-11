import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTenantScope, serializeTenantScope } from "./tenantScope.ts";

describe("tenant scope persistence (#54 SA-1)", () => {
  it("round-trips tenant name + id", () => {
    const raw = serializeTenantScope({ id: "tenant-lumera-main", name: "Lumera Demo" });
    assert.deepEqual(parseTenantScope(raw), { id: "tenant-lumera-main", name: "Lumera Demo" });
  });

  it("rejects empty or invalid payloads so scope cannot leak a blank tenant", () => {
    assert.equal(parseTenantScope(null), null);
    assert.equal(parseTenantScope(""), null);
    assert.equal(parseTenantScope("{"), null);
    assert.equal(parseTenantScope(JSON.stringify({ name: "Nope" })), null);
    assert.equal(parseTenantScope(JSON.stringify({ id: "   " })), null);
  });

  it("falls back to id when name is missing", () => {
    assert.deepEqual(parseTenantScope(JSON.stringify({ id: "tenant-x" })), { id: "tenant-x", name: "tenant-x" });
  });
});

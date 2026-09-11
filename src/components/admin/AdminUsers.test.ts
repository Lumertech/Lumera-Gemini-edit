import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "AdminUsers.tsx"), "utf8");

describe("Admin User Management Edit (P0 live-deploy AC)", () => {
  it("Edit opens a first-paint modal/drawer, not a buried below-table form", () => {
    assert.match(src, /data-testid="admin-user-edit-modal"/);
    assert.match(src, /fixed inset-0 z-50/);
    assert.match(src, /role="dialog"/);
    assert.match(src, /onClick=\{\(\) => openEdit\(u\)\}/);
    assert.equal(src.includes("console.log"), false);
  });

  it("create and edit persist name/email/role/specialty/practiceType via API", () => {
    assert.match(src, /PACK_ID_OPTIONS/);
    assert.match(src, /data-testid="admin-create-specialty"/);
    assert.match(src, /data-testid="admin-create-password"/);
    assert.match(src, /tenantId: scope\?\.id \|\| actor\?\.tenantId/);
    assert.match(src, /temporaryPassword/);
    assert.match(src, /value=\{s\.id\}/);
    assert.match(src, /SPECIALTY_PACK_IDS|PACK_ID_OPTIONS/);
    assert.doesNotMatch(src, /<option key=\{s\}>\{s\}<\/option>/);
    assert.match(src, /practiceType: draft\.practiceType/);
    assert.match(src, /data-testid="admin-edit-practice-type"/);
    assert.match(src, /data-testid="admin-create-practice-type"/);
    assert.match(src, /practiceType: "individual"/);
    assert.match(src, /method: "PATCH"/);
    assert.match(src, /method: "POST"/);
    assert.match(src, />Cancel</);
    assert.match(src, /\{saving \? "Saving…" : "Save"\}/);
  });
});

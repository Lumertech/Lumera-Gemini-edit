import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAppWorkspaceRootPath,
  slugifyWorkspace,
  workspaceSlugFromUser,
} from "./workspacePath.ts";

describe("workspace URL slug", () => {
  it("slugifies clinic and doctor names for /w/:workspace/whatsapp", () => {
    assert.equal(slugifyWorkspace("Dr. Demo Physio"), "dr-demo-physio");
    assert.equal(
      workspaceSlugFromUser({
        name: "Dr. Demo Physio",
        email: "physio.doctor@lumera.me",
        specialty: "physio",
        packId: "physio",
        tenantId: "tenant-lumera-main",
      }),
      "dr-demo-physio"
    );
    assert.equal(
      workspaceSlugFromUser({
        clinicName: "Varma Rehab Clinic",
        name: "Dr. Siddharth Varma (PT)",
        packId: "physio",
      }),
      "varma-rehab-clinic"
    );
    assert.equal(isAppWorkspaceRootPath("/app"), true);
    assert.equal(isAppWorkspaceRootPath("/w/dr-demo-physio"), true);
    assert.equal(isAppWorkspaceRootPath("/w/dr-demo-physio/whatsapp"), false);
    assert.equal(isAppWorkspaceRootPath("/app/whatsapp"), false);
  });
});

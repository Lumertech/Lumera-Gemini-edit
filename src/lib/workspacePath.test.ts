import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAppWorkspaceRootPath,
  reconcileWorkspacePath,
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
    assert.equal(
      workspaceSlugFromUser({
        workspaceSlug: "iyer-city-polyclinic",
        clinicName: "Lumera Apex PolyClinic",
        name: "Dr. Demo Physio",
      }),
      "iyer-city-polyclinic"
    );
  });

  it("redirects a slug mismatch to the session tenant and keeps Super Admin off /w", () => {
    assert.equal(
      reconcileWorkspacePath("/w/lumera-apex-polyclinic/rx", "malhotra-individual-practice", "doctor"),
      "/w/malhotra-individual-practice/rx"
    );
    assert.equal(
      reconcileWorkspacePath("/w/lumera-apex-polyclinic/queue", "malhotra-individual-practice", "doctor"),
      "/w/malhotra-individual-practice/queue"
    );
    assert.equal(
      reconcileWorkspacePath("/w/lumera-apex-polyclinic/queue", "lumera-apex-polyclinic", "doctor"),
      null
    );
    assert.equal(reconcileWorkspacePath("/w/malhotra-individual-practice/rx", "malhotra-individual-practice", "doctor"), null);
    assert.equal(reconcileWorkspacePath("/app/queue", "iyer-city-polyclinic", "CLINIC_ADMIN"), "/w/iyer-city-polyclinic/queue");
    assert.equal(
      reconcileWorkspacePath("/app/patients/Pat-KeepCase", "iyer-city-polyclinic", "doctor"),
      "/w/iyer-city-polyclinic/patients/Pat-KeepCase"
    );
    assert.equal(
      reconcileWorkspacePath("/w/other-clinic/patients/pat-42", "iyer-city-polyclinic", "doctor"),
      "/w/iyer-city-polyclinic/patients/pat-42"
    );
    assert.equal(
      reconcileWorkspacePath("/w/iyer-city-polyclinic/patients/pat-42", "iyer-city-polyclinic", "doctor"),
      null
    );
    assert.equal(reconcileWorkspacePath("/w/iyer-city-polyclinic/branches", "iyer-city-polyclinic", "super_admin"), "/admin");
    assert.equal(reconcileWorkspacePath("/admin/tenants", "lumera-apex-polyclinic", "super_admin"), null);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { canManageClinicBranches, isClinicBranchRole, withoutClinicBranchView } from "./clinicBranches.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("clinic branch visibility", () => {
  it("gives Branches only to polyclinic clinic admin", () => {
    assert.equal(isClinicBranchRole("CLINIC_ADMIN"), true);
    assert.equal(isClinicBranchRole("polyclinic_admin"), true);
    assert.equal(isClinicBranchRole("super_admin"), false);
    assert.equal(isClinicBranchRole("doctor"), false);
    assert.equal(isClinicBranchRole("receptionist"), false);

    assert.equal(canManageClinicBranches({ role: "CLINIC_ADMIN", practiceType: "polyclinic" }), true);
    assert.equal(canManageClinicBranches({ role: "polyclinic_admin", practiceType: "multispecialty" }), true);
    assert.equal(canManageClinicBranches({ role: "CLINIC_ADMIN", practiceType: "individual" }), false);
    assert.equal(canManageClinicBranches({ role: "super_admin", practiceType: "polyclinic" }), false);
    assert.equal(canManageClinicBranches({ role: "doctor", practiceType: "individual" }), false);
    assert.equal(canManageClinicBranches({ role: "doctor", practiceType: "polyclinic" }), false);
    assert.equal(canManageClinicBranches({ role: "receptionist", practiceType: "individual" }), false);
  });

  it("strips the branches view unless the signed-in user can manage them", () => {
    const views = ["queue", "polyclinic", "branches", "settings"] as const;
    assert.deepEqual(
      withoutClinicBranchView(views, { role: "CLINIC_ADMIN", practiceType: "polyclinic" }),
      ["queue", "polyclinic", "branches", "settings"]
    );
    assert.deepEqual(
      withoutClinicBranchView(views, { role: "super_admin", practiceType: "polyclinic" }),
      ["queue", "polyclinic", "settings"]
    );
    assert.deepEqual(
      withoutClinicBranchView(views, { role: "doctor", practiceType: "individual" }),
      ["queue", "polyclinic", "settings"]
    );
  });

  it("wires Branches nav and roster CRUD for clinic admin, not a hardcoded apex workspace", () => {
    const sidebar = readFileSync(join(root, "src/components/Sidebar.tsx"), "utf8");
    const roster = readFileSync(join(root, "src/components/PolyclinicManager.tsx"), "utf8");
    const app = readFileSync(join(root, "src/ClinicianApp.tsx"), "utf8");
    assert.match(sidebar, /id: 'branches' as NavView/);
    assert.match(sidebar, /label: 'Branches'/);
    assert.match(sidebar, /withoutClinicBranchView/);
    assert.match(roster, /data-testid="polyclinic-branches"/);
    assert.match(roster, /canManageBranches &&/);
    assert.match(app, /openBranchInClinic/);
    assert.match(app, /data-testid="active-branch-banner"/);
    assert.match(app, /setCurrentView\('queue'\)/);
    assert.equal(sidebar.includes("lumera-apex-polyclinic"), false);
    assert.equal(app.includes("lumera-apex-polyclinic"), false);
    assert.equal(roster.includes("lumera-apex-polyclinic"), false);
  });
});

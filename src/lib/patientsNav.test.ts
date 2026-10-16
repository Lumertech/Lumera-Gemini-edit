import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLE_VISIBLE_VIEWS, sidebarShowsClinicalChrome, visibleViewsForRole } from "../components/Sidebar.tsx";
import type { AppUser } from "../types.ts";
import { allowedViewsForWorkflow, patientsNavLabel, workflowForUser } from "./specialtyWorkflow.ts";

function asUser(partial: Partial<AppUser> & Pick<AppUser, "role">): AppUser {
  return {
    id: "u",
    email: "clinician@example.test",
    name: "Clinician",
    status: "active",
    phone: "",
    lastLogin: null,
    createdAt: "",
    ...partial,
  };
}

describe("Patients tab visibility", () => {
  it("shows the patients route to doctor, clinic admin, and receptionist only", () => {
    for (const role of ["doctor", "receptionist", "CLINIC_ADMIN", "polyclinic_admin"]) {
      assert.equal(ROLE_VISIBLE_VIEWS[role].includes("patients"), true, role);
    }
    for (const role of ["super_admin", "patient", "nurse", "pharmacist", "lab_technician"]) {
      assert.equal(ROLE_VISIBLE_VIEWS[role]?.includes("patients") ?? false, false, role);
    }
    assert.deepEqual(visibleViewsForRole("super_admin"), []);
    assert.deepEqual(visibleViewsForRole("admin"), []);
    assert.equal(sidebarShowsClinicalChrome("super_admin"), false);
    assert.equal(sidebarShowsClinicalChrome("doctor"), true);
    const clinical = [
      "patients",
      "queue",
      "opd-queue",
      "reception",
      "rx",
      "smart-rx",
      "ambient",
      "reports",
      "appointments",
      "billing",
      "whatsapp",
      "pharmacy-hub",
      "kiosk",
      "settings",
    ];
    for (const view of clinical) {
      assert.equal(visibleViewsForRole("super_admin").includes(view as never), false, view);
    }
    for (const specialty of [
      "General Medicine",
      "Physiotherapy & Rehabilitation",
      "Dental Surgery",
      "Wellness & Spas",
      "Psychiatry & Mental Health",
      "Consulting",
    ]) {
      const views = allowedViewsForWorkflow(
        visibleViewsForRole("doctor"),
        workflowForUser(asUser({ role: "doctor", specialty }))
      );
      assert.equal(views.includes("patients"), true, specialty);
    }
    assert.equal(visibleViewsForRole("CLINIC_ADMIN").includes("patients"), true);
    assert.equal(visibleViewsForRole("receptionist").includes("patients"), true);
    assert.equal(visibleViewsForRole("receptionist").includes("rx"), false);
    assert.equal(visibleViewsForRole("receptionist").includes("smart-rx"), false);
  });

  it("keeps pack-specific labels on the patients route", () => {
    assert.equal(patientsNavLabel(workflowForUser(asUser({ role: "doctor", specialty: "General Medicine" }))), "Patients");
    assert.equal(patientsNavLabel(workflowForUser(asUser({ role: "doctor", specialty: "Wellness & Spas" }))), "Guests");
    assert.equal(
      patientsNavLabel(workflowForUser(asUser({ role: "doctor", specialty: "Psychiatry & Mental Health" }))),
      "Clients"
    );
    assert.equal(patientsNavLabel(workflowForUser(asUser({ role: "doctor", specialty: "Consulting" }))), "Clients");
    assert.equal(patientsNavLabel(workflowForUser(asUser({ role: "receptionist" }))), "Patients");
  });
});

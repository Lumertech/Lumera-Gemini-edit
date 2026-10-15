import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLE_VISIBLE_VIEWS } from "../components/Sidebar.tsx";
import type { AppUser } from "../types.ts";
import { patientsNavLabel, workflowForUser } from "./specialtyWorkflow.ts";

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

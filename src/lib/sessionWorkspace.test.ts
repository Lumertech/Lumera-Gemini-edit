import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppUser, Doctor } from "../types";
import { doctorFromUser, resolveSessionDoctor } from "./sessionWorkspace";

function user(role: AppUser["role"], name: string): AppUser {
  return {
    id: `user-${role}`,
    tenantId: "tenant-a",
    email: `${role}@clinic.example`,
    name,
    role,
    status: "active",
    phone: "",
    lastLogin: null,
    createdAt: "2026-10-16T00:00:00.000Z",
    clinicName: "Sunrise Family Clinic",
    onboardingCompleted: true,
    specialty: "General Medicine",
    practiceType: "individual",
    isDemoWorkspace: false,
  };
}

describe("doctorFromUser", () => {
  it("does not invent a consulting doctor for reception or admin-only roles", () => {
    for (const role of ["receptionist", "polyclinic_admin", "CLINIC_ADMIN", "super_admin", "patient"] as const) {
      const built = doctorFromUser(user(role, "Priya Deshmukh"));
      assert.equal(built.id, "", role);
      assert.equal(built.name, "", role);
      assert.equal(built.name.includes("Priya"), false, role);
    }
    const doctor = doctorFromUser(user("doctor", "Ananya Sen"));
    assert.equal(doctor.name, "Dr. Ananya Sen");
    assert.ok(doctor.id);
  });

  it("still returns a doctor row linked to the signed-in user", () => {
    const row = {
      id: "doc-ananya",
      userId: "user-doctor",
      name: "Dr. Ananya Sen",
    } as Doctor;
    const resolved = resolveSessionDoctor(user("doctor", "Ananya Sen"), [row]);
    assert.equal(resolved.id, "doc-ananya");
    assert.equal(resolved.name, "Dr. Ananya Sen");
  });
});

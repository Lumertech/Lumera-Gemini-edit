import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppUser } from "../types.ts";
import { tenantRouteGuard } from "./routeGuard.ts";

function user(partial: Partial<AppUser> & Pick<AppUser, "role">): AppUser {
  return {
    id: "u",
    email: "clinician@example.test",
    name: "Clinician",
    status: "active",
    phone: "",
    lastLogin: null,
    createdAt: "",
    practiceType: "individual",
    onboardingCompleted: true,
    ...partial,
  };
}

describe("tenant route guard", () => {
  it("sends a receptionist off rx/:visitId to their reception desk", () => {
    const decision = tenantRouteGuard(
      user({ role: "receptionist", email: "reception@lumera.me" }),
      "/w/physiodoctor-practice/rx/visit-88"
    );
    assert.equal(decision.redirect, "/w/physiodoctor-practice/reception");
  });

  it("leaves a doctor on the visit and a receptionist on reception", () => {
    const doctor = tenantRouteGuard(
      user({ role: "doctor", email: "doctor@lumera.me", specialty: "General Medicine" }),
      "/w/malhotra-individual-practice/rx/visit-88"
    );
    assert.equal(doctor.redirect, null);
    const desk = tenantRouteGuard(
      user({ role: "receptionist", email: "reception@lumera.me" }),
      "/w/physiodoctor-practice/reception"
    );
    assert.equal(desk.redirect, null);
  });

  it("keeps Super Admin off /w and on /admin", () => {
    assert.equal(
      tenantRouteGuard(user({ role: "super_admin", email: "admin@lumera.me" }), "/w/physiodoctor-practice/opd").redirect,
      "/admin"
    );
    assert.equal(
      tenantRouteGuard(user({ role: "super_admin", email: "admin@lumera.me" }), "/admin/tenants").redirect,
      null
    );
  });

  it("sends an individual clinic off the polyclinic roster to OPD", () => {
    const decision = tenantRouteGuard(
      user({ role: "doctor", practiceType: "individual", specialty: "General Medicine" }),
      "/w/malhotra-individual-practice/polyclinic"
    );
    assert.equal(decision.redirect, "/w/malhotra-individual-practice/opd");
  });
});

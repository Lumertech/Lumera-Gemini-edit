import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "./demoAccounts.ts";
import {
  clinicianHomeView,
  resolveRxModule,
  workflowForUser,
} from "./specialtyWorkflow.ts";
import type { AppUser } from "../types.ts";

function fakeUser(email: string, specialty: string, role: AppUser["role"] = "doctor"): AppUser {
  return {
    id: `id-${email}`,
    email,
    name: email,
    role,
    status: "active",
    phone: "",
    lastLogin: null,
    createdAt: "",
    specialty,
    isDemoWorkspace: true,
  };
}

describe("specialty workflow packs", () => {
  it("keeps one shared demo password", () => {
    assert.equal(DEMO_PASSWORD, "Lumera@2026");
    assert.ok(DEMO_ACCOUNTS.some((a) => a.email === "dentist@lumera.me"));
    assert.ok(DEMO_ACCOUNTS.some((a) => a.email === "physio@lumera.me"));
    assert.ok(DEMO_ACCOUNTS.some((a) => a.email === "therapist@lumera.me"));
    assert.ok(DEMO_ACCOUNTS.some((a) => a.email === "wellness@lumera.me"));
    assert.ok(DEMO_ACCOUNTS.some((a) => a.email === "consultant@lumera.me"));
    const allowed = new Set(["", "gp", "physio", "dentist", "spa_salon", "therapist", "consultant"]);
    for (const acct of DEMO_ACCOUNTS) {
      assert.ok(allowed.has(acct.specialty), `${acct.email} specialty=${acct.specialty}`);
    }
  });

  it("does not collapse spa / physio / dentist / GP into one pack", () => {
    const gp = workflowForUser(fakeUser("doctor@lumera.me", "gp"));
    const dentist = workflowForUser(fakeUser("dentist@lumera.me", "dentist"));
    const physio = workflowForUser(fakeUser("physio@lumera.me", "physio"));
    const spa = workflowForUser(fakeUser("wellness@lumera.me", "spa_salon"));
    const therapist = workflowForUser(fakeUser("therapist@lumera.me", "therapist"));
    const consultant = workflowForUser(fakeUser("consultant@lumera.me", "consultant"));

    assert.equal(gp.kind, "medical");
    assert.equal(dentist.kind, "dental");
    assert.equal(physio.kind, "physio");
    assert.equal(spa.kind, "wellness");
    assert.equal(therapist.kind, "therapy");
    assert.equal(consultant.kind, "consultant");

    assert.notEqual(spa.homeView, gp.homeView);
    assert.equal(spa.showMedicalRx, false);
    assert.equal(consultant.showMedicalRx, false);
    assert.equal(therapist.showMedicalRx, false);
    assert.equal(physio.showMedicalRx, true);
    assert.equal(dentist.rxModule, "Dental Surgery");
    assert.equal(clinicianHomeView(fakeUser("wellness@lumera.me", "spa_salon")), "wellness");
    assert.equal(clinicianHomeView(fakeUser("therapist@lumera.me", "therapist")), "therapy-session");
    assert.equal(clinicianHomeView(fakeUser("dentist@lumera.me", "dentist")), "queue");
    assert.equal(clinicianHomeView(fakeUser("physio@lumera.me", "physio")), "queue");
  });

  it("lands role-homes: receptionist, individual GP pack, explicit polyclinic clinic-admin", () => {
    const reception = fakeUser("receptionist@lumera.me", "", "receptionist");
    reception.practiceType = "individual";
    assert.equal(clinicianHomeView(reception), "reception");

    const gp = fakeUser("doctor@lumera.me", "gp");
    gp.practiceType = "individual";
    assert.equal(clinicianHomeView(gp), "queue");
    assert.equal(workflowForUser(gp).kind, "medical");

    const clinicAdmin = fakeUser("clinic.admin@lumera.me", "gp", "CLINIC_ADMIN");
    clinicAdmin.practiceType = "polyclinic";
    assert.equal(clinicianHomeView(clinicAdmin), "welcome");
  });

  it("maps specialty strings onto existing Rx modules", () => {
    assert.equal(resolveRxModule("dentist"), "Dental Surgery");
    assert.equal(resolveRxModule("Physio"), "Physiotherapy & Rehabilitation");
    assert.equal(resolveRxModule("spa"), "Wellness & Spas");
  });
});

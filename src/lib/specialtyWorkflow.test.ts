import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "./demoAccounts.ts";
import {
  clinicianHomeView,
  resolveRxModule,
  workflowFingerprint,
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

    assert.equal(spa.showMedicalRx, false);
    assert.equal(consultant.showMedicalRx, false);
    assert.equal(therapist.showMedicalRx, false);
    assert.equal(physio.showMedicalRx, true);
    assert.equal(dentist.rxModule, "Dental Surgery");
    assert.equal(clinicianHomeView(fakeUser("wellness@lumera.me", "spa_salon")), "wellness");
    assert.equal(clinicianHomeView(fakeUser("therapist@lumera.me", "therapist")), "therapy-session");
    assert.equal(clinicianHomeView(fakeUser("dentist@lumera.me", "dentist")), "dental-chart");
    assert.equal(clinicianHomeView(fakeUser("physio@lumera.me", "physio")), "physio-session");

    const homes = new Set([gp.homeView, dentist.homeView, physio.homeView, spa.homeView, therapist.homeView, consultant.homeView]);
    assert.equal(homes.size, 6, "each vertical must land a different role-home");

    const fingerprints = [gp, dentist, physio, spa, therapist, consultant].map(workflowFingerprint);
    for (let i = 0; i < fingerprints.length; i++) {
      for (let j = i + 1; j < fingerprints.length; j++) {
        assert.notDeepEqual(fingerprints[i], fingerprints[j], "packs must differ by workflow, not titles");
      }
    }
    assert.equal(gp.noteKind, "medical-rx");
    assert.equal(physio.noteKind, "physio-plan");
    assert.equal(dentist.noteKind, "dental-chart");
    assert.equal(spa.noteKind, "service-ticket");
    assert.equal(gp.billingLens, "consult-and-pharmacy");
    assert.equal(physio.billingLens, "session-and-package");
    assert.equal(dentist.billingLens, "procedure-fee");
    assert.equal(spa.billingLens, "service-and-package");
    assert.equal(gp.formularyLens, "who-eml");
    assert.equal(physio.formularyLens, "rehab-exercises");
    assert.equal(dentist.formularyLens, "dental-materials");
    assert.equal(spa.formularyLens, "salon-menu");
    assert.ok(!physio.intakeFields.some((f) => gp.intakeFields.some((g) => g.key === f.key)));
    assert.ok(!dentist.intakeFields.some((f) => gp.intakeFields.some((g) => g.key === f.key)));
    assert.ok(!spa.intakeFields.some((f) => gp.intakeFields.some((g) => g.key === f.key)));
  });

  it("treats cardio/derma/peds as GP pack config, not forked verticals", () => {
    const gp = workflowForUser(fakeUser("doctor@lumera.me", "gp"));
    const cardioPack = workflowForUser(fakeUser("cardiology@lumera.me", "Cardiology"));
    const dermaPack = workflowForUser(fakeUser("dermatology@lumera.me", "Dermatology"));
    assert.equal(cardioPack.kind, "medical");
    assert.equal(cardioPack.homeView, gp.homeView);
    assert.equal(cardioPack.noteKind, gp.noteKind);
    assert.equal(cardioPack.billingLens, gp.billingLens);
    assert.equal(cardioPack.queueSemantics, gp.queueSemantics);
    assert.equal(cardioPack.id, "gp");
    assert.equal(dermaPack.id, "gp");
    assert.equal(dermaPack.kind, "medical");
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

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  consultEntryRedirectView,
  primaryCtaTarget,
  ROLE_VISIBLE_VIEWS,
  roleMayStartConsult,
} from "./roleViews.ts";

describe("consult chrome gate", () => {
  it("lets prescribers keep Start Consult and hides it for desk roles", () => {
    assert.equal(roleMayStartConsult("doctor"), true);
    assert.equal(roleMayStartConsult("super_admin"), true);
    assert.equal(roleMayStartConsult(undefined), true);

    for (const role of ["receptionist", "polyclinic_admin", "CLINIC_ADMIN", "nurse", "pharmacist", "lab_technician", "patient"]) {
      assert.equal(roleMayStartConsult(role), false, role);
    }
  });

  it("keeps reception primary CTA on reception and doctor CTA on rx", () => {
    const reception = primaryCtaTarget({
      role: "receptionist",
      showMedicalRx: false,
      homeView: "reception",
      allowedViews: ROLE_VISIBLE_VIEWS.receptionist,
    });
    assert.deepEqual(reception, { visible: true, view: "reception" });

    const doctor = primaryCtaTarget({
      role: "doctor",
      showMedicalRx: true,
      homeView: "queue",
      allowedViews: ROLE_VISIBLE_VIEWS.doctor,
    });
    assert.deepEqual(doctor, { visible: true, view: "rx" });

    const clinicAdmin = primaryCtaTarget({
      role: "CLINIC_ADMIN",
      showMedicalRx: true,
      homeView: "queue",
      allowedViews: ROLE_VISIBLE_VIEWS.CLINIC_ADMIN,
    });
    assert.equal(clinicAdmin.visible, false);
    assert.equal(clinicAdmin.view, "rx");
  });

  it("redirects receptionist off rx and ambient onto reception home", () => {
    assert.equal(consultEntryRedirectView("receptionist", "rx", "reception"), "reception");
    assert.equal(consultEntryRedirectView("receptionist", "smart-rx", "reception"), "reception");
    assert.equal(consultEntryRedirectView("receptionist", "ambient", "reception"), "reception");
    assert.equal(consultEntryRedirectView("receptionist", "queue", "reception"), null);
    assert.equal(consultEntryRedirectView("receptionist", "reception", "reception"), null);
    assert.equal(consultEntryRedirectView("doctor", "rx", "queue"), null);
    assert.equal(consultEntryRedirectView("nurse", "rx", "queue"), "queue");
  });
});

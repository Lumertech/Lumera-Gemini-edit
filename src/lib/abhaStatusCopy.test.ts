import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ABHA_LINKING_STATUS, showsAbhaSandboxStatus } from "./clinicNav.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("ABHA linking status copy", () => {
  it("shows the sandbox line only to doctor, clinic admin, and super admin", () => {
    assert.equal(ABHA_LINKING_STATUS, "ABHA linking (ABDM sandbox testing; not yet live)");
    for (const role of ["doctor", "CLINIC_ADMIN", "polyclinic_admin", "super_admin"]) {
      assert.equal(showsAbhaSandboxStatus(role), true, role);
    }
    for (const role of ["patient", "receptionist", "", null]) {
      assert.equal(showsAbhaSandboxStatus(role), false, String(role));
    }
  });

  it("keeps that line on the consult scribe and off the footer, Rx, portal, and WhatsApp", () => {
    const scribe = fs.readFileSync(path.join(root, "src/components/CompactAmbientScribe.tsx"), "utf8");
    const app = fs.readFileSync(path.join(root, "src/ClinicianApp.tsx"), "utf8");
    const rx = fs.readFileSync(path.join(root, "src/components/PrescriptionWriter.tsx"), "utf8");
    const portal = fs.readFileSync(path.join(root, "src/components/PatientPortal.tsx"), "utf8");
    const whatsapp = fs.readFileSync(path.join(root, "server/whatsapp.ts"), "utf8");
    assert.match(scribe, /showsAbhaSandboxStatus\(user\?\.role\)/);
    assert.match(scribe, /data-testid="abha-linking-status"/);
    assert.equal(scribe.includes("Powered by ABDM"), false);
    assert.equal(scribe.includes("NHA Tech Provider"), false);
    assert.equal(scribe.includes("Gemini 3.5"), false);
    assert.equal(app.includes(ABHA_LINKING_STATUS), false);
    assert.equal(rx.includes(ABHA_LINKING_STATUS), false);
    assert.equal(portal.includes(ABHA_LINKING_STATUS), false);
    assert.equal(whatsapp.includes(ABHA_LINKING_STATUS), false);
  });
});

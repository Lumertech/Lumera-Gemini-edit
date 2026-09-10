import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_CLINIC_SETTINGS } from "../data/clinicalData";
import {
  BLANK_CLINIC_SETTINGS,
  SEED_CLINIC_GSTIN,
  SEED_CLINIC_UPI,
  clinicSettingsFromLetterhead,
  clinicSettingsToLetterhead,
  letterheadFromSessionHints,
  usesSeedLetterheadIdentifiers,
} from "./letterhead";
import { clinicSettingsFromSession, doctorFromUser } from "./sessionWorkspace";
import { AppUser, Doctor } from "../types";

function realUser(overrides: Partial<AppUser> = {}): AppUser {
  return {
    id: "user-clinic-a",
    tenantId: "tenant-clinic-a",
    email: "doc@clinic-a.example",
    name: "Dr Asha Rao",
    role: "doctor",
    status: "active",
    phone: "+91 90000 11111",
    lastLogin: null,
    createdAt: "2026-09-10T00:00:00.000Z",
    clinicName: "Asha Heart Clinic",
    onboardingCompleted: true,
    specialty: "Cardiology",
    practiceType: "individual",
    isDemoWorkspace: false,
    ...overrides,
  };
}

function demoUser(): AppUser {
  return realUser({
    id: "user-demo",
    tenantId: "tenant-lumera-main",
    email: "doctor@lumera.me",
    clinicName: "Lumera Healthcare & Polyclinic Institute",
    isDemoWorkspace: true,
  });
}

const sessionDoctor: Doctor = {
  id: "doc-asha",
  userId: "user-clinic-a",
  name: "Dr Asha Rao",
  qualification: "MD DM",
  regNumber: "KMC-998877",
  specialty: "Cardiology",
  experienceYears: 8,
  consultationFee: 800,
  opdRoom: "2",
  availableDays: ["Mon", "Tue"],
  opdTiming: "10:00 AM - 01:00 PM",
  phone: "+91 90000 11111",
  email: "doc@clinic-a.example",
  active: true,
  signatureUrl: "data:image/png;base64,sig",
};

describe("clinicSettingsFromSession letterhead isolation", () => {
  it("demo workspace keeps Lumera seed GSTIN, UPI, name, and address", () => {
    const settings = clinicSettingsFromSession(demoUser(), sessionDoctor);
    assert.equal(settings.gstin, SEED_CLINIC_GSTIN);
    assert.equal(settings.upiId, SEED_CLINIC_UPI);
    assert.equal(settings.name, DEFAULT_CLINIC_SETTINGS.name);
    assert.equal(settings.address, DEFAULT_CLINIC_SETTINGS.address);
    assert.equal(settings.regId, DEFAULT_CLINIC_SETTINGS.regId);
    assert.equal(usesSeedLetterheadIdentifiers(settings), true);
  });

  it("real tenants do not inherit seed GSTIN, UPI, name, address, or clinic reg", () => {
    const settings = clinicSettingsFromSession(realUser(), sessionDoctor);
    assert.equal(settings.gstin, "");
    assert.equal(settings.upiId, "");
    assert.equal(settings.regId, "");
    assert.equal(settings.address, "");
    assert.equal(settings.city, "");
    assert.notEqual(settings.name, DEFAULT_CLINIC_SETTINGS.name);
    assert.equal(settings.name, "Asha Heart Clinic");
    assert.equal(settings.gstin, "");
    assert.notEqual(settings.gstin, SEED_CLINIC_GSTIN);
    assert.notEqual(settings.upiId, SEED_CLINIC_UPI);
    assert.equal(usesSeedLetterheadIdentifiers(settings), false);
    assert.equal(settings.signatureUrl, "data:image/png;base64,sig");
  });

  it("hydrated GET letterhead maps clinicName to ClinicSettings.name without seed GSTIN/UPI", () => {
    const settings = clinicSettingsFromSession(realUser(), sessionDoctor, {
      clinicName: "Rao Cardiology",
      address: "12 MG Road",
      gstin: "29AABCR1234K1Z1",
      upiId: "rao.clinic@okaxis",
      sealText: "Clinic seal",
      signatureUrl: "data:image/png;base64,from-api",
    });
    assert.equal(settings.name, "Rao Cardiology");
    assert.equal(settings.address, "12 MG Road");
    assert.equal(settings.gstin, "29AABCR1234K1Z1");
    assert.equal(settings.upiId, "rao.clinic@okaxis");
    assert.equal(settings.signatureUrl, "data:image/png;base64,from-api");
    assert.notEqual(settings.gstin, SEED_CLINIC_GSTIN);
    assert.notEqual(settings.upiId, SEED_CLINIC_UPI);
  });

  it("real tenant without clinic name stays blank rather than Lumera seed name", () => {
    const settings = clinicSettingsFromSession(realUser({ clinicName: "" }), doctorFromUser(realUser()));
    assert.equal(settings.name, "");
    assert.equal(settings.gstin, "");
    assert.equal(settings.upiId, "");
  });
});

describe("letterhead ↔ ClinicSettings mapping", () => {
  it("maps clinicName to name and copies GSTIN/UPI/seal/signature", () => {
    const settings = clinicSettingsFromLetterhead(
      {
        clinicName: "Rao Cardiology",
        address: "12 MG Road",
        city: "Bengaluru",
        phone: "+91 80 1234 5678",
        email: "hello@rao.clinic",
        gstin: "29AABCR1234K1Z1",
        upiId: "rao.clinic@okaxis",
        sealText: "Clinic seal",
        signatureUrl: "data:image/png;base64,abc",
        tagline: "Heart first",
        footerDisclaimer: "For this patient only",
      },
      BLANK_CLINIC_SETTINGS
    );
    assert.equal(settings.name, "Rao Cardiology");
    assert.equal(settings.address, "12 MG Road");
    assert.equal(settings.city, "Bengaluru");
    assert.equal(settings.gstin, "29AABCR1234K1Z1");
    assert.equal(settings.upiId, "rao.clinic@okaxis");
    assert.equal(settings.sealText, "Clinic seal");
    assert.equal(settings.signatureUrl, "data:image/png;base64,abc");
    assert.equal(settings.tagline, "Heart first");
    assert.equal(settings.footerDisclaimer, "For this patient only");
  });

  it("partial PATCH does not refill empty GSTIN/UPI from seed defaults", () => {
    const base = clinicSettingsFromSession(realUser(), sessionDoctor);
    const patched = clinicSettingsFromLetterhead({ gstin: "27AAACL1111A1Z5", upiId: "asha@upi" }, base);
    assert.equal(patched.name, "Asha Heart Clinic");
    assert.equal(patched.gstin, "27AAACL1111A1Z5");
    assert.equal(patched.upiId, "asha@upi");
    assert.equal(patched.address, "");
    assert.notEqual(patched.gstin, SEED_CLINIC_GSTIN);
  });

  it("round-trips ClinicSettings through the locked letterhead shape", () => {
    const original = clinicSettingsFromLetterhead(
      {
        clinicName: "Nair ENT",
        address: "Kochi",
        gstin: "32AAACN0000N1Z8",
        upiId: "nair@upi",
        sealText: "ENT seal",
        signatureUrl: "sig",
      },
      BLANK_CLINIC_SETTINGS
    );
    const letterhead = clinicSettingsToLetterhead(original);
    assert.equal(letterhead.clinicName, original.name);
    assert.equal(letterhead.gstin, original.gstin);
    assert.equal(letterhead.upiId, original.upiId);
    const again = clinicSettingsFromLetterhead(letterhead, BLANK_CLINIC_SETTINGS);
    assert.equal(again.name, original.name);
    assert.equal(again.gstin, original.gstin);
  });

  it("onboarding hints persist clinic name and signature without seed GSTIN/UPI", () => {
    const hints = letterheadFromSessionHints("Nair ENT", sessionDoctor);
    const settings = clinicSettingsFromLetterhead(hints, BLANK_CLINIC_SETTINGS);
    assert.equal(settings.name, "Nair ENT");
    assert.equal(settings.signatureUrl, sessionDoctor.signatureUrl);
    assert.equal(settings.gstin, "");
    assert.equal(settings.upiId, "");
  });
});

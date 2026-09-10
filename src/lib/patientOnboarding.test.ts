import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Patient } from "../types";
import {
  BACK_TO_PRACTICE_SIMPLE,
  LINK_ABHA_CTA,
  LINKED_SANDBOX_CHIP,
  NHA_SANDBOX_BADGE,
  SIMULATOR_BADGE,
  abhaStatusChip,
  ageFromDob,
  consentFromVerify,
  findMatchingPatient,
  genderFromAbdm,
  interpretAbdmStatus,
  linkAbhaBodyFromVerify,
  normalizePhoneDigits,
  OTP_ACCEPTED_NOTICE,
} from "./patientOnboarding";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function patient(partial: Partial<Patient> & Pick<Patient, "id" | "name" | "phone">): Patient {
  return {
    uhid: "LUM-2026-0001",
    age: 40,
    gender: "Female",
    bloodGroup: "B+",
    allergies: [],
    chronicConditions: [],
    emergencyContact: partial.phone,
    ...partial,
  };
}

describe("dual onboarding helpers (#40)", () => {
  it("matches tenant patients by last-10 phone or ABHA digits", () => {
    const existing = patient({
      id: "pat-1",
      name: "Anita Rao",
      phone: "+91 98111 22334",
      abhaNumber: "91-1234-5678-9012",
    });
    assert.equal(normalizePhoneDigits("+91-98111-22334"), "9811122334");
    assert.equal(findMatchingPatient([existing], { phone: "9811122334" })?.id, "pat-1");
    assert.equal(findMatchingPatient([existing], { abhaNumber: "91123456789012" })?.id, "pat-1");
    assert.equal(findMatchingPatient([existing], { phone: "9000000000" }), null);
  });

  it("fail-closes ABDM status unless bridgeReady and abdmMode are both ready", () => {
    assert.equal(interpretAbdmStatus(null).bridgeReady, false);
    assert.equal(interpretAbdmStatus({}).bridgeReady, false);
    assert.equal(interpretAbdmStatus({ bridgeReady: true }).bridgeReady, false);
    assert.equal(interpretAbdmStatus({ bridgeReady: false, abdmMode: "sandbox" }).bridgeReady, false);
    assert.equal(interpretAbdmStatus({ abdmMode: "stub" }).bridgeReady, false);
    assert.equal(interpretAbdmStatus({ bridgeReady: true, abdmMode: "live" }).bridgeReady, false);
    const ready = interpretAbdmStatus({ bridgeReady: true, abdmMode: "stub" });
    assert.equal(ready.bridgeReady, true);
    assert.equal(ready.abdmMode, "stub");
    assert.equal(interpretAbdmStatus({ bridgeReady: true, abdmMode: "sandbox" }).bridgeReady, true);
  });

  it("never labels ABHA as Verified — LINKED_SANDBOX only", () => {
    const none = abhaStatusChip({ kycStatus: "PENDING" });
    assert.equal(none.linked, false);
    assert.equal(none.label, "No ABHA");
    const linked = abhaStatusChip({ kycStatus: "LINKED_SANDBOX", abhaNumber: "91-1", abhaLinkedAt: "2026-09-10" });
    assert.equal(linked.label, LINKED_SANDBOX_CHIP);
    const seed = abhaStatusChip({ kycStatus: "VERIFIED", abhaNumber: "91-1" });
    assert.equal(seed.label, LINKED_SANDBOX_CHIP);
    assert.equal(seed.label.includes("Verified"), false);
  });

  it("builds link-abha body from verifyOTP demographics + sandbox consent", () => {
    const verified = {
      success: true,
      abhaNumber: "91-4428-9102-3841",
      abhaAddress: "anita.rao@abdm",
      profile: {
        name: "Anita Rao",
        gender: "F",
        dob: "1985-02-01",
        mobile: "+91 98111 22334",
        address: "Pune",
      },
      consent: {
        granted: true,
        capturedAt: "2026-09-10T00:00:00.000Z",
        sandbox: true as const,
        source: "nha-sandbox" as const,
        txnId: "txn-1",
      },
    };
    const body = linkAbhaBodyFromVerify(verified, { patientId: "pat-1", txnId: "txn-1" });
    assert.equal(body.patientId, "pat-1");
    assert.equal(body.abhaNumber, "91-4428-9102-3841");
    assert.equal(body.abhaAddress, "anita.rao@abdm");
    assert.equal(body.demographics?.name, "Anita Rao");
    assert.equal(body.demographics?.gender, "Female");
    assert.equal(body.source, "aadhaar_otp");
    assert.equal(body.abdmMode, "sandbox");
    assert.equal(body.consentArtefact?.consentId, "consent-txn-1");
    assert.equal(body.consentArtefact?.status, "GRANTED");
    assert.deepEqual(Object.keys(body).sort(), [
      "abdmMode",
      "abhaAddress",
      "abhaNumber",
      "consentArtefact",
      "demographics",
      "patientId",
      "phone",
      "source",
    ]);
    assert.equal((body as { consent?: unknown }).consent, undefined);
  });

  it("synthesizes NHA sandbox consent when verify payload has no artefact", () => {
    const consent = consentFromVerify("txn-9", { abhaNumber: "91-1" });
    assert.equal(consent.consentId, "consent-txn-9");
    assert.equal(consent.status, "GRANTED");
    assert.equal(consent.purpose, "ABHA link");
    assert.ok(consent.grantedAt);
    assert.equal(genderFromAbdm("M"), "Male");
    assert.ok((ageFromDob("1990-01-01") || 0) >= 30);
  });

  it("Reception chrome: practice-simple default + Link ABHA CTA; grep gate", () => {
    const files = [
      "src/components/Reception.tsx",
      "src/components/WelcomeSetupDashboard.tsx",
      "src/lib/patientOnboarding.ts",
      "src/ClinicianApp.tsx",
    ];
    const root = path.join(__dirname, "../..");
    const banned = /certified|M1[–-]M3 complete|ABDM Fast-Track|KYC-Verified|Government Verified/i;
    for (const rel of files) {
      const src = fs.readFileSync(path.join(root, rel), "utf8");
      const leftover = src
        .split(/\n/)
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => banned.test(line));
      assert.deepEqual(leftover, [], `${rel} failed #40 grep:\n${leftover.map((r) => `  L${r.n}: ${r.line.trim()}`).join("\n")}`);
    }
    const reception = fs.readFileSync(path.join(root, "src/components/Reception.tsx"), "utf8");
    assert.equal(LINK_ABHA_CTA, "Link ABHA (NHA sandbox)");
    assert.equal(NHA_SANDBOX_BADGE, "NHA sandbox");
    assert.equal(SIMULATOR_BADGE, "Simulator");
    assert.equal(BACK_TO_PRACTICE_SIMPLE, "Back to practice-simple");
    assert.match(reception, /useState<OnboardingPath>\('practice-simple'\)/);
    assert.match(reception, /LINK_ABHA_CTA/);
    assert.match(reception, /NHA_SANDBOX_BADGE/);
    assert.match(reception, /SIMULATOR_BADGE/);
    assert.match(reception, /BACK_TO_PRACTICE_SIMPLE/);
    assert.match(reception, /practice-simple/);
    assert.match(reception, /generateAbhaSandboxOtp/);
    assert.match(reception, /verifyAbhaSandboxOtp/);
    assert.match(reception, /link-abha|onLinkAbha/);
    assert.match(reception, new RegExp(LINKED_SANDBOX_CHIP));
    assert.match(reception, /OTP_ACCEPTED_NOTICE/);
    assert.equal(OTP_ACCEPTED_NOTICE.includes("LINKED_SANDBOX"), true);
    assert.equal(/pending save/.test(reception), false);
    assert.equal(/\bVerified\b/.test(reception), false);
    assert.equal(/Scan ABHA QR|handleSampleQrScan/.test(reception), false);
    assert.equal(/bg-slate-100 p-1 rounded-lg/.test(reception), false);
    assert.equal(/consentArtefact|abhaConsent/.test(reception), false);
    const welcome = fs.readFileSync(path.join(root, "src/components/WelcomeSetupDashboard.tsx"), "utf8");
    assert.match(welcome, /Practice-simple is the default/);
    assert.equal(/LINK_ABHA_CTA/.test(welcome), false);
    const clinician = fs.readFileSync(path.join(root, "src/ClinicianApp.tsx"), "utf8");
    assert.match(clinician, /\/api\/patients\/link-abha/);
    assert.match(clinician, /setCurrentPatient\(patient\)/);
    assert.match(clinician, /setCurrentPatient\(result\.patient\)/);
    const createFn = clinician.slice(clinician.indexOf("persistPatientCreate"), clinician.indexOf("persistLinkAbha"));
    assert.equal(/abhaNumber|consentArtefact|abhaConsent/.test(createFn), false);
    const onboarding = fs.readFileSync(path.join(root, "src/lib/patientOnboarding.ts"), "utf8");
    assert.match(onboarding, /consentArtefact/);
    assert.match(onboarding, /abdmMode/);
    assert.match(onboarding, /sandboxNotice/);
    assert.equal(/\/api\/abdm\/(hiu|hip|hrp)/.test(`${onboarding}\n${clinician}\n${reception}`), false);
    const clinical = fs.readFileSync(path.join(root, "server/clinical.ts"), "utf8");
    assert.match(clinical, /consentArtefact\.consentId is required/);
    assert.equal(fs.existsSync(path.join(root, "server/patient-sot.test.ts")), false);
  });
});

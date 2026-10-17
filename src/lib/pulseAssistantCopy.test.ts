import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PULSE_ASSISTANT_DISCLAIMER,
  PULSE_ASSISTANT_HEADER,
  PULSE_GENERIC_ERROR_COPY,
  PULSE_PRESCRIBER_ONLY_COPY,
  PULSE_RATE_LIMIT_COPY,
  canOpenClinicalAssistant,
  pulseAssistantErrorCopy,
} from "./pulseAssistantCopy.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("Pulse assistant errors and menu", () => {
  it("uses a fixed error bubble and hides the menu from reception", () => {
    assert.equal(pulseAssistantErrorCopy(403), PULSE_PRESCRIBER_ONLY_COPY);
    assert.equal(pulseAssistantErrorCopy(429), PULSE_RATE_LIMIT_COPY);
    assert.equal(pulseAssistantErrorCopy(500), PULSE_GENERIC_ERROR_COPY);
    assert.equal(canOpenClinicalAssistant("doctor"), true);
    assert.equal(canOpenClinicalAssistant("polyclinic_admin"), true);
    assert.equal(canOpenClinicalAssistant("CLINIC_ADMIN"), true);
    assert.equal(canOpenClinicalAssistant("super_admin"), true);
    assert.equal(canOpenClinicalAssistant("admin"), true);
    assert.equal(canOpenClinicalAssistant("receptionist"), false);
    assert.equal(canOpenClinicalAssistant("patient"), false);
    assert.equal(canOpenClinicalAssistant(""), false);

    const assistant = fs.readFileSync(path.join(root, "src/components/GeminiAssistant.tsx"), "utf8");
    assert.match(assistant, /pulseAssistantErrorCopy/);
    assert.match(assistant, /PULSE_ASSISTANT_HEADER/);
    assert.match(assistant, /PULSE_ASSISTANT_DISCLAIMER/);
    assert.doesNotMatch(assistant, /Clinical response generated/);
    assert.doesNotMatch(assistant, /advanced enterprise/i);
    assert.doesNotMatch(assistant, /real-time/i);
    assert.doesNotMatch(assistant, /evidence-based/i);
    const handler = assistant.slice(assistant.indexOf("const handleSend"), assistant.indexOf("const handleCopy"));
    const errorAt = handler.indexOf("if (!response.ok)");
    const sourceAt = handler.indexOf("source: answer");
    assert.ok(errorAt >= 0 && sourceAt > errorAt);

    const navbar = fs.readFileSync(path.join(root, "src/components/Navbar.tsx"), "utf8");
    assert.match(navbar, /canOpenClinicalAssistant\(userRole\)/);
    assert.equal(PULSE_ASSISTANT_HEADER, "Clinical reference assistant");
    assert.match(PULSE_ASSISTANT_DISCLAIMER, /can be wrong/);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appViewToWorkspacePath,
  canonicalizeTenantScreenPath,
  parseWorkspaceScreen,
  safeWorkspaceReturnPath,
  workspaceScreenPath,
} from "./tenantRoutes.ts";

describe("tenant screen routes", () => {
  it("maps the clinic screens and keeps record ids", () => {
    assert.equal(parseWorkspaceScreen("opd").appView, "queue");
    assert.equal(parseWorkspaceScreen("opd").screen, "opd");
    assert.equal(parseWorkspaceScreen("queue").screen, "opd");
    assert.equal(parseWorkspaceScreen("invoices").appView, "billing");
    assert.equal(parseWorkspaceScreen("payments").payFocus, true);
    assert.equal(parseWorkspaceScreen("ai-voice").appView, "voicebot");
    assert.equal(parseWorkspaceScreen("consultations").appView, "rx");
    assert.equal(parseWorkspaceScreen("reception").screen, "reception");
    assert.equal(parseWorkspaceScreen("patients", "Pat-Keep").recordId, "Pat-Keep");
    assert.equal(parseWorkspaceScreen("rx", "Visit-9").screen, "rx");
    assert.equal(parseWorkspaceScreen("rx", "Visit-9").recordId, "Visit-9");
    assert.equal(parseWorkspaceScreen("rx").screen, "consultations");
    assert.equal(parseWorkspaceScreen("gp-home").screen, "dashboard");
    assert.equal(parseWorkspaceScreen("gp-home").appView, "gp-home");
    assert.equal(parseWorkspaceScreen("nope").recognized, false);
    assert.equal(
      workspaceScreenPath("physiodoctor-practice", "reception"),
      "/w/physiodoctor-practice/reception"
    );
    assert.equal(
      appViewToWorkspacePath("queue", "physiodoctor-practice"),
      "/w/physiodoctor-practice/opd"
    );
    assert.equal(
      appViewToWorkspacePath("rx", "physiodoctor-practice", "visit-1"),
      "/w/physiodoctor-practice/rx/visit-1"
    );
  });

  it("canonicalizes legacy segments and leaves unknown screens on the same URL", () => {
    assert.equal(
      canonicalizeTenantScreenPath("/w/physiodoctor-practice/queue"),
      "/w/physiodoctor-practice/opd"
    );
    assert.equal(
      canonicalizeTenantScreenPath("/w/physiodoctor-practice/billing"),
      "/w/physiodoctor-practice/invoices"
    );
    assert.equal(
      canonicalizeTenantScreenPath("/w/physiodoctor-practice/voicebot"),
      "/w/physiodoctor-practice/ai-voice"
    );
    assert.equal(canonicalizeTenantScreenPath("/w/physiodoctor-practice/rx"), "/w/physiodoctor-practice/consultations");
    assert.equal(canonicalizeTenantScreenPath("/w/physiodoctor-practice/rx/visit-1"), null);
    assert.equal(canonicalizeTenantScreenPath("/w/physiodoctor-practice/patients/pat-42"), null);
    assert.equal(canonicalizeTenantScreenPath("/w/physiodoctor-practice/reception"), null);
    assert.equal(canonicalizeTenantScreenPath("/w/physiodoctor-practice/whatsapp"), null);
    assert.equal(canonicalizeTenantScreenPath("/w/physiodoctor-practice/not-a-screen"), null);
    assert.equal(
      canonicalizeTenantScreenPath("/w/physiodoctor-practice"),
      "/w/physiodoctor-practice/dashboard"
    );
  });

  it("accepts only same-origin /w and /app return paths", () => {
    assert.equal(
      safeWorkspaceReturnPath("/w/physiodoctor-practice/patients/Pat-Keep"),
      "/w/physiodoctor-practice/patients/Pat-Keep"
    );
    assert.equal(safeWorkspaceReturnPath("/w/physiodoctor-practice/rx/Visit-9"), "/w/physiodoctor-practice/rx/Visit-9");
    assert.equal(safeWorkspaceReturnPath("https://evil.example/w/physiodoctor-practice/opd"), "");
    assert.equal(safeWorkspaceReturnPath("//evil.example/w/physiodoctor-practice"), "");
    assert.equal(safeWorkspaceReturnPath("/\\evil"), "");
    assert.equal(safeWorkspaceReturnPath("/w/../admin"), "");
    assert.equal(safeWorkspaceReturnPath("/admin/users"), "");
    assert.equal(safeWorkspaceReturnPath("/app/patients/Pat-Keep"), "/app/patients/Pat-Keep");
  });
});

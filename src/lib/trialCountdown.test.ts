import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { trialCountdownLabel } from "./trialCountdown.ts";

const navbar = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../components/Navbar.tsx"), "utf8");

describe("trial countdown", () => {
  const now = Date.parse("2026-11-13T06:00:00.000Z");

  it("shows whole days and the leftover hours", () => {
    const label = trialCountdownLabel({
      status: "active",
      trialEndsAt: "2026-11-16T10:30:00.000Z",
      now,
    });
    assert.equal(label, "3d 4h left");
  });

  it("shows hours only on the last day", () => {
    const label = trialCountdownLabel({
      status: "active",
      trialEndsAt: "2026-11-13T11:00:00.000Z",
      now,
    });
    assert.equal(label, "0d 5h left");
  });

  it("names the day-31 and pending states", () => {
    assert.equal(trialCountdownLabel({ status: "read_only", trialEndsAt: "2026-11-13T00:00:00.000Z", now }), "Trial ended");
    assert.equal(
      trialCountdownLabel({ status: "pending_whatsapp", trialEndsAt: null, now }),
      "Verify WhatsApp to start the 30-day trial",
    );
    assert.equal(trialCountdownLabel({ status: "none", trialEndsAt: null, now }), null);
  });

  it("is mounted in the app header", () => {
    assert.match(navbar, /<TrialHeaderCountdown/);
    assert.match(navbar, /data-testid="app-topbar"/);
  });
});

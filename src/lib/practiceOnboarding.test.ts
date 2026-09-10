import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_FRONT_DESK,
  DEFAULT_PRACTICE_TYPE,
  normalizeUiPracticeType,
  onboardingTrackFromUser,
  postOnboardingHomeView,
  shouldShowPolyclinicChrome,
} from "./practiceOnboarding.ts";

describe("practice onboarding defaults", () => {
  it("founder lock: default practice type is individual, never multi-specialty", () => {
    assert.equal(DEFAULT_PRACTICE_TYPE, "individual");
    assert.equal(normalizeUiPracticeType(undefined), "individual");
    assert.equal(normalizeUiPracticeType(""), "individual");
    assert.equal(normalizeUiPracticeType("individual"), "individual");
  });

  it("treats every multi-specialty alias as an explicit polyclinic opt-in", () => {
    assert.equal(normalizeUiPracticeType("polyclinic"), "polyclinic");
    assert.equal(normalizeUiPracticeType("multispecialty"), "polyclinic");
    assert.equal(normalizeUiPracticeType("multi-specialty"), "polyclinic");
    assert.equal(normalizeUiPracticeType("multi_specialty"), "polyclinic");
  });

  it("new users without a stored type enter the individual track", () => {
    assert.equal(onboardingTrackFromUser(undefined), "individual");
    assert.equal(onboardingTrackFromUser("individual"), "individual");
    assert.equal(onboardingTrackFromUser("polyclinic"), "polyclinic");
  });

  it("individual home is the daily OPD/queue dashboard; polyclinic opens admin welcome", () => {
    assert.equal(postOnboardingHomeView("individual"), "queue");
    assert.equal(postOnboardingHomeView("polyclinic"), "welcome");
  });

  it("hides polyclinic roster/admin chrome unless the type is explicitly polyclinic", () => {
    assert.equal(shouldShowPolyclinicChrome(undefined), false);
    assert.equal(shouldShowPolyclinicChrome("individual"), false);
    assert.equal(shouldShowPolyclinicChrome("polyclinic"), true);
  });

  it("shared front-desk defaults enable walk-ins on a shared queue", () => {
    assert.equal(DEFAULT_FRONT_DESK.walkInEnabled, true);
    assert.equal(DEFAULT_FRONT_DESK.sharedQueue, true);
    assert.equal(DEFAULT_FRONT_DESK.tokenPrefix, "OPD");
  });
});

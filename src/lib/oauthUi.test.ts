import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { showGoogleOAuthButton } from "./oauthUi.ts";

describe("showGoogleOAuthButton (complements PR #64)", () => {
  it("hides Google while oauth-config is loading", () => {
    assert.equal(showGoogleOAuthButton(null), false);
    assert.equal(showGoogleOAuthButton(undefined), false);
  });

  it("hides Google in production when neither Identity nor sandbox is available", () => {
    assert.equal(showGoogleOAuthButton({ sandboxClientOAuthAllowed: false }), false);
    assert.equal(
      showGoogleOAuthButton({ googleConfigured: false, sandboxClientOAuthAllowed: false }),
      false
    );
  });

  it("shows Google when sandbox client-email OAuth is allowed", () => {
    assert.equal(showGoogleOAuthButton({ sandboxClientOAuthAllowed: true }), true);
    assert.equal(
      showGoogleOAuthButton({ googleConfigured: false, sandboxClientOAuthAllowed: true }),
      true
    );
  });

  it("shows Google when googleConfigured even if sandbox client OAuth is disabled", () => {
    assert.equal(
      showGoogleOAuthButton({ googleConfigured: true, sandboxClientOAuthAllowed: false }),
      true
    );
  });
});

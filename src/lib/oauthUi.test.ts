import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publicOauthErrorMessage, showFacebookOAuthButton, showGoogleOAuthButton } from "./oauthUi.ts";

describe("showGoogleOAuthButton", () => {
  it("always shows Google on the public login row", () => {
    assert.equal(showGoogleOAuthButton(null), true);
    assert.equal(showGoogleOAuthButton(undefined), true);
    assert.equal(showGoogleOAuthButton({ sandboxClientOAuthAllowed: false }), true);
    assert.equal(
      showGoogleOAuthButton({ googleConfigured: false, sandboxClientOAuthAllowed: false }),
      true
    );
    assert.equal(
      showGoogleOAuthButton({ googleConfigured: true, sandboxClientOAuthAllowed: false }),
      true
    );
  });
});

describe("showFacebookOAuthButton", () => {
  it("always shows Facebook beside Google on the public login row", () => {
    assert.equal(showFacebookOAuthButton(null), true);
    assert.equal(showFacebookOAuthButton(undefined), true);
    assert.equal(showFacebookOAuthButton({ sandboxClientOAuthAllowed: false }), true);
    assert.equal(
      showFacebookOAuthButton({ facebookConfigured: false, sandboxClientOAuthAllowed: false }),
      true
    );
    assert.equal(
      showFacebookOAuthButton({ facebookConfigured: true, sandboxClientOAuthAllowed: false }),
      true
    );
  });
});

describe("publicOauthErrorMessage", () => {
  it("maps Facebook cancel and missing configuration to login copy", () => {
    assert.match(publicOauthErrorMessage("facebook", "access_denied"), /cancelled/i);
    assert.match(publicOauthErrorMessage("facebook", "user_denied"), /cancelled/i);
    assert.match(publicOauthErrorMessage("facebook", "not_configured"), /FACEBOOK_APP_ID \/ FACEBOOK_APP_SECRET/);
    assert.match(publicOauthErrorMessage("google", "not_configured"), /GOOGLE_CLIENT_ID \/ GOOGLE_CLIENT_SECRET/);
    assert.match(publicOauthErrorMessage("facebook", "missing_code"), /authorization code/i);
    assert.match(publicOauthErrorMessage("google", "invalid_state"), /could not be verified/i);
  });
});

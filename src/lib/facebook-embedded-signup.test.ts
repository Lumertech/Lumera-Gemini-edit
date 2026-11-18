import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMBEDDED_SIGNUP_SCOPES,
  buildEmbeddedSignupLoginOptions,
  isFacebookEmbeddedSignupOrigin,
} from "./facebook-embedded-signup.ts";

describe("Embedded Signup postMessage origin and FB.login v4 options", () => {
  it("accepts www.facebook.com and facebook.com subdomains over https", () => {
    assert.equal(isFacebookEmbeddedSignupOrigin("https://www.facebook.com"), true);
    assert.equal(isFacebookEmbeddedSignupOrigin("https://business.facebook.com"), true);
    assert.equal(isFacebookEmbeddedSignupOrigin("https://web.facebook.com"), true);
    assert.equal(isFacebookEmbeddedSignupOrigin("https://www.facebook.com:443"), true);
  });

  it("rejects suffix attacks, apex, and non-https origins", () => {
    assert.equal(isFacebookEmbeddedSignupOrigin("https://evilfacebook.com"), false);
    assert.equal(isFacebookEmbeddedSignupOrigin("https://notfacebook.com"), false);
    assert.equal(isFacebookEmbeddedSignupOrigin("https://facebook.com"), false);
    assert.equal(isFacebookEmbeddedSignupOrigin("https://www.facebook.com.evil.com"), false);
    assert.equal(isFacebookEmbeddedSignupOrigin("https://evil.com"), false);
    assert.equal(isFacebookEmbeddedSignupOrigin("http://www.facebook.com"), false);
    assert.equal(isFacebookEmbeddedSignupOrigin("https://user:pass@www.facebook.com"), false);
    assert.equal(isFacebookEmbeddedSignupOrigin("https://www.facebook.com:8443"), false);
    assert.equal(isFacebookEmbeddedSignupOrigin("not a url"), false);
  });

  it("omits raw scope from FB.login options when config_id is used so Meta does not reject Invalid Scopes", () => {
    const opts = buildEmbeddedSignupLoginOptions("29710745195179606");
    assert.equal("scope" in opts, false, "FB.login with config_id must NOT pass scope");
    assert.equal(opts.config_id, "29710745195179606");
    assert.equal(opts.response_type, "code");
    assert.equal(opts.override_default_response_type, true);
    assert.deepEqual(opts.extras, { setup: {}, sessionInfoVersion: "3" });
    assert.equal(EMBEDDED_SIGNUP_SCOPES.includes("business_management" as never), false);
    assert.deepEqual([...EMBEDDED_SIGNUP_SCOPES], ["whatsapp_business_management", "whatsapp_business_messaging"]);
  });
});

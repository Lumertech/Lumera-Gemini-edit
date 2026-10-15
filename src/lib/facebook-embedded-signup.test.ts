import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFacebookEmbeddedSignupOrigin } from "./facebook-embedded-signup.ts";

describe("Embedded Signup postMessage origin", () => {
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
});

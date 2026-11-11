import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AppPublicUrlError, appPublicUrl } from "./runtime.ts";

const previousEnv = process.env.NODE_ENV;
const previousUrl = process.env.APP_URL;

afterEach(() => {
  if (previousEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousEnv;
  if (previousUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousUrl;
});

describe("appPublicUrl", () => {
  it("uses the Host header only outside production", () => {
    process.env.NODE_ENV = "test";
    delete process.env.APP_URL;
    assert.equal(appPublicUrl("127.0.0.1:9", "http"), "http://127.0.0.1:9");
  });

  it("fails closed in production when APP_URL is unset and ignores the Host header", () => {
    process.env.NODE_ENV = "production";
    delete process.env.APP_URL;
    assert.throws(() => appPublicUrl("evil.example", "https"), AppPublicUrlError);
  });

  it("uses APP_URL in production and does not append the Host header", () => {
    process.env.NODE_ENV = "production";
    process.env.APP_URL = "https://clinic.example";
    assert.equal(appPublicUrl("evil.example", "https"), "https://clinic.example");
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("auth token web storage", () => {
  it("does not write the session token to localStorage or sessionStorage", () => {
    const http = fs.readFileSync(path.join(root, "src/api/http.ts"), "utf8");
    const auth = fs.readFileSync(path.join(root, "src/auth/AuthContext.tsx"), "utf8");
    assert.doesNotMatch(http, /localStorage\.setItem/);
    assert.doesNotMatch(http, /sessionStorage\.setItem/);
    assert.doesNotMatch(auth, /localStorage\.setItem/);
    assert.doesNotMatch(auth, /sessionStorage\.setItem/);
    assert.match(http, /localStorage\.removeItem/);
    assert.match(http, /sessionStorage\.removeItem/);
    assert.match(http, /lumera_session_token/);
    assert.match(auth, /\/api\/me/);
    assert.doesNotMatch(auth, /setStoredToken/);
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("live registration override mount", () => {
  it("is mounted before createApiRouter (stack rewrite is not the production fix)", () => {
    const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.ts"), "utf8");
    const routesSrc = fs.readFileSync(path.join(__dirname, "live-registration-routes.ts"), "utf8");
    const liveSrc = fs.readFileSync(path.join(__dirname, "live-registration-password.ts"), "utf8");
    const passwordSrc = fs.readFileSync(path.join(__dirname, "password.ts"), "utf8");
    const liveMount = serverSrc.indexOf("createLiveRegistrationRouter()");
    const apiMount = serverSrc.indexOf("createApiRouter()");
    assert.ok(liveMount >= 0, "server.ts must mount createLiveRegistrationRouter()");
    assert.ok(apiMount >= 0, "server.ts must still mount createApiRouter()");
    assert.ok(liveMount < apiMount, "live registration must mount before createApiRouter()");
    assert.match(routesSrc, /liveRegistrationPasswordHash\(/);
    assert.equal(routesSrc.includes("Lumera@2026"), false);
    assert.match(liveSrc, /function liveRegistrationPasswordHash/);
    assert.match(passwordSrc, /must not be the only fix/);
  });
});

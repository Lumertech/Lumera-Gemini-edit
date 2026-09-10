import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideChrome,
  isExplicitPublicPath,
  isProtectedSurface,
  isSmartHomePath,
  nextAuthenticatedSurface,
  loginModeFromPath,
  pathToNav,
  surfaceToPath,
} from "./surfaces.ts";

describe("public vs app surface routing (founder lock #48)", () => {
  it("maps anonymous `/` to the public landing surface, not the clinic app", () => {
    assert.equal(pathToNav("/").surface, "landing");
    assert.equal(pathToNav("").surface, "landing");
    assert.equal(pathToNav("/index.html").surface, "landing");
    assert.equal(isSmartHomePath("/"), true);
    assert.equal(isProtectedSurface("landing"), false);
  });

  it("keeps Meta / compliance policy URLs on the public legal surface", () => {
    assert.deepEqual(pathToNav("/privacy-policy"), {
      surface: "legal",
      policySlug: "privacy-policy",
      adminTab: "overview",
    });
    assert.equal(pathToNav("/terms-of-service").policySlug, "terms-of-service");
    assert.equal(pathToNav("/data-deletion-instructions").policySlug, "data-deletion-instructions");
    assert.equal(pathToNav("/privacy").surface, "legal");
    assert.equal(pathToNav("/terms").surface, "legal");
  });

  it("treats `/app`, `/dashboard`, and `/admin` as protected clinic surfaces", () => {
    assert.equal(pathToNav("/app").surface, "app");
    assert.equal(pathToNav("/dashboard").surface, "app");
    assert.equal(pathToNav("/admin").surface, "admin");
    assert.equal(isProtectedSurface("app"), true);
    assert.equal(isProtectedSurface("admin"), true);
    assert.equal(isProtectedSurface("portal"), true);
    assert.equal(isProtectedSurface("onboarding"), true);
  });

  it("keeps explicit marketing paths public even for a signed-in clinician", () => {
    assert.equal(pathToNav("/landing").surface, "landing");
    assert.equal(isExplicitPublicPath("/landing"), true);
    assert.equal(isExplicitPublicPath("/"), false);
    assert.equal(surfaceToPath("landing", { explicitPublic: true }), "/landing");
    assert.equal(surfaceToPath("landing"), "/");
    assert.equal(surfaceToPath("app"), "/app");
    assert.equal(surfaceToPath("login"), "/login");
    assert.equal(surfaceToPath("login", { loginMode: "register" }), "/signup");
    assert.equal(pathToNav("/signup").surface, "login");
    assert.equal(pathToNav("/register").surface, "login");
    assert.equal(loginModeFromPath("/signup"), "register");
    assert.equal(loginModeFromPath("/register"), "register");
    assert.equal(loginModeFromPath("/login"), "signin");
    assert.equal(surfaceToPath("legal", { policySlug: "privacy-policy" }), "/privacy-policy");
  });

  it("never shows app chrome for anonymous visitors, including protected deep links", () => {
    const root = decideChrome({ loading: false, authenticated: false, surface: "landing", pathname: "/" });
    assert.equal(root.showAppChrome, false);
    assert.equal(root.renderSurface, "landing");
    assert.equal(root.boot, false);

    const appDeep = decideChrome({ loading: false, authenticated: false, surface: "app", pathname: "/app" });
    assert.equal(appDeep.showAppChrome, false);
    assert.equal(appDeep.renderSurface, "login");

    const adminDeep = decideChrome({ loading: false, authenticated: false, surface: "admin", pathname: "/admin" });
    assert.equal(adminDeep.showAppChrome, false);
    assert.equal(adminDeep.renderSurface, "login");
  });

  it("does not flash clinician chrome while the session is still loading", () => {
    const home = decideChrome({ loading: true, authenticated: false, surface: "landing", pathname: "/" });
    assert.equal(home.boot, true);
    assert.equal(home.showAppChrome, false);

    const app = decideChrome({ loading: true, authenticated: false, surface: "app", pathname: "/app" });
    assert.equal(app.boot, true);
    assert.equal(app.showAppChrome, false);

    const policy = decideChrome({
      loading: true,
      authenticated: false,
      surface: "legal",
      pathname: "/privacy-policy",
    });
    assert.equal(policy.boot, false);
    assert.equal(policy.showAppChrome, false);
    assert.equal(policy.renderSurface, "legal");
  });

  it("signed-in `/` (or dashboard) keeps app chrome; `/landing` stays marketing", () => {
    const signedInApp = decideChrome({ loading: false, authenticated: true, surface: "app", pathname: "/app" });
    assert.equal(signedInApp.showAppChrome, true);
    assert.equal(signedInApp.renderSurface, "app");

    const signedInRoot = decideChrome({
      loading: false,
      authenticated: true,
      surface: "landing",
      pathname: "/",
      roleHome: "app",
    });
    assert.equal(signedInRoot.showAppChrome, true);
    assert.equal(signedInRoot.renderSurface, "app");

    const stayOnMarketing = decideChrome({
      loading: false,
      authenticated: true,
      surface: "landing",
      pathname: "/landing",
      roleHome: "app",
    });
    assert.equal(stayOnMarketing.showAppChrome, false);
    assert.equal(stayOnMarketing.renderSurface, "landing");

    assert.equal(
      nextAuthenticatedSurface({
        surface: "landing",
        pathname: "/",
        roleHome: "app",
        needsOnboarding: false,
      }),
      "app"
    );
    assert.equal(
      nextAuthenticatedSurface({
        surface: "landing",
        pathname: "/landing",
        roleHome: "app",
        needsOnboarding: false,
      }),
      "landing"
    );
    assert.equal(
      nextAuthenticatedSurface({
        surface: "landing",
        pathname: "/",
        roleHome: "admin",
        needsOnboarding: false,
      }),
      "admin"
    );
    assert.equal(
      nextAuthenticatedSurface({
        surface: "legal",
        pathname: "/privacy-policy",
        roleHome: "app",
        needsOnboarding: false,
      }),
      "legal"
    );
  });
});

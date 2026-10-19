import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminTabToPath,
  appViewToPath,
  canonicalizeAppView,
  canonicalizeAdminTab,
  decideChrome,
  destinationNavAfterAuth,
  isExplicitPublicPath,
  isProtectedSurface,
  isSmartHomePath,
  nextAuthenticatedSurface,
  loginModeFromPath,
  pathToNav,
  safeNextPath,
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
    const privacy = pathToNav("/privacy-policy");
    assert.equal(privacy.surface, "legal");
    assert.equal(privacy.policySlug, "privacy-policy");
    assert.equal(privacy.adminTab, "overview");
    assert.equal(pathToNav("/terms-of-service").policySlug, "terms-of-service");
    assert.equal(pathToNav("/data-deletion-instructions").policySlug, "data-deletion-instructions");
    assert.equal(pathToNav("/government-data-request-policy").surface, "legal");
    assert.equal(pathToNav("/government-data-request-policy").policySlug, "government-data-request-policy");
    assert.equal(pathToNav("/government-requests").policySlug, "government-data-request-policy");
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
    assert.equal(pathToNav("/pricing").surface, "pricing");
    assert.equal(isProtectedSurface("pricing"), false);
    assert.equal(surfaceToPath("pricing"), "/pricing");
    assert.equal(pathToNav("/refund-policy").surface, "legal");
    assert.equal(pathToNav("/refund-policy").policySlug, "refund-policy");
    assert.equal(surfaceToPath("login", { loginMode: "register" }), "/signup");
    assert.equal(pathToNav("/signup").surface, "login");
    assert.equal(pathToNav("/register").surface, "login");
    assert.equal(loginModeFromPath("/signup"), "register");
    assert.equal(loginModeFromPath("/register"), "register");
    assert.equal(loginModeFromPath("/login"), "signin");
    assert.equal(surfaceToPath("legal", { policySlug: "privacy-policy" }), "/privacy-policy");
  });

  it("maps clinician and admin tabs to distinct History-API paths (not HashRouter)", () => {
    assert.equal(pathToNav("/app/rx").surface, "app");
    assert.equal(pathToNav("/app/rx").appView, "rx");
    assert.equal(pathToNav("/app/whatsapp").appView, "whatsapp");
    assert.equal(pathToNav("/w/dr-demo-physio/whatsapp").surface, "app");
    assert.equal(pathToNav("/w/dr-demo-physio/whatsapp").workspaceSlug, "dr-demo-physio");
    assert.equal(pathToNav("/w/dr-demo-physio/whatsapp").appView, "whatsapp");
    assert.equal(pathToNav("/w/dr-demo-physio/billing").appView, "billing");
    assert.equal(pathToNav("/w/dr-demo-physio/patients").appView, "patients");
    assert.equal(pathToNav("/w/dr-demo-physio/patients").workspaceSlug, "dr-demo-physio");
    assert.equal(pathToNav("/w/dr-demo-physio/patients").recordId, "");
    assert.equal(pathToNav("/w/dr-demo-physio/patients/pat-42").appView, "patients");
    assert.equal(pathToNav("/w/dr-demo-physio/patients/pat-42").recordId, "pat-42");
    assert.equal(pathToNav("/app/patients/Pat-KeepCase").recordId, "Pat-KeepCase");
    assert.equal(pathToNav("/w/dr-demo-physio/queue/extra").recordId, "");
    assert.equal(appViewToPath("patients", "dr-demo-physio"), "/w/dr-demo-physio/patients");
    assert.equal(appViewToPath("patients", "dr-demo-physio", "pat-42"), "/w/dr-demo-physio/patients/pat-42");
    assert.equal(
      surfaceToPath("app", { appView: "patients", workspaceSlug: "dr-demo-physio", recordId: "pat-42" }),
      "/w/dr-demo-physio/patients/pat-42"
    );
    assert.equal(appViewToPath("whatsapp", "dr-demo-physio"), "/w/dr-demo-physio/whatsapp");
    assert.equal(surfaceToPath("app", { appView: "billing", workspaceSlug: "dr-demo-physio" }), "/w/dr-demo-physio/invoices");
    assert.equal(
      surfaceToPath("app", { appView: "billing", workspaceSlug: "dr-demo-physio", payFocus: true }),
      "/w/dr-demo-physio/payments"
    );
    assert.equal(appViewToPath("queue", "dr-demo-physio"), "/w/dr-demo-physio/opd");
    assert.equal(appViewToPath("rx", "dr-demo-physio", "visit-9"), "/w/dr-demo-physio/rx/visit-9");
    assert.equal(pathToNav("/w/dr-demo-physio/opd").appView, "queue");
    assert.equal(pathToNav("/w/dr-demo-physio/opd").screen, "opd");
    assert.equal(pathToNav("/w/dr-demo-physio/rx/Visit-Keep").recordId, "Visit-Keep");
    assert.equal(pathToNav("/w/dr-demo-physio/rx/Visit-Keep").screen, "rx");
    assert.equal(pathToNav("/w/dr-demo-physio/not-a-screen").unrecognized, true);
    assert.equal(pathToNav("/app/queue").appView, "queue");
    assert.equal(pathToNav("/app/smart-rx").appView, "rx");
    assert.equal(pathToNav("/app").appView, "queue");
    assert.equal(pathToNav("/admin/users").surface, "admin");
    assert.equal(pathToNav("/admin/users").adminTab, "users");
    assert.equal(pathToNav("/admin/people").adminTab, "people");
    assert.equal(pathToNav("/admin/profile").adminTab, "profile");
    assert.equal(pathToNav("/app/dental-chart").appView, "dental-chart");
    assert.equal(pathToNav("/admin/overview").adminTab, "overview");
    assert.equal(pathToNav("/admin/tenants").adminTab, "tenants");
    assert.equal(pathToNav("/admin/subscriptions").adminTab, "subscriptions");
    assert.equal(pathToNav("/admin/usage").adminTab, "usage");
    assert.equal(adminTabToPath("usage"), "/admin/usage");
    assert.equal(adminTabToPath("tenants"), "/admin/tenants");
    assert.equal(pathToNav("/admin").adminTab, "overview");
    assert.equal(pathToNav("/admin/not-a-tab").adminTab, "overview");
    assert.equal(canonicalizeAppView("smart-rx"), "rx");
    assert.equal(canonicalizeAdminTab("media"), "media");
    assert.equal(appViewToPath("rx"), "/app/rx");
    assert.equal(adminTabToPath("users"), "/admin/users");
    assert.equal(surfaceToPath("app", { appView: "billing" }), "/app/billing");
    assert.equal(surfaceToPath("admin", { adminTab: "site" }), "/admin/site");
    assert.notEqual(pathToNav("/app/rx").surface, "landing");
  });

  it("keeps auth URLs honest and restores nested next after login", () => {
    const loginNext = pathToNav("/login", "?next=%2Fapp%2Frx");
    assert.equal(loginNext.surface, "login");
    assert.equal(loginNext.loginMode, "signin");
    assert.equal(loginNext.loginNext, "app");
    assert.equal(loginNext.loginNextPath, "/app/rx");
    assert.equal(
      surfaceToPath("login", { loginNextPath: "/app/rx", loginMode: "register" }),
      "/signup?next=%2Fapp%2Frx"
    );
    assert.equal(safeNextPath("https://evil.example/app"), "");
    assert.equal(safeNextPath("//evil.example"), "");
    assert.deepEqual(destinationNavAfterAuth("app", "/app/rx"), {
      surface: "app",
      appView: "rx",
      adminTab: "overview",
      workspaceSlug: "",
      recordId: "",
      screen: "consultations",
      payFocus: false,
    });
    assert.deepEqual(destinationNavAfterAuth("app", "/w/dr-demo-physio/whatsapp"), {
      surface: "app",
      appView: "whatsapp",
      adminTab: "overview",
      workspaceSlug: "dr-demo-physio",
      recordId: "",
      screen: "whatsapp",
      payFocus: false,
    });
    assert.deepEqual(destinationNavAfterAuth("app", "/w/dr-demo-physio/patients/pat-42"), {
      surface: "app",
      appView: "patients",
      adminTab: "overview",
      workspaceSlug: "dr-demo-physio",
      recordId: "pat-42",
      screen: "patients",
      payFocus: false,
    });
    assert.deepEqual(destinationNavAfterAuth("admin", "/app/rx"), { surface: "admin" });
  });

  it("Privacy Back to `/` renders landing even if nav surface is still legal", () => {
    assert.equal(pathToNav("/").surface, "landing");
    assert.equal(pathToNav("/").policySlug, "");
    assert.equal(surfaceToPath("landing"), "/");
    const staleLegalOnRoot = decideChrome({
      loading: false,
      authenticated: false,
      surface: "legal",
      pathname: "/",
    });
    assert.equal(staleLegalOnRoot.renderSurface, "landing");
    assert.equal(staleLegalOnRoot.showAppChrome, false);
    assert.equal(staleLegalOnRoot.boot, false);
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

    const apexQueue = "/w/lumera-apex-polyclinic/queue";
    const apexBoot = decideChrome({ loading: true, authenticated: false, surface: "app", pathname: apexQueue });
    assert.equal(pathToNav(apexQueue).appView, "queue");
    assert.equal(pathToNav(apexQueue).workspaceSlug, "lumera-apex-polyclinic");
    assert.equal(apexBoot.boot, true);
    assert.equal(apexBoot.showAppChrome, false);
    assert.equal(apexBoot.renderSurface, "app");
    const apexRestored = decideChrome({
      loading: false,
      authenticated: true,
      surface: "app",
      pathname: apexQueue,
      roleHome: "app",
    });
    assert.equal(apexRestored.boot, false);
    assert.equal(apexRestored.showAppChrome, true);
    assert.equal(apexRestored.renderSurface, "app");

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

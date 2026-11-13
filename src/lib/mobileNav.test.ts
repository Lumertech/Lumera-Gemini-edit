import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, it } from "node:test";
import { ROLE_VISIBLE_VIEWS, ClinicSidebarLinks } from "../components/Sidebar.tsx";
import type { NavView } from "../components/Navbar.tsx";
import { allowedViewsForWorkflow, clinicianHomeView, patientsNavLabel, workflowForUser } from "./specialtyWorkflow.ts";
import { clinicNavItems, moreNavItems, primaryNavItems, type ClinicNavItem } from "./clinicNav.ts";
import type { AppUser } from "../types.ts";

function user(partial: Partial<AppUser> & Pick<AppUser, "role">): AppUser {
  return {
    id: "u",
    email: "clinic@example.test",
    name: "Ada",
    status: "active",
    phone: "",
    lastLogin: null,
    createdAt: "",
    ...partial,
  };
}

function navFor(role: string, specialty = "gp", practiceType: AppUser["practiceType"] = "individual") {
  const person = user({ role: role as AppUser["role"], specialty, practiceType, email: `${role}@example.test` });
  const pack = workflowForUser(person);
  let allowed = ROLE_VISIBLE_VIEWS[role] || ROLE_VISIBLE_VIEWS.default;
  if (practiceType !== "polyclinic") allowed = allowed.filter((view) => view !== "team" && view !== "polyclinic");
  allowed = allowedViewsForWorkflow(allowed, pack);
  return clinicNavItems({
    role,
    allowedViews: allowed,
    homeView: clinicianHomeView(person),
    patientsLabel: patientsNavLabel(pack),
  });
}

function renderNav(items: ClinicNavItem[], opts: { phoneLayout: boolean; isCollapsed: boolean; currentView?: NavView }) {
  const person = user({ role: "doctor", specialty: "gp" });
  const html = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(ClinicSidebarLinks, {
        primaryItems: primaryNavItems(items),
        moreItems: moreNavItems(items),
        phoneLayout: opts.phoneLayout,
        isCollapsed: opts.isCollapsed,
        currentView: opts.currentView || "appointments",
        screen: "",
        homeView: clinicianHomeView(person),
        workspaceSlug: "practice",
      })
    )
  );
  return html;
}

function anchor(html: string, testId: string): string {
  const match = html.match(new RegExp(`<a\\b[^>]*data-testid="${testId}"[^>]*>[\\s\\S]*?</a>`));
  assert.ok(match, `missing anchor ${testId}`);
  return match[0];
}

function labelSpan(html: string, label: string): string {
  const match = html.match(new RegExp(`<span\\b[^>]*data-nav-label="${label}"[^>]*>${label}</span>`));
  assert.ok(match, `missing visible label ${label}`);
  return match[0];
}

describe("mobile clinic navigation labels", () => {
  it("renders a visible label for every mobile nav item, including role menus and long names", () => {
    const roles: Array<{ role: string; practiceType: AppUser["practiceType"]; must: string[]; mustNot: string[] }> = [
      { role: "doctor", practiceType: "individual", must: ["Appointments", "OPD", "Consult", "Patients", "Billing", "Settings"], mustNot: ["Roster"] },
      { role: "receptionist", practiceType: "individual", must: ["Appointments", "OPD", "Patients", "Billing", "Settings"], mustNot: ["Consult"] },
      { role: "CLINIC_ADMIN", practiceType: "polyclinic", must: ["Appointments", "OPD", "Patients", "Billing", "Team", "Roster", "Settings"], mustNot: [] },
    ];

    for (const spec of roles) {
      const items = navFor(spec.role, "gp", spec.practiceType);
      const html = renderNav(items, { phoneLayout: true, isCollapsed: true, currentView: "appointments" });
      assert.match(html, /data-testid="clinic-nav-scroll"[^>]*overflow-y-auto/);
      assert.match(html, /data-testid="clinic-nav-scroll"[^>]*overflow-x-hidden/);
      assert.doesNotMatch(html, /overflow-x-auto|overflow-x-scroll/);

      for (const item of items) {
        const link = anchor(html, item.testId);
        const span = labelSpan(html, item.label);
        assert.equal(link.includes(`aria-label="${item.label}"`), true, item.label);
        assert.match(link, /min-h-11/, item.label);
        assert.match(span, /text-sm/, item.label);
        assert.match(span, /line-clamp-2/, item.label);
        assert.match(span, /break-words/, item.label);
        assert.match(span, /overflow-wrap:anywhere/, item.label);
        assert.doesNotMatch(span, /\bhidden\b|sr-only|invisible/);
        assert.equal(link.includes("title="), false, `${item.label} must not rely on a tooltip`);
        if (item.label === "Appointments") {
          assert.match(link, /bg-blue-600/);
          assert.match(link, /text-white/);
          assert.match(link, /aria-current="page"/);
        } else if (!item.payFocus) {
          assert.match(link, /text-slate-800/, item.label);
        }
      }
      for (const label of spec.must) assert.match(html, new RegExp(`data-nav-label="${label}"`), `${spec.role} ${label}`);
      for (const label of spec.mustNot) assert.equal(html.includes(`data-nav-label="${label}"`), false, `${spec.role} ${label}`);
      assert.doesNotMatch(html, /<details/);
    }

    const hindi = "अपॉइंटमेंट्स और परामर्श";
    const marathi = "रुग्ण नोंदणी यादी";
    const wrapped = renderNav(
      [
        { id: "appointments", label: hindi, testId: "app-nav-appointments" },
        { id: "patients", label: marathi, testId: "app-nav-patients" },
      ],
      { phoneLayout: true, isCollapsed: true, currentView: "queue" }
    );
    for (const label of [hindi, marathi]) {
      const span = labelSpan(wrapped, label);
      assert.match(span, /line-clamp-2/);
      assert.match(span, /break-words/);
      assert.match(span, /overflow-wrap:anywhere/);
      assert.match(anchor(wrapped, label === hindi ? "app-nav-appointments" : "app-nav-patients"), /min-h-11/);
    }
  });

  it("keeps the desktop rail icon-only when collapsed and labeled when expanded", () => {
    const items = navFor("doctor");
    const collapsed = renderNav(items, { phoneLayout: false, isCollapsed: true });
    assert.equal(collapsed.includes("data-nav-label"), false);
    assert.match(collapsed, /title="Appointments"/);
    assert.match(collapsed, /title="Settings"/);
    assert.doesNotMatch(collapsed, /min-h-11/);
    const stripped = collapsed.replace(/\s(?:title|aria-label)="[^"]*"/g, "");
    assert.equal(stripped.includes("Appointments"), false);
    assert.match(collapsed, /aria-label="Appointments"/);

    const expanded = renderNav(items, { phoneLayout: false, isCollapsed: false, currentView: "appointments" });
    const link = anchor(expanded, "app-nav-appointments");
    const span = labelSpan(expanded, "Appointments");
    assert.match(span, /class="truncate"/);
    assert.doesNotMatch(span, /line-clamp-2/);
    assert.doesNotMatch(link, /min-h-11/);
    assert.match(link, /transition-colors/);
    assert.match(link, /bg-blue-600/);
    assert.equal(link.includes(`aria-label="Appointments"`), true);
    assert.match(expanded, /max-h-40/);
    assert.match(expanded, /overflow-hidden/);
  });

  it("wires the phone layout through the app sidebar", () => {
    const sidebar = fs.readFileSync(path.join(process.cwd(), "src/components/Sidebar.tsx"), "utf8");
    const app = fs.readFileSync(path.join(process.cwd(), "src/ClinicianApp.tsx"), "utf8");
    assert.match(sidebar, /<ClinicSidebarLinks/);
    assert.match(sidebar, /phoneLayout=\{phoneLayout\}/);
    assert.match(sidebar, /max-w-\[calc\(100vw-2\.5rem\)\]/);
    assert.match(app, /useState\(false\)/);
    assert.doesNotMatch(app, /innerWidth < 1024/);
  });
});

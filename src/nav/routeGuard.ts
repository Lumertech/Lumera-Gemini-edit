/**
 * Route-level role gate. Allow-lists match the clinician shell exactly.
 * A disallowed screen redirects to that role's own default screen.
 * Later nav PRs can call `tenantRouteGuard` / `useTenantRouteGuard` without
 * rewriting the screen table.
 */
import type { AppUser } from "../types";
import { visibleViewsForRole } from "../components/Sidebar";
import { isPolyclinicPractice } from "../lib/sessionWorkspace";
import { allowedViewsForWorkflow, clinicianHomeView, workflowForUser } from "../lib/specialtyWorkflow";
import { parseWorkspaceScreen, readWorkspaceSlug, workspaceScreenPath } from "./tenantRoutes";

export interface RouteGuardDecision {
  redirect: string | null;
}

function allowedViewsFor(user: Pick<AppUser, "role"> & Partial<AppUser>): string[] {
  let allowed = visibleViewsForRole(user.role);
  if (!isPolyclinicPractice(user as AppUser)) {
    allowed = allowed.filter((view) => view !== "team" && view !== "polyclinic");
  }
  return allowedViewsForWorkflow(allowed, workflowForUser(user as AppUser));
}

/** Same allow rule the clinician shell uses before it paints a module. */
export function isTenantViewAllowed(role: string | null | undefined, view: string, allowedViews: readonly string[]): boolean {
  if (role === "super_admin") return view === "settings";
  if (role === "admin") return false;
  return (
    allowedViews.includes(view) ||
    view === "opd-queue" ||
    view === "smart-rx" ||
    view === "welcome" ||
    view === "settings" ||
    view === "wellness" ||
    view === "therapy-session" ||
    view === "consult-practice" ||
    view === "physio-session" ||
    view === "dental-chart" ||
    view === "gp-home"
  );
}

/** Where a blocked deep link lands. Receptionists leave Rx on the desk, not the queue. */
export function deniedScreenForRole(role: string | null | undefined): "reception" | "dashboard" | "portal" {
  if (role === "patient") return "portal";
  if (role === "receptionist" || role === "nurse") return "reception";
  return "dashboard";
}

export function tenantRouteGuard(user: Pick<AppUser, "role"> & Partial<AppUser>, pathname: string): RouteGuardDecision {
  const role = String(user.role || "");
  if (role === "super_admin" || role === "admin") {
    const onWorkspace = /^\/w(\/|$)/i.test(pathname) || /^\/app(\/|$)/i.test(pathname);
    return { redirect: onWorkspace ? "/admin" : null };
  }

  const parts = (pathname.split("?")[0] || "/").replace(/\/+$/, "").split("/").filter(Boolean);
  const head = (parts[0] || "").toLowerCase();
  if (head !== "w" && head !== "app") return { redirect: null };

  const slug = head === "w" ? readWorkspaceSlug(pathname) : "";
  const viewSeg = head === "w" ? parts[2] || "" : parts[1] || "";
  const recordSeg = head === "w" ? parts[3] || "" : parts[2] || "";
  const parsed = parseWorkspaceScreen(viewSeg, recordSeg);
  if (!parsed.recognized) return { redirect: null };

  const renderedView = parsed.screen === "dashboard" ? clinicianHomeView(user as AppUser) : parsed.appView;
  const allowed = allowedViewsFor(user);
  if (isTenantViewAllowed(role, renderedView, allowed)) return { redirect: null };

  if (!isPolyclinicPractice(user as AppUser) && (renderedView === "polyclinic" || renderedView === "team")) {
    return { redirect: slug ? workspaceScreenPath(slug, "opd") : "/app/queue" };
  }

  const fallback = deniedScreenForRole(role);
  if (fallback === "portal") return { redirect: "/portal" };
  if (!slug) return { redirect: fallback === "reception" ? "/app/reception" : "/app" };
  return { redirect: workspaceScreenPath(slug, fallback) };
}

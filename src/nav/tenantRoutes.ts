/**
 * Canonical clinic URLs: /w/<tenant-slug>/<screen>[/<record>].
 * Internal module ids (queue, billing, voicebot, …) stay the render keys.
 * The address bar uses the screen names the product actually links to.
 */

export const TENANT_SCREENS = [
  "dashboard",
  "appointments",
  "opd",
  "patients",
  "consultations",
  "rx",
  "invoices",
  "payments",
  "ai-voice",
  "settings",
  "reception",
] as const;

export type TenantScreen = (typeof TENANT_SCREENS)[number];

const TENANT_SCREEN_SET = new Set<string>(TENANT_SCREENS);

/** Specialty homes are one dashboard URL. The signed-in pack still picks the board. */
const HOME_VIEWS = new Set([
  "welcome",
  "gp-home",
  "wellness",
  "therapy-session",
  "consult-practice",
  "physio-session",
  "dental-chart",
]);

/** Legacy segments that must keep their internal view id when parsed. */
const PASSTHROUGH_VIEWS = new Set([
  "appointments",
  "patients",
  "settings",
  "reception",
  "whatsapp",
  "pharmacy-hub",
  "reports",
  "kiosk",
  "ambient",
  "dhis",
  "team",
  "polyclinic",
  "portal",
]);

export interface ParsedWorkspaceScreen {
  screen: string;
  /** Module id the clinician shell already switches on. */
  appView: string;
  recordId: string;
  payFocus: boolean;
  /** False for a /w segment that is not a screen and not a legacy view. */
  recognized: boolean;
}

export function isTenantScreen(value: string): value is TenantScreen {
  return TENANT_SCREEN_SET.has(value);
}

export function readWorkspaceSlug(pathname: string): string {
  const parts = pathParts(pathname);
  if ((parts[0] || "").toLowerCase() !== "w") return "";
  return (parts[1] || "").toLowerCase();
}

function pathParts(pathname: string): string[] {
  return (pathname.split("?")[0] || "/")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);
}

function samePath(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

/**
 * Map one URL segment (plus an optional record) to the screen the shell renders.
 * Record ids keep their original case.
 */
export function parseWorkspaceScreen(viewSeg: string, recordSeg = ""): ParsedWorkspaceScreen {
  const key = String(viewSeg || "").trim().toLowerCase();
  const recordId = String(recordSeg || "").trim();
  if (!key) {
    return { screen: "dashboard", appView: "welcome", recordId: "", payFocus: false, recognized: true };
  }

  if (key === "dashboard") {
    return { screen: "dashboard", appView: "welcome", recordId: "", payFocus: false, recognized: true };
  }
  if (HOME_VIEWS.has(key)) {
    return { screen: "dashboard", appView: key, recordId: "", payFocus: false, recognized: true };
  }
  if (key === "opd" || key === "queue" || key === "opd-queue") {
    return { screen: "opd", appView: "queue", recordId: "", payFocus: false, recognized: true };
  }
  if (key === "patients") {
    return { screen: "patients", appView: "patients", recordId, payFocus: false, recognized: true };
  }
  if (key === "consultations") {
    return { screen: "consultations", appView: "rx", recordId: "", payFocus: false, recognized: true };
  }
  if (key === "rx" || key === "smart-rx") {
    if (recordId) {
      return { screen: "rx", appView: "rx", recordId, payFocus: false, recognized: true };
    }
    return { screen: "consultations", appView: "rx", recordId: "", payFocus: false, recognized: true };
  }
  if (key === "invoices" || key === "billing") {
    return { screen: "invoices", appView: "billing", recordId, payFocus: false, recognized: true };
  }
  if (key === "payments") {
    return { screen: "payments", appView: "billing", recordId: "", payFocus: true, recognized: true };
  }
  if (key === "ai-voice" || key === "voicebot") {
    return { screen: "ai-voice", appView: "voicebot", recordId: "", payFocus: false, recognized: true };
  }
  if (PASSTHROUGH_VIEWS.has(key)) {
    return { screen: key, appView: key, recordId: "", payFocus: false, recognized: true };
  }

  return { screen: key, appView: "welcome", recordId: "", payFocus: false, recognized: false };
}

export function workspaceScreenPath(slug: string, screen: string, recordId = ""): string {
  const ws = String(slug || "").trim().toLowerCase();
  const id = String(recordId || "").trim();
  if (screen === "patients" && id) return `/w/${ws}/patients/${encodeURIComponent(id)}`;
  if (screen === "rx" && id) return `/w/${ws}/rx/${encodeURIComponent(id)}`;
  if (screen === "invoices" && id) return `/w/${ws}/invoices/${encodeURIComponent(id)}`;
  return `/w/${ws}/${screen}`;
}

/** History path for a module id. Workspace links use canonical screens. */
export function appViewToWorkspacePath(
  view: string,
  slug: string,
  recordId = "",
  payFocus = false
): string {
  const key = String(view || "").trim().toLowerCase();
  const id = String(recordId || "").trim();
  if ((key === "rx" || key === "smart-rx") && id) return workspaceScreenPath(slug, "rx", id);
  if (key === "patients" && id) return workspaceScreenPath(slug, "patients", id);
  if (key === "payments" || ((key === "billing" || key === "invoices") && payFocus)) {
    return workspaceScreenPath(slug, "payments");
  }
  if (key === "billing" || key === "invoices") return workspaceScreenPath(slug, "invoices", id);
  if (key === "queue" || key === "opd-queue" || key === "opd") return workspaceScreenPath(slug, "opd");
  if (key === "voicebot" || key === "ai-voice") return workspaceScreenPath(slug, "ai-voice");
  if (key === "consultations" || key === "rx" || key === "smart-rx") return workspaceScreenPath(slug, "consultations");
  if (key === "dashboard" || HOME_VIEWS.has(key)) return workspaceScreenPath(slug, "dashboard");
  if (PASSTHROUGH_VIEWS.has(key) || isTenantScreen(key)) return workspaceScreenPath(slug, key);
  return workspaceScreenPath(slug, key || "dashboard");
}

/**
 * Rewrite a legacy /w path onto the canonical screen.
 * Returns null when the path is already canonical or is not a workspace URL.
 * Unknown screens are left alone so a refresh does not jump to another module.
 */
export function canonicalizeTenantScreenPath(pathname: string): string | null {
  const raw = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  const parts = raw.split("/").filter(Boolean);
  if ((parts[0] || "").toLowerCase() !== "w") return null;
  const slug = (parts[1] || "").toLowerCase();
  if (!slug) return null;
  const view = (parts[2] || "").toLowerCase();
  const record = parts[3] || "";
  const parsed = parseWorkspaceScreen(view, record);
  if (!parsed.recognized) return null;
  const next = workspaceScreenPath(slug, parsed.screen, parsed.recordId);
  return samePath(raw, next) ? null : next;
}

/** Same-origin clinic return path. Rejects off-site and non-workspace targets. */
export function safeWorkspaceReturnPath(raw?: string | null): string {
  if (!raw) return "";
  let value = String(raw).trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    /* already decoded */
  }
  if (!value.startsWith("/") || value.startsWith("//")) return "";
  if (value.includes("\\") || value.includes("..")) return "";
  const pathOnly = (value.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  const lower = pathOnly.toLowerCase();
  if (
    lower.startsWith("/api") ||
    lower.startsWith("/meta") ||
    lower.startsWith("/uploads") ||
    lower === "/healthz" ||
    lower === "/login" ||
    lower === "/signup" ||
    lower === "/register"
  ) {
    return "";
  }
  if (lower === "/w" || lower.startsWith("/w/") || lower === "/app" || lower.startsWith("/app/")) {
    return pathOnly;
  }
  return "";
}

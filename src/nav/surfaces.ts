export type Surface = "landing" | "login" | "app" | "admin" | "portal" | "policy" | "legal" | "onboarding";

export const ADMIN_TABS = [
  "overview",
  "users",
  "people",
  "branches",
  "tenants",
  "profile",
  "settings",
  "subscriptions",
  "audit",
  "dhis",
  "meta",
  "site",
  "policies",
  "media",
] as const;

export type AdminTab = (typeof ADMIN_TABS)[number];

export const APP_VIEWS = [
  "welcome",
  "reception",
  "ambient",
  "rx",
  "queue",
  "kiosk",
  "reports",
  "appointments",
  "polyclinic",
  "whatsapp",
  "voicebot",
  "billing",
  "portal",
  "dhis",
  "team",
  "settings",
  "wellness",
  "therapy-session",
  "consult-practice",
  "physio-session",
  "dental-chart",
] as const;

export type AppView = (typeof APP_VIEWS)[number];

export type LoginMode = "signin" | "register";

export const DEFAULT_APP_VIEW: AppView = "queue";
export const DEFAULT_ADMIN_TAB: AdminTab = "overview";

const APP_VIEW_SET = new Set<string>(APP_VIEWS);
const ADMIN_TAB_SET = new Set<string>(ADMIN_TABS);

const APP_VIEW_ALIASES: Record<string, AppView> = {
  "smart-rx": "rx",
  "opd-queue": "queue",
  lab: "reports",
};

export interface NavLocation {
  surface: Surface;
  policySlug: string;
  adminTab: AdminTab;
  appView: AppView;
  loginMode: LoginMode;
  loginNext: Surface;
  loginNextPath: string;
}

export const DEFAULT_NAV: NavLocation = {
  surface: "landing",
  policySlug: "",
  adminTab: DEFAULT_ADMIN_TAB,
  appView: DEFAULT_APP_VIEW,
  loginMode: "signin",
  loginNext: "app",
  loginNextPath: "",
};

/** Surfaces anyone may see without a session. No clinician chrome. */
export const PUBLIC_SURFACES: readonly Surface[] = ["landing", "login", "legal", "policy"];

/** Surfaces that must never render until a session exists. */
export const PROTECTED_SURFACES: readonly Surface[] = ["app", "admin", "portal", "onboarding"];

const POLICY_PATHS: Record<string, string> = {
  "/privacy-policy": "privacy-policy",
  "/privacy": "privacy-policy",
  "/terms-of-service": "terms-of-service",
  "/terms": "terms-of-service",
  "/data-deletion-instructions": "data-deletion-instructions",
  "/data-deletion": "data-deletion-instructions",
  "/security": "security",
};

export function normalizePath(pathname: string): string {
  const clean = (pathname.split("?")[0] || "/").toLowerCase();
  const trimmed = clean.replace(/\/+$/, "") || "/";
  if (trimmed === "/index.html") return "/";
  return trimmed;
}

export function isSmartHomePath(pathname: string): boolean {
  return normalizePath(pathname) === "/";
}

/** Marketing site even when a clinician is signed in (Exit to site). */
export function isExplicitPublicPath(pathname: string): boolean {
  const p = normalizePath(pathname);
  return p === "/landing" || p === "/site" || p === "/public";
}

export function isProtectedSurface(surface: Surface): boolean {
  return (PROTECTED_SURFACES as readonly string[]).includes(surface);
}

export function isPublicSurface(surface: Surface): boolean {
  return (PUBLIC_SURFACES as readonly string[]).includes(surface);
}

export function canonicalizeAppView(raw?: string | null): AppView {
  if (!raw) return DEFAULT_APP_VIEW;
  const key = raw.toLowerCase();
  if (APP_VIEW_SET.has(key)) return key as AppView;
  return APP_VIEW_ALIASES[key] || DEFAULT_APP_VIEW;
}

export function canonicalizeAdminTab(raw?: string | null): AdminTab {
  if (!raw) return DEFAULT_ADMIN_TAB;
  const key = raw.toLowerCase();
  return ADMIN_TAB_SET.has(key) ? (key as AdminTab) : DEFAULT_ADMIN_TAB;
}

/** Distinct path for each clinician tab so a click always updates `window.location`. */
export function appViewToPath(view?: string | null): string {
  return `/app/${canonicalizeAppView(view)}`;
}

/** Distinct path for each admin section. */
export function adminTabToPath(tab?: string | null): string {
  return `/admin/${canonicalizeAdminTab(tab)}`;
}

export function loginModeFromPath(pathname: string): LoginMode {
  const p = normalizePath(pathname);
  return p === "/signup" || p === "/register" ? "register" : "signin";
}

/** Block open redirects: only same-origin product paths. */
export function safeNextPath(raw?: string | null): string {
  if (!raw) return "";
  let value = raw.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    /* already decoded */
  }
  if (!value.startsWith("/") || value.startsWith("//")) return "";
  const pathOnly = normalizePath(value.split("?")[0] || "/");
  if (
    pathOnly.startsWith("/api") ||
    pathOnly.startsWith("/meta") ||
    pathOnly.startsWith("/uploads") ||
    pathOnly === "/healthz"
  ) {
    return "";
  }
  if (pathOnly === "/login" || pathOnly === "/signup" || pathOnly === "/register") return "";
  return pathOnly;
}

function nav(surface: Surface, extras: Partial<NavLocation> = {}): NavLocation {
  return { ...DEFAULT_NAV, surface, ...extras };
}

function parseSearch(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith("?") ? search : search ? `?${search}` : "");
}

function surfaceFromQuery(search: string): Surface | null {
  const params = parseSearch(search);
  const raw = (params.get("surface") || params.get("view") || "").toLowerCase();
  if (!raw) return null;
  if (raw === "landing" || raw === "site" || raw === "public") return "landing";
  if (raw === "portal" || raw === "patient") return "portal";
  if (raw === "admin") return "admin";
  if (raw === "login") return "login";
  if (raw === "app" || raw === "dashboard" || raw === "studio" || raw === "clinic") return "app";
  if (raw === "onboarding") return "onboarding";
  if (raw === "legal" || raw === "policy") return "legal";
  return null;
}

function firstSegmentAfter(prefix: string, pathname: string): string {
  if (!pathname.startsWith(`${prefix}/`)) return "";
  return pathname.slice(prefix.length + 1).split("/")[0] || "";
}

function loginFromPath(pathname: string, search: string): NavLocation {
  const params = parseSearch(search);
  const nextPath = safeNextPath(params.get("next"));
  const nextLoc = nextPath ? pathToNav(nextPath) : null;
  const allowedNext = nextLoc && isProtectedSurface(nextLoc.surface);
  return nav("login", {
    loginMode: loginModeFromPath(pathname),
    loginNext: allowedNext ? nextLoc.surface : "app",
    loginNextPath: allowedNext ? nextPath : "",
  });
}

/** Map a URL to a product surface. `/` is the smart home (landing until auth resolves). */
export function pathToNav(pathname = "/", search = ""): NavLocation {
  const p = normalizePath(pathname);

  if (p === "/login" || p === "/signin" || p === "/sign-in" || p === "/signup" || p === "/register") {
    return loginFromPath(p, search);
  }

  const fromQuery = surfaceFromQuery(search);
  if (fromQuery) {
    return nav(fromQuery);
  }

  const policy = POLICY_PATHS[p];
  if (policy) return nav("legal", { policySlug: policy });

  if (p === "/admin" || p.startsWith("/admin/")) {
    return nav("admin", { adminTab: canonicalizeAdminTab(firstSegmentAfter("/admin", p)) });
  }
  if (p === "/portal" || p === "/patient") return nav("portal");
  if (p === "/landing" || p === "/site" || p === "/public") return nav("landing");
  if (p === "/onboarding") return nav("onboarding");
  if (p === "/app" || p.startsWith("/app/")) {
    return nav("app", { appView: canonicalizeAppView(firstSegmentAfter("/app", p)) });
  }
  if (p === "/dashboard" || p === "/studio" || p === "/clinic") {
    return nav("app", { appView: DEFAULT_APP_VIEW });
  }

  return nav("landing");
}

export interface SurfacePathOpts {
  policySlug?: string;
  explicitPublic?: boolean;
  loginMode?: LoginMode;
  loginNext?: Surface;
  loginNextPath?: string;
  adminTab?: AdminTab | string;
  appView?: AppView | string;
}

export function surfaceToPath(surface: Surface, opts?: SurfacePathOpts): string {
  if (surface === "login") {
    const base = opts?.loginMode === "register" ? "/signup" : "/login";
    const next =
      safeNextPath(opts?.loginNextPath) ||
      (opts?.loginNext && isProtectedSurface(opts.loginNext)
        ? surfaceToPath(opts.loginNext, { appView: opts.appView, adminTab: opts.adminTab })
        : "");
    return next ? `${base}?next=${encodeURIComponent(next)}` : base;
  }
  if (surface === "app") {
    return opts?.appView ? appViewToPath(opts.appView) : "/app";
  }
  if (surface === "admin") {
    return opts?.adminTab ? adminTabToPath(opts.adminTab) : "/admin";
  }
  if (surface === "portal") return "/portal";
  if (surface === "onboarding") return "/onboarding";
  if (surface === "legal" || surface === "policy") {
    const slug = opts?.policySlug || "privacy-policy";
    return `/${slug}`;
  }
  if (opts?.explicitPublic) return "/landing";
  return "/";
}

/** After login, restore the nested tab encoded in `?next=` when it matches the allowed dest. */
export function destinationNavAfterAuth(dest: Surface, loginNextPath?: string): {
  surface: Surface;
  appView?: AppView;
  adminTab?: AdminTab;
} {
  const nextPath = safeNextPath(loginNextPath);
  if (!nextPath) return { surface: dest };
  const loc = pathToNav(nextPath);
  if (loc.surface !== dest) return { surface: dest };
  return { surface: loc.surface, appView: loc.appView, adminTab: loc.adminTab };
}

export interface ChromeDecision {
  /** Neutral splash — never clinician chrome. */
  boot: boolean;
  /** Clinician / admin / portal chrome may mount. */
  showAppChrome: boolean;
  /** Surface the UI should render after boot. */
  renderSurface: Surface;
}

/**
 * Founder lock: anonymous `/` is the public site; app chrome only after auth.
 * Protected deep links never flash Navbar/Sidebar while session is unknown.
 */
export function decideChrome(args: {
  loading: boolean;
  authenticated: boolean;
  surface: Surface;
  pathname?: string;
  roleHome?: Surface;
  needsOnboarding?: boolean;
}): ChromeDecision {
  const { loading, authenticated, surface } = args;
  const pathname = args.pathname ?? "/";
  const smartHome = isSmartHomePath(pathname) && !isExplicitPublicPath(pathname);

  if (loading) {
    if (isProtectedSurface(surface) || smartHome) {
      return { boot: true, showAppChrome: false, renderSurface: surface };
    }
    return { boot: false, showAppChrome: false, renderSurface: surface };
  }

  if (!authenticated) {
    // Trust the URL: stale `legal`/`policy` state must not keep Privacy on `/`.
    if (smartHome) {
      return { boot: false, showAppChrome: false, renderSurface: "landing" };
    }
    if (isProtectedSurface(surface)) {
      return { boot: false, showAppChrome: false, renderSurface: "login" };
    }
    return { boot: false, showAppChrome: false, renderSurface: surface };
  }

  const renderSurface = nextAuthenticatedSurface({
    surface,
    pathname,
    roleHome: args.roleHome || "app",
    needsOnboarding: Boolean(args.needsOnboarding),
  });

  return {
    boot: false,
    showAppChrome: isProtectedSurface(renderSurface),
    renderSurface,
  };
}

/** After session hydrate: signed-in `/` becomes role home; explicit `/landing` stays public. */
export function nextAuthenticatedSurface(args: {
  surface: Surface;
  pathname: string;
  roleHome: Surface;
  needsOnboarding: boolean;
}): Surface {
  const { surface, pathname, roleHome, needsOnboarding } = args;
  if (surface === "legal" || surface === "policy") return surface;
  if (needsOnboarding) return "onboarding";
  if (surface === "onboarding") return roleHome;
  if (surface === "login") return roleHome;
  if (surface === "landing" && isSmartHomePath(pathname) && !isExplicitPublicPath(pathname)) {
    return roleHome;
  }
  return surface;
}

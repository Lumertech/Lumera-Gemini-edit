export type Surface = "landing" | "login" | "app" | "admin" | "portal" | "policy" | "legal" | "onboarding";

export type AdminTab =
  | "overview"
  | "users"
  | "people"
  | "branches"
  | "tenants"
  | "profile"
  | "settings"
  | "subscriptions"
  | "audit"
  | "dhis"
  | "meta"
  | "site"
  | "policies"
  | "media";

export interface NavLocation {
  surface: Surface;
  policySlug: string;
  adminTab: AdminTab;
}

export const DEFAULT_NAV: NavLocation = {
  surface: "landing",
  policySlug: "privacy",
  adminTab: "overview",
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

function nav(surface: Surface, policySlug = "privacy"): NavLocation {
  return { surface, policySlug, adminTab: "overview" };
}

function surfaceFromQuery(search: string): Surface | null {
  const params = new URLSearchParams(search.startsWith("?") ? search : search ? `?${search}` : "");
  const raw = (params.get("surface") || params.get("view") || params.get("tab") || "").toLowerCase();
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

/** Map a URL to a product surface. `/` is the smart home (landing until auth resolves). */
export function pathToNav(pathname = "/", search = ""): NavLocation {
  const fromQuery = surfaceFromQuery(search);
  if (fromQuery) {
    return nav(fromQuery);
  }

  const p = normalizePath(pathname);
  const policy = POLICY_PATHS[p];
  if (policy) return nav("legal", policy);

  if (p === "/admin") return nav("admin");
  if (p === "/portal" || p === "/patient") return nav("portal");
  if (p === "/landing" || p === "/site" || p === "/public") return nav("landing");
  if (p === "/login") return nav("login");
  if (p === "/signup" || p === "/register") return nav("login");
  if (p === "/onboarding") return nav("onboarding");
  if (p === "/app" || p === "/dashboard" || p === "/studio" || p === "/clinic") return nav("app");

  return nav("landing");
}

export function loginModeFromPath(pathname: string): "signin" | "register" {
  const p = normalizePath(pathname);
  return p === "/signup" || p === "/register" ? "register" : "signin";
}

export function surfaceToPath(
  surface: Surface,
  opts?: { policySlug?: string; explicitPublic?: boolean; loginMode?: "signin" | "register" }
): string {
  if (surface === "login") return opts?.loginMode === "register" ? "/signup" : "/login";
  if (surface === "app") return "/app";
  if (surface === "admin") return "/admin";
  if (surface === "portal") return "/portal";
  if (surface === "onboarding") return "/onboarding";
  if (surface === "legal" || surface === "policy") {
    const slug = opts?.policySlug || "privacy-policy";
    return `/${slug}`;
  }
  if (opts?.explicitPublic) return "/landing";
  return "/";
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

import type { NavView } from "../components/Navbar";

/**
 * Same matrix the sidebar uses for nav visibility.
 * Prescriber chrome (Start Consult, New Rx, Smart Rx, Ambient) follows `rx` / `smart-rx`.
 */
export const ROLE_VISIBLE_VIEWS: Record<string, NavView[]> = {
  doctor: ['welcome', 'queue', 'opd-queue', 'rx', 'smart-rx', 'ambient', 'reports', 'appointments', 'polyclinic', 'whatsapp', 'voicebot', 'pharmacy-hub', 'billing', 'dhis', 'team', 'reception', 'kiosk', 'settings', 'wellness', 'therapy-session', 'consult-practice', 'physio-session', 'dental-chart'],
  receptionist: ['welcome', 'reception', 'queue', 'opd-queue', 'appointments', 'kiosk', 'pharmacy-hub', 'billing', 'whatsapp', 'settings'],
  polyclinic_admin: ['welcome', 'queue', 'opd-queue', 'reception', 'appointments', 'polyclinic', 'billing', 'reports', 'whatsapp', 'voicebot', 'pharmacy-hub', 'dhis', 'team', 'kiosk', 'settings'],
  CLINIC_ADMIN: ['welcome', 'queue', 'opd-queue', 'reception', 'appointments', 'polyclinic', 'billing', 'reports', 'whatsapp', 'voicebot', 'pharmacy-hub', 'dhis', 'portal', 'team', 'kiosk', 'settings'],
  super_admin: ['welcome', 'queue', 'opd-queue', 'reception', 'rx', 'smart-rx', 'ambient', 'reports', 'appointments', 'polyclinic', 'whatsapp', 'voicebot', 'pharmacy-hub', 'billing', 'dhis', 'team', 'kiosk', 'settings'],
  patient: ['portal'],
  nurse: ['reception', 'queue', 'opd-queue', 'reports', 'pharmacy-hub', 'settings'],
  lab_technician: ['reports', 'queue', 'opd-queue', 'pharmacy-hub', 'settings'],
  pharmacist: ['billing', 'pharmacy-hub', 'queue', 'opd-queue', 'settings'],
  default: ['welcome', 'queue', 'opd-queue', 'reception', 'appointments', 'pharmacy-hub', 'billing', 'settings'],
};

/** Unknown roles keep the existing doctor fallback used by the sidebar. */
export function viewsForRole(role?: string | null): readonly NavView[] {
  if (role && ROLE_VISIBLE_VIEWS[role]) return ROLE_VISIBLE_VIEWS[role];
  return ROLE_VISIBLE_VIEWS.doctor;
}

/** Doctor and super_admin may open Smart Rx. Reception and other desk roles may not. */
export function roleMayStartConsult(role?: string | null): boolean {
  const views = viewsForRole(role);
  return views.includes("rx") || views.includes("smart-rx");
}

export function isConsultEntryView(view?: string | null): boolean {
  const key = String(view || "").toLowerCase();
  return key === "rx" || key === "smart-rx" || key === "ambient";
}

/**
 * Sidebar primary button. Consult / Rx targets are omitted for non-prescribers.
 * Front-desk "Register patient" (reception home) stays visible.
 */
export function primaryCtaTarget(opts: {
  role?: string | null;
  showMedicalRx: boolean;
  homeView: string;
  allowedViews: readonly string[];
}): { visible: boolean; view: string } {
  const intended = opts.showMedicalRx ? "rx" : opts.homeView;
  if (isConsultEntryView(intended)) {
    const allowed = opts.allowedViews.some((view) => view === "rx" || view === "smart-rx" || view === intended);
    return { visible: roleMayStartConsult(opts.role) && allowed, view: intended };
  }
  return { visible: opts.allowedViews.includes(intended), view: intended };
}

/**
 * Where to send a non-prescriber who opened /rx, /smart-rx, or Ambient.
 * Null means stay put (prescriber, or the view is already their home).
 */
export function consultEntryRedirectView(
  role: string | null | undefined,
  currentView: string | null | undefined,
  homeView: string
): string | null {
  if (roleMayStartConsult(role)) return null;
  if (!isConsultEntryView(currentView)) return null;
  if (String(currentView) === homeView) return null;
  return homeView;
}

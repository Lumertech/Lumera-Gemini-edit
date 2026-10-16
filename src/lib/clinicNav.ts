import type { AppUser } from "../types";
import type { NavView } from "../components/Navbar";
import { clinicCalendarDate, shiftIsoDate } from "./clinicDay";
import { formatInr } from "./money";

export interface ClinicNavItem {
  id: NavView;
  label: string;
  testId: string;
  /** Payments opens billing focused on collection. */
  payFocus?: boolean;
}

export interface VisitLite {
  id: string;
  date?: string;
  status?: string;
  patientName?: string;
  timeSlot?: string;
  consultationFee?: number;
  isPaid?: boolean;
  type?: string;
}

const FLOW: ClinicNavItem[] = [
  { id: "appointments", label: "Appointments", testId: "app-nav-appointments" },
  { id: "queue", label: "OPD", testId: "app-nav-queue" },
  { id: "rx", label: "Consult", testId: "app-nav-rx" },
  { id: "billing", label: "Billing", testId: "app-nav-billing" },
  { id: "billing", label: "Payments", testId: "app-nav-payments", payFocus: true },
];

const MORE: ClinicNavItem[] = [
  { id: "patients", label: "Patients", testId: "app-nav-patients" },
  { id: "reception", label: "Intake", testId: "app-nav-reception" },
  { id: "pharmacy-hub", label: "Pharmacy", testId: "app-nav-pharmacy-hub" },
  { id: "reports", label: "Labs", testId: "app-nav-reports" },
  { id: "whatsapp", label: "WhatsApp", testId: "app-nav-whatsapp" },
  { id: "voicebot", label: "Voice", testId: "app-nav-voicebot" },
  { id: "kiosk", label: "Kiosk", testId: "app-nav-kiosk" },
  { id: "ambient", label: "Scribe", testId: "app-nav-ambient" },
  { id: "dhis", label: "Incentives", testId: "app-nav-dhis" },
  { id: "team", label: "Team", testId: "app-nav-team" },
  { id: "polyclinic", label: "Roster", testId: "app-nav-polyclinic" },
  { id: "portal", label: "Portal", testId: "app-nav-portal" },
  { id: "settings", label: "Settings", testId: "app-nav-settings" },
];

function allowed(set: Set<string>, id: string): boolean {
  if (set.has(id)) return true;
  if (id === "queue" && set.has("opd-queue")) return true;
  if (id === "rx" && set.has("smart-rx")) return true;
  return false;
}

/** Short left-nav: daily flow first, then the rest of the clinic tools. */
export function clinicNavItems(opts: {
  role?: string | null;
  allowedViews: readonly string[];
  homeView: NavView | string;
  patientsLabel?: string;
}): ClinicNavItem[] {
  const role = String(opts.role || "");
  if (role === "super_admin") {
    return [{ id: "settings", label: "Settings", testId: "app-nav-settings" }];
  }
  const set = new Set(opts.allowedViews);
  const home = String(opts.homeView || "welcome") as NavView;
  const items: ClinicNavItem[] = [
    { id: home, label: "Dashboard", testId: "app-nav-dashboard" },
  ];
  for (const item of FLOW) {
    if (!allowed(set, item.id)) continue;
    if (item.id === home && item.label !== "Payments") continue;
    items.push(item);
  }
  for (const item of MORE) {
    if (!allowed(set, item.id)) continue;
    if (item.id === home) continue;
    if (item.id === "patients") {
      const label = String(opts.patientsLabel || "Patients").trim() || "Patients";
      items.push({ ...item, label });
      continue;
    }
    items.push(item);
  }
  return items;
}

export function navLabelsInOrder(items: readonly ClinicNavItem[]): string[] {
  return items.map((item) => item.label);
}

export function labelWordCount(label: string): number {
  return label.trim().split(/\s+/).filter(Boolean).length;
}

export type WhatsAppPillState = "connected" | "disconnected" | "unknown";

/** Pill copy from a real tenant number status. Never invents "connected". */
export function whatsAppPillFromStatus(status: string | null | undefined): {
  label: string;
  state: WhatsAppPillState;
} {
  const value = String(status || "").trim().toLowerCase();
  if (!value) return { label: "WhatsApp status unavailable", state: "unknown" };
  if (value === "connected") return { label: "WhatsApp connected", state: "connected" };
  return { label: "WhatsApp disconnected", state: "disconnected" };
}

export function greetingClinicName(name?: string | null): string {
  const trimmed = String(name || "").trim();
  return trimmed || "your clinic";
}

export function greetingLine(personName?: string | null): string {
  const name = String(personName || "").trim();
  return name ? `Welcome back, ${name}` : "Welcome back";
}

function inRange(date: string, start: string, end: string): boolean {
  return Boolean(date) && date >= start && date <= end;
}

export function homeMetrics(visits: readonly VisitLite[], now = new Date()) {
  const today = clinicCalendarDate(now);
  const weekStart = shiftIsoDate(today, -6);
  const monthStart = `${today.slice(0, 7)}-01`;
  const fee = (row: VisitLite) => (Number.isFinite(Number(row.consultationFee)) ? Number(row.consultationFee) : 0);
  const paidSum = (rows: readonly VisitLite[]) =>
    rows.reduce((sum, row) => sum + (row.isPaid ? fee(row) : 0), 0);
  const todayRows = visits.filter((row) => row.date === today);
  const weekRows = visits.filter((row) => inRange(String(row.date || ""), weekStart, today));
  const monthRows = visits.filter((row) => inRange(String(row.date || ""), monthStart, today));
  const activeToday = todayRows.filter((row) => row.status !== "Cancelled" && row.status !== "No-Show");
  return {
    today,
    totalAppointments: visits.length,
    todayAppointments: activeToday.length,
    weekAppointments: weekRows.filter((row) => row.status !== "Cancelled" && row.status !== "No-Show").length,
    monthAppointments: monthRows.filter((row) => row.status !== "Cancelled" && row.status !== "No-Show").length,
    totalRevenue: paidSum(visits),
    monthRevenue: paidSum(monthRows),
    todayCollected: paidSum(todayRows),
    todayPending: todayRows.reduce((sum, row) => sum + (row.isPaid ? 0 : fee(row)), 0),
    waiting: todayRows.filter((row) => row.status === "Waiting").length,
    ready: todayRows.filter((row) => row.status === "Triage / Vitals").length,
    withDoctor: todayRows.filter((row) => row.status === "In Consultation").length,
    done: todayRows.filter((row) => row.status === "Completed").length,
    followUps: todayRows.filter((row) => row.type === "Follow-up").length,
    unpaid: todayRows.filter((row) => !row.isPaid && row.status !== "Cancelled" && row.status !== "No-Show").length,
  };
}

export function formatHomeInr(amount: number): string {
  return formatInr(amount);
}

/** One honest nudge. No invented tiers. */
export function homeNudge(metrics: ReturnType<typeof homeMetrics>, patientCount: number): string {
  if (patientCount === 0) return "Register a patient to open the day.";
  if (metrics.todayAppointments === 0) return "No visits booked today.";
  if (metrics.waiting > 0) {
    return `${metrics.waiting} waiting to be marked ready.`;
  }
  if (metrics.ready > 0) return `${metrics.ready} ready for the doctor.`;
  if (metrics.unpaid > 0) return `${metrics.unpaid} visit${metrics.unpaid === 1 ? "" : "s"} still unpaid.`;
  return "Today's queue is clear.";
}

export interface SetupCheck {
  id: string;
  label: string;
  done: boolean;
  detail: string;
}

export function setupChecklist(input: {
  hasLogo: boolean;
  hasHoursAndFees: boolean;
  whatsAppConnected: boolean;
  patientCount: number;
}): SetupCheck[] {
  return [
    {
      id: "logo",
      label: "Logo",
      done: input.hasLogo,
      detail: input.hasLogo ? "Clinic logo is saved." : "No clinic logo is saved yet.",
    },
    {
      id: "fees",
      label: "Hours and fees",
      done: input.hasHoursAndFees,
      detail: input.hasHoursAndFees ? "A consult fee is on the profile." : "Add hours and a consult fee in settings.",
    },
    {
      id: "services",
      label: "Services",
      done: false,
      detail: "A service list is not saved yet.",
    },
    {
      id: "whatsapp",
      label: "WhatsApp number",
      done: input.whatsAppConnected,
      detail: input.whatsAppConnected ? "This clinic's WhatsApp number is connected." : "WhatsApp is not connected for this clinic.",
    },
    {
      id: "booking",
      label: "Booking link",
      done: false,
      detail: "A public booking link is not available yet.",
    },
    {
      id: "patient",
      label: "First patient",
      done: input.patientCount > 0,
      detail: input.patientCount > 0 ? "At least one patient is on file." : "No patient is registered yet.",
    },
  ];
}

export function setupProgress(checks: readonly SetupCheck[]): { done: number; total: number; complete: boolean } {
  const done = checks.filter((item) => item.done).length;
  return { done, total: checks.length, complete: checks.length > 0 && done === checks.length };
}

export function showsSetupChecklist(user?: AppUser | null): boolean {
  if (!user) return false;
  return user.role === "CLINIC_ADMIN" || user.role === "polyclinic_admin" || user.role === "doctor";
}

export function canStartConsultRole(role?: string | null, allowedViews: readonly string[] = []): boolean {
  if (role === "receptionist" || role === "super_admin" || role === "patient") return false;
  return allowedViews.includes("rx") || allowedViews.includes("smart-rx");
}

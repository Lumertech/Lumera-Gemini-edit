import type { AppUser } from "../types";
import type { NavView } from "../components/Navbar";
import { clinicCalendarDate, IST_OFFSET_MINUTES, shiftIsoDate } from "./clinicDay";
import { formatINR } from "./currency";

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
  source?: string;
  createdAt?: string;
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
  { id: "patients", label: "Patients", testId: "app-nav-patients" },
];

const MORE: ClinicNavItem[] = [
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
    if (item.id === "patients") {
      const label = String(opts.patientsLabel || "Patients").trim() || "Patients";
      items.push({ ...item, label });
      continue;
    }
    items.push(item);
  }
  for (const item of MORE) {
    if (!allowed(set, item.id)) continue;
    if (item.id === home) continue;
    items.push(item);
  }
  return items;
}

function patientsCut(items: readonly ClinicNavItem[]): number {
  return items.findIndex((item) => item.testId === "app-nav-patients");
}

/** Daily flow plus Patients. Later items belong under More. */
export function primaryNavItems(items: readonly ClinicNavItem[]): ClinicNavItem[] {
  const cut = patientsCut(items);
  if (cut === -1) return [...items];
  return items.slice(0, cut + 1);
}

export function moreNavItems(items: readonly ClinicNavItem[]): ClinicNavItem[] {
  const cut = patientsCut(items);
  if (cut === -1) return [];
  return items.slice(cut + 1);
}

export function primaryNavLabels(items: readonly ClinicNavItem[]): string[] {
  return navLabelsInOrder(primaryNavItems(items));
}

export function moreNavLabels(items: readonly ClinicNavItem[]): string[] {
  return navLabelsInOrder(moreNavItems(items));
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
  if (!trimmed) return "your clinic";
  if (trimmed !== trimmed.toLowerCase()) return trimmed;
  return trimmed.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/** Wall-clock in India, for check-in stamps. */
export function istClock(now = new Date()): string {
  return now.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

/** Minutes from midnight, or null when the slot is not a clock time. */
export function slotMinutes(slot: string): number | null {
  const match = String(slot || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const meridiem = match[3].toUpperCase();
  if (hour === 12) hour = 0;
  if (meridiem === "PM") hour += 12;
  return hour * 60 + minute;
}

/** Desk hours, 8:00 AM through 9:00 PM. Times outside this are UTC walk-in stamps. */
export function isClinicHoursSlot(slot: string): boolean {
  const minutes = slotMinutes(slot);
  if (minutes == null) return false;
  return minutes >= 8 * 60 && minutes <= 21 * 60;
}

/**
 * Booked slots inside clinic hours stay as the stored appointment time.
 * Empty slots and off-hours stamps (a UTC clock saved as the slot) show the check-in instant in IST.
 */
export function formatVisitTime(input: { timeSlot?: string; source?: string; createdAt?: string }): string {
  const slot = String(input.timeSlot || "").trim();
  const created = String(input.createdAt || "").trim();
  const when = created ? new Date(created) : null;
  const createdOk = Boolean(when && !Number.isNaN(when.getTime()));
  if (slot && isClinicHoursSlot(slot)) return `Appointment ${slot}`;
  if (createdOk && when) return `Checked in ${istClock(when)}`;
  if (slot) return `Appointment ${slot}`;
  return "Time not set";
}

function harnessVisit(row: VisitLite): boolean {
  return /^Flow\b/i.test(String(row.patientName || "").trim());
}

/** Next person the desk should act on: earliest unpaid clinic-hours visit, ignoring harness rows when a real one exists. */
export function pickNextVisit<T extends VisitLite>(rows: readonly T[], today: string): T | null {
  const open = rows.filter(
    (row) => row.date === today && row.status !== "Cancelled" && row.status !== "No-Show"
  );
  const waiting = open.filter((row) => row.status === "Waiting");
  const real = waiting.filter((row) => !harnessVisit(row));
  const pool = real.length ? real : waiting;
  const clinic = pool.filter((row) => isClinicHoursSlot(String(row.timeSlot || "")));
  const ranked = (clinic.length ? clinic : pool).slice().sort((a, b) => {
    if (Boolean(a.isPaid) !== Boolean(b.isPaid)) return a.isPaid ? 1 : -1;
    const am = slotMinutes(String(a.timeSlot || ""));
    const bm = slotMinutes(String(b.timeSlot || ""));
    if (am != null && bm != null && am !== bm) return am - bm;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
  return (
    ranked[0] ||
    open.find((row) => row.status === "Triage / Vitals" && !harnessVisit(row)) ||
    open.find((row) => row.status === "In Consultation" && !harnessVisit(row)) ||
    open.find((row) => row.status === "Triage / Vitals") ||
    open.find((row) => row.status === "In Consultation") ||
    null
  );
}

export function greetingLine(personName?: string | null): string {
  const name = String(personName || "").trim();
  return name ? `Welcome back, ${name}` : "Welcome back";
}

function istParts(now: Date): { hour: number } {
  const shifted = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  return { hour: shifted.getUTCHours() };
}

/** Good morning before noon IST, good afternoon until 5pm, then good evening. */
export function timeOfDayGreeting(now = new Date()): string {
  const { hour } = istParts(now);
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function addressParts(name?: string | null): string[] {
  return String(name || "")
    .replace(/\(.*?\)/g, " ")
    .replace(/,.*$/, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part && !/^dr\.?$/i.test(part));
}

/**
 * Doctors are greeted as Dr. {surname}.
 * Reception and every other role use a first name, with any Dr. prefix removed.
 */
export function greetingAddress(name?: string | null, role?: string | null): string {
  const parts = addressParts(name);
  if (role === "doctor") {
    return `Dr. ${parts[parts.length - 1] || "Doctor"}`;
  }
  return parts[0] || "there";
}

export function homeGreetingLine(name?: string | null, role?: string | null, now = new Date()): string {
  return `${timeOfDayGreeting(now)}, ${greetingAddress(name, role)}`;
}

/** Clinic heading such as Friday, 16 October 2026. Parts stay en-IN so the comma placement does not depend on the browser. */
export function clinicDateHeading(now = new Date()): string {
  const weekday = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long" });
  const day = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric" });
  const month = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", month: "long" });
  const year = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric" });
  return `${weekday}, ${day} ${month} ${year}`;
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
  const active = (row: VisitLite) => row.status !== "Cancelled" && row.status !== "No-Show";
  const activeToday = todayRows.filter(active);
  const waitingOnly = activeToday.filter((row) => row.status === "Waiting").length;
  const ready = activeToday.filter((row) => row.status === "Triage / Vitals").length;
  const withDoctor = activeToday.filter((row) => row.status === "In Consultation").length;
  const done = activeToday.filter((row) => row.status === "Completed").length;
  // Waiting includes patients marked ready: not with the doctor yet.
  const waiting = waitingOnly + ready;
  return {
    today,
    totalAppointments: visits.length,
    todayAppointments: todayVisitCount({ waiting, withDoctor, done }),
    weekAppointments: weekRows.filter(active).length,
    monthAppointments: monthRows.filter(active).length,
    totalRevenue: paidSum(visits),
    monthRevenue: paidSum(monthRows),
    todayCollected: paidSum(todayRows),
    todayPending: todayRows.reduce((sum, row) => sum + (row.isPaid ? 0 : fee(row)), 0),
    waiting,
    ready,
    withDoctor,
    done,
    followUps: todayRows.filter((row) => row.type === "Follow-up").length,
    unpaid: todayRows.filter((row) => !row.isPaid && row.status !== "Cancelled" && row.status !== "No-Show").length,
  };
}

export function formatHomeInr(amount: number): string {
  return formatINR(amount);
}

/** Today's visits: the same three states the day is made of. */
export function todayVisitCount(metrics: { waiting: number; withDoctor: number; done: number }): number {
  return metrics.waiting + metrics.withDoctor + metrics.done;
}

/** Four distinct snapshot numbers. The OPD strip owns today/week/month visit counts. */
export function homeKpiCards(
  metrics: ReturnType<typeof homeMetrics>,
  patientCount: number
): Array<{ label: string; value: string }> {
  return [
    { label: "Waiting", value: String(metrics.waiting) },
    { label: "Done", value: String(metrics.done) },
    { label: "Patients", value: String(patientCount) },
    { label: "Revenue", value: formatHomeInr(metrics.todayCollected) },
  ];
}

/** Visit counts across the three windows. No money and no waiting/done split. */
export function opdTrend(metrics: ReturnType<typeof homeMetrics>): Array<{ label: string; value: string }> {
  return [
    { label: "Today", value: String(todayVisitCount(metrics)) },
    { label: "Week", value: String(metrics.weekAppointments) },
    { label: "Month", value: String(metrics.monthAppointments) },
  ];
}

/** One honest nudge. No invented tiers. */
export function homeNudge(metrics: ReturnType<typeof homeMetrics>, patientCount: number): string {
  if (patientCount === 0) return "Register a patient to open the day.";
  if (metrics.todayAppointments === 0) return "No visits booked today.";
  const notReady = metrics.waiting - metrics.ready;
  if (notReady > 0) {
    return `${notReady} waiting to be marked ready.`;
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

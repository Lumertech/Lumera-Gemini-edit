import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLE_VISIBLE_VIEWS } from "../components/Sidebar.tsx";
import { allowedViewsForWorkflow, clinicianHomeView, workflowForUser } from "./specialtyWorkflow.ts";
import {
  canStartConsultRole,
  clinicNavItems,
  clinicDateHeading,
  greetingAddress,
  greetingClinicName,
  homeGreetingLine,
  timeOfDayGreeting,
  homeKpiCards,
  homeMetrics,
  homeNudge,
  opdTrend,
  labelWordCount,
  moreNavLabels,
  navLabelsInOrder,
  primaryNavLabels,
  formatVisitTime,
  pickNextVisit,
  setupChecklist,
  setupProgress,
  showsSetupChecklist,
  whatsAppPillFromStatus,
} from "./clinicNav.ts";
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
    patientsLabel: pack.patientsLabel,
  });
}

describe("clinic home routing and nav", () => {
  it("sends physio, dental, and GP admins to the pack home", () => {
    const physio = user({
      role: "CLINIC_ADMIN",
      specialty: "physio",
      email: "owner.physio@example.test",
      practiceType: "individual",
    });
    const dental = user({
      role: "CLINIC_ADMIN",
      specialty: "dentist",
      email: "owner.dental@example.test",
      practiceType: "polyclinic",
    });
    const gp = user({
      role: "CLINIC_ADMIN",
      specialty: "gp",
      email: "clinic.admin@lumera.me",
      practiceType: "polyclinic",
    });
    assert.equal(clinicianHomeView(physio), "physio-session");
    assert.equal(clinicianHomeView(dental), "dental-chart");
    assert.equal(clinicianHomeView(gp), workflowForUser(gp).homeView);
    assert.equal(clinicianHomeView(gp), "gp-home");
  });

  it("orders the daily flow and keeps labels to three words", () => {
    const doctor = navLabelsInOrder(navFor("doctor"));
    assert.deepEqual(primaryNavLabels(navFor("doctor")), ["Dashboard", "Appointments", "OPD", "Consult", "Billing", "Payments", "Patients"]);
    assert.deepEqual(moreNavLabels(navFor("doctor")).slice(0, 3), ["Intake", "Pharmacy", "Labs"]);
    const desk = navLabelsInOrder(navFor("receptionist"));
    assert.deepEqual(primaryNavLabels(navFor("receptionist")), ["Dashboard", "Appointments", "OPD", "Billing", "Payments", "Patients"]);
    assert.equal(desk.includes("Consult"), false);
    assert.ok(moreNavLabels(navFor("receptionist")).includes("Intake"));
    for (const label of [...doctor, ...desk]) {
      assert.ok(labelWordCount(label) <= 3, label);
    }
  });

  it("keeps reception off consult and super_admin off clinical nav", () => {
    const desk = navFor("receptionist");
    assert.equal(desk.some((item) => item.id === "rx"), false);
    assert.equal(canStartConsultRole("receptionist", ROLE_VISIBLE_VIEWS.receptionist), false);
    const admin = navFor("super_admin");
    assert.deepEqual(navLabelsInOrder(admin), ["Settings"]);
    assert.equal(admin.some((item) => ["queue", "rx", "appointments", "billing", "patients"].includes(item.id)), false);
    assert.equal(ROLE_VISIBLE_VIEWS.super_admin.includes("rx"), false);
    assert.equal(ROLE_VISIBLE_VIEWS.super_admin.includes("patients"), false);
    assert.equal(ROLE_VISIBLE_VIEWS.receptionist.includes("rx"), false);
  });

  it("reads the WhatsApp pill from tenant status only", () => {
    assert.deepEqual(whatsAppPillFromStatus("connected"), { label: "WhatsApp connected", state: "connected" });
    assert.deepEqual(whatsAppPillFromStatus("disconnected"), { label: "WhatsApp disconnected", state: "disconnected" });
    assert.deepEqual(whatsAppPillFromStatus("pending"), { label: "WhatsApp disconnected", state: "disconnected" });
    assert.equal(whatsAppPillFromStatus(null).state, "unknown");
    assert.equal(whatsAppPillFromStatus("").label.includes("unavailable"), true);
  });

  it("uses the clinic name and real visit counts", () => {
    const morning = new Date("2026-10-16T04:00:00.000Z");
    const noon = new Date("2026-10-16T06:30:00.000Z");
    const evening = new Date("2026-10-16T11:30:00.000Z");
    assert.equal(timeOfDayGreeting(morning), "Good morning");
    assert.equal(timeOfDayGreeting(noon), "Good afternoon");
    assert.equal(timeOfDayGreeting(evening), "Good evening");
    assert.equal(clinicDateHeading(morning), "Friday, 16 October 2026");
    assert.equal(greetingAddress("Dr. Vikram Malhotra", "doctor"), "Dr. Malhotra");
    assert.equal(greetingAddress("Dr. Siddharth Varma (PT)", "doctor"), "Dr. Varma");
    assert.equal(greetingAddress("Ramesh Patel", "receptionist"), "Ramesh");
    assert.equal(greetingAddress("Meera Iyer", "CLINIC_ADMIN"), "Meera");
    assert.equal(greetingAddress("Dr. Meera Iyer", "receptionist"), "Meera");
    assert.equal(homeGreetingLine("Dr. Vikram Malhotra", "doctor", morning), "Good morning, Dr. Malhotra");
    assert.equal(greetingClinicName("Malhotra Individual Practice"), "Malhotra Individual Practice");
    assert.equal(greetingClinicName("physio practice"), "Physio Practice");
    assert.equal(greetingClinicName("  "), "your clinic");
    assert.equal(formatVisitTime({ timeSlot: "10:30 AM", source: "Call Desk" }), "Appointment 10:30 AM");
    assert.equal(formatVisitTime({ timeSlot: "10:30 AM", source: "Walk-in" }), "Appointment 10:30 AM");
    assert.equal(
      formatVisitTime({ timeSlot: "", source: "Walk-in", createdAt: "2026-10-16T06:48:00.000Z" }),
      "Checked in 12:18 pm"
    );
    assert.equal(
      formatVisitTime({ timeSlot: "12:18 AM", source: "Walk-in", createdAt: "2026-10-16T00:18:00.000Z" }),
      "Checked in 5:48 am"
    );
    const next = pickNextVisit(
      [
        { id: "utc", date: "2026-10-16", status: "Waiting", patientName: "Asha Menon", timeSlot: "12:18 AM", isPaid: false },
        { id: "day", date: "2026-10-16", status: "Waiting", patientName: "Ravi Shah", timeSlot: "10:45 AM", isPaid: false },
        { id: "harness", date: "2026-10-16", status: "Waiting", patientName: "Flow 1", timeSlot: "08:00 AM", isPaid: false, consultationFee: 500 },
      ],
      "2026-10-16"
    );
    assert.equal(next?.id, "day");
    const metrics = homeMetrics(
      [
        { id: "a", date: "2026-10-16", status: "Waiting", consultationFee: 600, isPaid: false, type: "New Consultation" },
        { id: "b", date: "2026-10-16", status: "Completed", consultationFee: 500, isPaid: true, type: "Follow-up" },
        { id: "c", date: "2026-10-01", status: "Completed", consultationFee: 1000, isPaid: true },
      ],
      new Date("2026-10-16T08:00:00+05:30")
    );
    assert.equal(metrics.today, "2026-10-16");
    assert.equal(metrics.todayAppointments, 2);
    assert.equal(metrics.waiting, 1);
    assert.equal(metrics.waiting + metrics.withDoctor + metrics.done, metrics.todayAppointments);
    assert.equal(metrics.followUps, 1);
    assert.equal(metrics.totalRevenue, 1500);
    assert.match(homeNudge(metrics, 3), /waiting/);
    assert.equal(homeNudge(metrics, 0), "Register a patient to open the day.");
    const cards = homeKpiCards(metrics, 3);
    const trend = opdTrend(metrics);
    assert.deepEqual(cards.map((card) => card.label), ["Waiting", "Done", "Patients", "Revenue"]);
    assert.deepEqual(trend.map((cell) => cell.label), ["Today", "Week", "Month"]);
    for (const label of [...cards, ...trend].map((item) => item.label)) {
      assert.equal(label.split(/\s+/).length <= 2, true);
      assert.notEqual(label, label.toUpperCase());
    }
    assert.equal(cards.some((card) => card.value === trend[0].value && card.label === "Today"), false);
    assert.equal(trend.some((cell) => cell.value.includes("₹")), false);
  });

  it("tracks setup progress without marking missing steps done", () => {
    const checks = setupChecklist({
      hasLogo: false,
      hasHoursAndFees: true,
      whatsAppConnected: false,
      patientCount: 2,
    });
    assert.equal(checks.find((item) => item.id === "booking")?.done, false);
    assert.equal(checks.find((item) => item.id === "services")?.done, false);
    assert.equal(checks.find((item) => item.id === "whatsapp")?.done, false);
    assert.equal(checks.find((item) => item.id === "patient")?.done, true);
    const progress = setupProgress(checks);
    assert.equal(progress.complete, false);
    assert.equal(progress.done, 2);
    assert.equal(showsSetupChecklist(user({ role: "CLINIC_ADMIN" })), true);
    assert.equal(showsSetupChecklist(user({ role: "receptionist" })), false);
  });
});

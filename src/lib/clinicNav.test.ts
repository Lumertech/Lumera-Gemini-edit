import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLE_VISIBLE_VIEWS } from "../components/Sidebar.tsx";
import { allowedViewsForWorkflow, clinicianHomeView, workflowForUser } from "./specialtyWorkflow.ts";
import {
  canStartConsultRole,
  clinicNavItems,
  greetingClinicName,
  homeMetrics,
  homeNudge,
  labelWordCount,
  navLabelsInOrder,
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
    assert.equal(clinicianHomeView(gp), "welcome");
  });

  it("orders the daily flow and keeps labels to three words", () => {
    const doctor = navLabelsInOrder(navFor("doctor"));
    assert.deepEqual(doctor.slice(0, 6), ["Dashboard", "Appointments", "OPD", "Consult", "Billing", "Payments"]);
    const desk = navLabelsInOrder(navFor("receptionist"));
    assert.deepEqual(desk.slice(0, 5), ["Dashboard", "Appointments", "OPD", "Billing", "Payments"]);
    assert.equal(desk.includes("Consult"), false);
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
    assert.equal(greetingClinicName("Malhotra Individual Practice"), "Malhotra Individual Practice");
    assert.equal(greetingClinicName("  "), "your clinic");
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
    assert.equal(metrics.followUps, 1);
    assert.equal(metrics.totalRevenue, 1500);
    assert.match(homeNudge(metrics, 3), /waiting/);
    assert.equal(homeNudge(metrics, 0), "Register a patient to open the day.");
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

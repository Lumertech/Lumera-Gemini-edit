import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { DEMO_LOGIN_MATRIX, DEMO_PASSWORD } from "../src/lib/demoAccounts.ts";
import { SPECIALTY_HISTORY_CONFIGS } from "../src/components/specialty-rx/SpecialtyHistoryPanel.tsx";
import { RX_PRESETS } from "../src/data/clinicalData.ts";
import { extractSpecialtyTokensFromTranscript } from "../src/lib/pulseClinicalTokens.ts";
import { restoreRxDraft } from "../src/lib/rxDraft.ts";

describe("specialty-wise India history taking and >=5 dummy patients for all demo users", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-demo-specialty-history";
    }
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    await close?.();
  });

  async function login(email: string) {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: DEMO_PASSWORD,
      skipOtp: true,
    });
    assert.equal(res.status, 200, `Login failed for ${email}: ${String(res.json.error || "")}`);
    const token = String(res.json.token || "");
    assert.ok(token, `Missing token for ${email}`);
    return {
      token,
      auth: { Authorization: `Bearer ${token}` },
      user: res.json.user as { id: string; email: string; role: string; tenantId: string },
    };
  }

  it("provides India-grounded structured history configs and presets across specialties", () => {
    const requiredSpecialties = [
      "Gynecology",
      "Pediatrics",
      "General Medicine",
      "Cardiology",
      "Dermatology",
      "Orthopedics",
      "ENT",
      "Ophthalmology",
      "Neurology",
      "Dental Surgery",
      "Physiotherapy & Rehabilitation",
      "Veterinary",
    ];
    for (const spec of requiredSpecialties) {
      const cfg = SPECIALTY_HISTORY_CONFIGS[spec];
      assert.ok(cfg, `Missing SPECIALTY_HISTORY_CONFIGS entry for ${spec}`);
      assert.ok(cfg.complaints.length >= 4, `${spec} should expose >=4 quick complaints`);
      assert.ok(cfg.indiaFlags.length >= 3, `${spec} should expose >=3 India clinical flags`);
    }

    const gynaePresets = RX_PRESETS.filter((p) => p.specialty === "Gynecology");
    assert.ok(gynaePresets.length >= 5, "Gynecology should include >= 5 clinical presets across ANC, PCOS, AUB, Fertility OI, and Postnatal care");
    const vetPresets = RX_PRESETS.filter((p) => p.specialty === "Veterinary");
    assert.ok(vetPresets.length >= 5, "Veterinary should include >= 5 clinical presets across Tick-Fever, Gastroenteritis, Otitis/Dermatology, Spay/Neuter, and WSAVA Wellness");
    assert.ok(RX_PRESETS.some((p) => p.specialty === "Pediatrics"));
    assert.ok(RX_PRESETS.some((p) => p.specialty === "ENT"));
    assert.ok(RX_PRESETS.some((p) => p.specialty === "Neurology"));

    const pcosBundle = extractSpecialtyTokensFromTranscript(
      "Periods delayed every 50 days for 6 months with chin hirsutism and PCOS on scan",
      "Gynecology"
    );
    assert.equal(pcosBundle.icd10, "E28.2");
    assert.equal(pcosBundle.gynecologyAssessment?.clinicalMode, "Fertility & PCOS");

    const entBundle = extractSpecialtyTokensFromTranscript(
      "Right ear discharge for 5 days with central perforation",
      "ENT"
    );
    assert.equal(entBundle.icd10, "H66.1");
    assert.equal(entBundle.entAssessment?.primarySite, "Ear / Otology");

    const restored = restoreRxDraft({
      diagnosis: "GDM in Pregnancy",
      gynecologyAssessment: {
        clinicalMode: "Antenatal / Obstetric",
        lmpDate: "2026-05-15",
        calculatedEdd: "2027-02-19",
        gestationalAgeWeeks: 26,
        gestationalAgeDays: 2,
        trimester: "2nd Trimester",
        gravidaPara: { g: 2, p: 1, l: 1, a: 0 },
        dipsiOgtt2HrMgDl: 156,
        maternalHemoglobinGdl: 10.6,
        pcpndtFormFLogged: true,
      },
      specialtyHistory: {
        specialty: "Gynecology",
        symptomDuration: "Routine follow-up",
        indiaClinicalFlags: ["DIPSI 75g GDM risk / Family Hx T2DM"],
      },
    });
    assert.equal(restored?.gynecologyAssessment?.dipsiOgtt2HrMgDl, 156);
    assert.equal(restored?.gynecologyAssessment?.pcpndtFormFLogged, true);
    assert.equal(restored?.specialtyHistory?.specialty, "Gynecology");
  });

  it("seeds >= 5 dummy patients and rich associated dummy data for every demo user", async () => {
    for (const acct of DEMO_LOGIN_MATRIX) {
      const { auth, user } = await login(acct.email);

      if (acct.role === "super_admin") {
        const tenantsRes = await jsonRequest(port, "GET", "/api/admin/tenants", undefined, auth);
        assert.equal(tenantsRes.status, 200);
        const mainPatients = getDb()
          .prepare("SELECT COUNT(*) AS c FROM patients WHERE tenant_id = 'tenant-lumera-main'")
          .get() as { c: number };
        assert.ok(mainPatients.c >= 5, "Platform demo tenant must hold >= 5 patients");
        continue;
      }

      if (acct.role === "patient") {
        const visits = await jsonRequest(port, "GET", "/api/appointments", undefined, auth);
        const rxs = await jsonRequest(port, "GET", "/api/prescriptions", undefined, auth);
        assert.equal(visits.status, 200);
        assert.equal(rxs.status, 200);
        assert.ok(
          Array.isArray(visits.json.appointments) && visits.json.appointments.length >= 1,
          `Patient ${acct.email} must see own visits`
        );
        assert.ok(
          Array.isArray(rxs.json.prescriptions) && rxs.json.prescriptions.length >= 1,
          `Patient ${acct.email} must see own prescriptions`
        );
        const tenantPatients = getDb()
          .prepare("SELECT COUNT(*) AS c FROM patients WHERE tenant_id = ?")
          .get(user.tenantId) as { c: number };
        assert.ok(tenantPatients.c >= 5, `Patient demo workspace ${user.tenantId} must hold >= 5 patients`);
        continue;
      }

      const patientsRes = await jsonRequest(port, "GET", "/api/patients", undefined, auth);
      assert.equal(patientsRes.status, 200, `/api/patients failed for ${acct.email}`);
      const patients = (patientsRes.json.patients || []) as Array<{ id: string; name: string; dateOfBirth?: string }>;
      assert.ok(
        patients.length >= 5,
        `Expected >= 5 dummy patients for ${acct.email} (${user.tenantId}), got ${patients.length}`
      );

      const appointmentsRes = await jsonRequest(port, "GET", "/api/appointments", undefined, auth);
      assert.equal(appointmentsRes.status, 200, `/api/appointments failed for ${acct.email}`);
      const appointments = (appointmentsRes.json.appointments || []) as Array<{
        id: string;
        doctorId: string;
        patientId: string;
      }>;
      assert.ok(
        appointments.length >= 5,
        `Expected >= 5 dummy appointments for ${acct.email} (${user.tenantId}), got ${appointments.length}`
      );

      // Every polyclinic specialist doctor must also have >=5 own-doctor patients, visits, and prescriptions
      if (acct.doctorId && user.tenantId === "tenant-demo-polyclinic") {
        const ownVisits = appointments.filter((a) => a.doctorId === acct.doctorId);
        assert.ok(
          ownVisits.length >= 5,
          `Specialist ${acct.email} (${acct.doctorId}) expected >= 5 own appointments, got ${ownVisits.length}`
        );
        const rxRes = await jsonRequest(port, "GET", "/api/prescriptions", undefined, auth);
        assert.equal(rxRes.status, 200);
        const rxs = (rxRes.json.prescriptions || []) as Array<{
          doctorId: string;
          gynecologyAssessment?: Record<string, unknown>;
        }>;
        const ownRxs = rxs.filter((r) => r.doctorId === acct.doctorId);
        assert.ok(
          ownRxs.length >= 5,
          `Specialist ${acct.email} (${acct.doctorId}) expected >= 5 signed prescriptions, got ${ownRxs.length}`
        );
      }
    }
  });

  it("populates full Gynaecology 7-patient multi-mode workspace, labs, invoices, WhatsApp threads, and Pediatric IAP charts", async () => {
    const gynae = await login("gynecology@lumera.me");

    // 1. >= 7 Ob/Gyn patients & today's active OPD appointments across Waiting, Confirmed, Completed
    const gynaeAptsRes = await jsonRequest(port, "GET", "/api/appointments", undefined, gynae.auth);
    assert.equal(gynaeAptsRes.status, 200);
    const gynaeApts = ((gynaeAptsRes.json.appointments || []) as Array<{
      id: string;
      doctorId: string;
      patientId: string;
      date: string;
      status: string;
    }>).filter((a) => a.doctorId === "doc-persona-gynae");
    const uniqueGynaePatients = new Set(gynaeApts.map((a) => a.patientId));
    assert.ok(uniqueGynaePatients.size >= 7, `Expected >= 7 Ob/Gyn patients for doc-persona-gynae, got ${uniqueGynaePatients.size}`);

    const todayAptsRes = await jsonRequest(port, "GET", "/api/appointments?date=today", undefined, gynae.auth);
    assert.equal(todayAptsRes.status, 200);
    const todayGynaeApts = ((todayAptsRes.json.appointments || []) as Array<{
      doctorId: string;
      status: string;
    }>).filter((a) => a.doctorId === "doc-persona-gynae");
    assert.ok(todayGynaeApts.length >= 5, `Expected >= 5 today Ob/Gyn OPD appointments, got ${todayGynaeApts.length}`);
    const statuses = new Set(todayGynaeApts.map((a) => a.status));
    assert.ok(statuses.has("Waiting"), "Expected Waiting visit in today's Ob/Gyn queue");
    assert.ok(statuses.has("Confirmed"), "Expected Confirmed visit in today's Ob/Gyn queue");
    assert.ok(statuses.has("Completed"), "Expected Completed visit in today's Ob/Gyn queue");

    // 2. Multi-mode prescriptions across all 4 Gynaecology clinical modes
    const gynaeRxsRes = await jsonRequest(port, "GET", "/api/prescriptions", undefined, gynae.auth);
    assert.equal(gynaeRxsRes.status, 200);
    const gynaeRxs = ((gynaeRxsRes.json.prescriptions || []) as Array<{
      doctorId: string;
      gynecologyAssessment?: {
        clinicalMode?: string;
        dipsiOgtt2HrMgDl?: number;
        pcpndtFormFLogged?: boolean;
        fertilityCycleDay?: number;
        aubPalmCoeinClass?: string;
        nstBppStatus?: string;
        postpartumDays?: number;
      };
    }>).filter((rx) => rx.doctorId === "doc-persona-gynae");
    assert.ok(gynaeRxs.length >= 7, `Expected >= 7 signed Ob/Gyn prescriptions, got ${gynaeRxs.length}`);
    const modes = new Set(gynaeRxs.map((rx) => rx.gynecologyAssessment?.clinicalMode));
    assert.ok(modes.has("Antenatal / Obstetric"));
    assert.ok(modes.has("Fertility & PCOS"));
    assert.ok(modes.has("Gynaecology & Menstrual"));
    assert.ok(modes.has("Postnatal / Menopause"));
    assert.ok(gynaeRxs.some((rx) => rx.gynecologyAssessment?.fertilityCycleDay === 12));
    assert.ok(gynaeRxs.some((rx) => rx.gynecologyAssessment?.aubPalmCoeinClass === "AUB-L (Leiomyoma / Fibroid)"));
    assert.ok(gynaeRxs.some((rx) => rx.gynecologyAssessment?.nstBppStatus === "Reactive NST"));
    assert.ok(gynaeRxs.some((rx) => rx.gynecologyAssessment?.postpartumDays === 10));

    const nishaChart = await jsonRequest(port, "GET", "/api/patients/poly-pat-nisha/chart", undefined, gynae.auth);
    assert.equal(nishaChart.status, 200);
    const nishaRxs = (nishaChart.json.prescriptions || []) as Array<{
      gynecologyAssessment?: { dipsiOgtt2HrMgDl?: number; pcpndtFormFLogged?: boolean };
    }>;
    assert.ok(nishaRxs.some((rx) => rx.gynecologyAssessment?.dipsiOgtt2HrMgDl === 156));
    assert.ok(nishaRxs.some((rx) => rx.gynecologyAssessment?.pcpndtFormFLogged === true));

    // 3. >= 5 verified Ob/Gyn Lab Reports
    const labsRes = await jsonRequest(port, "GET", "/api/lab-reports", undefined, gynae.auth);
    assert.equal(labsRes.status, 200);
    const gynaeLabs = ((labsRes.json.labReports || []) as Array<{
      id: string;
      patientId: string;
      category: string;
    }>).filter((l) => uniqueGynaePatients.has(l.patientId));
    assert.ok(gynaeLabs.length >= 5, `Expected >= 5 Ob/Gyn lab reports, got ${gynaeLabs.length}`);

    // 4. >= 5 Ob/Gyn Invoices & active today revenue
    const invRes = await jsonRequest(port, "GET", "/api/invoices", undefined, gynae.auth);
    assert.equal(invRes.status, 200);
    const gynaeInvoices = ((invRes.json.invoices || []) as Array<{
      id: string;
      consultingDoctorId?: string;
      totalAmount?: number;
    }>).filter((inv) => inv.consultingDoctorId === "doc-persona-gynae");
    assert.ok(gynaeInvoices.length >= 5, `Expected >= 5 Ob/Gyn invoices, got ${gynaeInvoices.length}`);

    const revRes = await jsonRequest(port, "GET", "/api/billing/revenue", undefined, gynae.auth);
    assert.equal(revRes.status, 200);
    assert.ok(Number(revRes.json.today) > 0, `Expected positive today collected revenue, got ${String(revRes.json.today)}`);

    // 5. >= 4 Ob/Gyn WhatsApp conversations
    const waRes = await jsonRequest(port, "GET", "/api/whatsapp/conversations", undefined, gynae.auth);
    assert.equal(waRes.status, 200);
    const gynaeWa = ((waRes.json.conversations || []) as Array<{
      id: string;
      patientId?: string;
      assignedStaff?: string;
    }>).filter((c) => (c.patientId && uniqueGynaePatients.has(c.patientId)) || c.assignedStaff === "Dr. Shalini Mukhopadhyay");
    assert.ok(gynaeWa.length >= 4, `Expected >= 4 Ob/Gyn WhatsApp threads, got ${gynaeWa.length}`);

    const pedia = await login("pediatrics@lumera.me");
    const immChart = await jsonRequest(
      port,
      "GET",
      "/api/patients/pedia-pat-aadhya/immunization-chart",
      undefined,
      pedia.auth
    );
    assert.equal(immChart.status, 200);
    const chartPayload = (immChart.json.chart || {}) as { doses?: Array<{ code: string; status: string }> };
    const doses = chartPayload.doses || [];
    assert.ok(doses.some((d) => d.code === "bcg" && d.status === "given"));
    assert.ok(doses.some((d) => d.status === "due" || d.status === "upcoming"));
  });

  it("populates full Veterinarian (veterinary@lumera.me) 8-patient multi-pet household workspace, 4-mode Rx, WSAVA doses, labs, invoices, and multilingual WhatsApp", async () => {
    const vet = await login("veterinary@lumera.me");
    assert.equal(vet.user.tenantId, "tenant-demo-veterinary");

    // 1. >= 8 Pet Patients across shared multi-pet mobiles (>= 3 pets on Rahul Verma's +91 98201 44550)
    const patRes = await jsonRequest(port, "GET", "/api/patients", undefined, vet.auth);
    assert.equal(patRes.status, 200);
    const vetPatients = (patRes.json.patients || []) as Array<{
      id: string;
      name: string;
      phone: string;
      species?: string;
      breed?: string;
      relationshipToHolder?: string;
      primaryContactName?: string;
    }>;
    assert.ok(vetPatients.length >= 8, `Expected >= 8 pet patients for veterinary@lumera.me, got ${vetPatients.length}`);
    assert.ok(vetPatients.every((p) => p.relationshipToHolder === "Pet"));

    const byPhoneRes = await jsonRequest(
      port,
      "GET",
      `/api/patients/by-phone?phone=${encodeURIComponent("+91 98201 44550")}`,
      undefined,
      vet.auth
    );
    assert.equal(byPhoneRes.status, 200);
    assert.equal(byPhoneRes.json.sharedMobile, true);
    const rahulPets = (byPhoneRes.json.patients || []) as Array<{ name: string }>;
    assert.ok(rahulPets.length >= 3, `Expected >= 3 pets on Rahul Verma's mobile, got ${rahulPets.length}`);
    const rahulPetNames = new Set(rahulPets.map((p) => p.name));
    assert.ok(rahulPetNames.has("Bruno") && rahulPetNames.has("Mochi") && rahulPetNames.has("Coco"));

    // Owner name search returns all pets of Rahul Verma
    const ownerSearch = await jsonRequest(
      port,
      "GET",
      `/api/patients?q=${encodeURIComponent("Rahul Verma")}`,
      undefined,
      vet.auth
    );
    assert.equal(ownerSearch.status, 200);
    assert.ok(((ownerSearch.json.patients || []) as unknown[]).length >= 3);

    // 2. >= 6 Today OPD Visits across Waiting, Confirmed, Completed (including Bruno & Mochi)
    const todayRes = await jsonRequest(port, "GET", "/api/appointments?date=today", undefined, vet.auth);
    assert.equal(todayRes.status, 200);
    const todayVisits = ((todayRes.json.appointments || []) as Array<{
      id: string;
      doctorId: string;
      patientId: string;
      status: string;
    }>).filter((a) => a.doctorId === "doc-persona-vet");
    assert.ok(todayVisits.length >= 6, `Expected >= 6 today OPD visits for doc-persona-vet, got ${todayVisits.length}`);
    const todayStatuses = new Set(todayVisits.map((a) => a.status));
    assert.ok(todayStatuses.has("Waiting"), "Expected Waiting visit in today's Vet queue");
    assert.ok(todayStatuses.has("Confirmed"), "Expected Confirmed visit in today's Vet queue");
    assert.ok(todayStatuses.has("Completed"), "Expected Completed visit in today's Vet queue");

    // 3. >= 7 Signed Multi-Mode Veterinary Prescriptions across all 4 clinical modes + draft restore
    const rxRes = await jsonRequest(port, "GET", "/api/prescriptions", undefined, vet.auth);
    assert.equal(rxRes.status, 200);
    const vetRxs = ((rxRes.json.prescriptions || []) as Array<{
      doctorId: string;
      veterinaryAssessment?: {
        clinicalMode?: string;
        vectorSnap4DxStatus?: string;
        plateletCountLakhs?: number;
        biteQuarantineStatus?: string;
      };
    }>).filter((rx) => rx.doctorId === "doc-persona-vet");
    assert.ok(vetRxs.length >= 7, `Expected >= 7 signed Veterinary prescriptions, got ${vetRxs.length}`);
    const vetModes = new Set(vetRxs.map((rx) => rx.veterinaryAssessment?.clinicalMode));
    assert.ok(vetModes.has("Preventive & Vaccination"));
    assert.ok(vetModes.has("Tick-Fever & Internal Med"));
    assert.ok(vetModes.has("Dermatology, Ear & Dental"));
    assert.ok(vetModes.has("Surgery, Spay/Neuter & Bite"));

    const restoredVet = restoreRxDraft({
      diagnosis: "Canine Ehrlichiosis",
      veterinaryAssessment: {
        clinicalMode: "Tick-Fever & Internal Med",
        species: "Dog",
        breed: "Golden Retriever",
        bodyWeightKg: 31.4,
        vectorSnap4DxStatus: "Ehrlichia +",
        plateletCountLakhs: 0.68,
      },
    });
    assert.equal(restoredVet?.veterinaryAssessment?.vectorSnap4DxStatus, "Ehrlichia +");
    assert.equal(restoredVet?.veterinaryAssessment?.bodyWeightKg, 31.4);

    // 4. Live WSAVA Canine Puppy Immunization Chart on 14-week Shih Tzu Pixel
    const pixelImm = await jsonRequest(
      port,
      "GET",
      "/api/patients/vet-pat-pixel/immunization-chart?audience=veterinary",
      undefined,
      vet.auth
    );
    assert.equal(pixelImm.status, 200);
    const pixelChart = (pixelImm.json.chart || {}) as {
      schedule?: { id?: string };
      doses?: Array<{ code: string; status: string }>;
    };
    assert.equal(pixelChart.schedule?.id, "canine");
    assert.ok((pixelChart.doses || []).some((d) => d.code === "dhppil-1" && d.status === "given"));
    assert.ok((pixelChart.doses || []).some((d) => d.status === "due" || d.status === "overdue" || d.status === "upcoming"));

    // 5. >= 5 Verified Veterinary Lab Reports
    const labsRes = await jsonRequest(port, "GET", "/api/lab-reports", undefined, vet.auth);
    assert.equal(labsRes.status, 200);
    const vetLabs = (labsRes.json.labReports || []) as Array<{ id: string; category: string }>;
    assert.ok(vetLabs.length >= 5, `Expected >= 5 Veterinary lab reports, got ${vetLabs.length}`);

    // 6. >= 5 Veterinary Invoices & positive today revenue
    const invRes = await jsonRequest(port, "GET", "/api/invoices", undefined, vet.auth);
    assert.equal(invRes.status, 200);
    const vetInvoices = ((invRes.json.invoices || []) as Array<{
      id: string;
      consultingDoctorId?: string;
    }>).filter((inv) => inv.consultingDoctorId === "doc-persona-vet");
    assert.ok(vetInvoices.length >= 5, `Expected >= 5 Veterinary invoices, got ${vetInvoices.length}`);

    const revRes = await jsonRequest(port, "GET", "/api/billing/revenue", undefined, vet.auth);
    assert.equal(revRes.status, 200);
    assert.ok(Number(revRes.json.today) > 0, `Expected positive today Vet revenue, got ${String(revRes.json.today)}`);

    // 7. >= 4 Multilingual WhatsApp Conversations
    const waRes = await jsonRequest(port, "GET", "/api/whatsapp/conversations", undefined, vet.auth);
    assert.equal(waRes.status, 200);
    const vetConvs = (waRes.json.conversations || []) as Array<{ id: string; preferredLanguage?: string }>;
    assert.ok(vetConvs.length >= 4, `Expected >= 4 Veterinary WhatsApp threads, got ${vetConvs.length}`);
  });
});


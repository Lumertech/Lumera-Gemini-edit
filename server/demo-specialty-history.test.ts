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
    assert.ok(gynaePresets.length >= 3, "Gynecology should include ANC, PCOS, and AUB presets");
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

  it("populates full Gynaecology ANC/PCOS/AUB charts and Pediatric IAP immunization charts", async () => {
    const gynae = await login("gynecology@lumera.me");
    const nishaChart = await jsonRequest(port, "GET", "/api/patients/poly-pat-nisha/chart", undefined, gynae.auth);
    assert.equal(nishaChart.status, 200);
    const nishaRxs = (nishaChart.json.prescriptions || []) as Array<{
      gynecologyAssessment?: { dipsiOgtt2HrMgDl?: number; pcpndtFormFLogged?: boolean };
    }>;
    assert.ok(nishaRxs.some((rx) => rx.gynecologyAssessment?.dipsiOgtt2HrMgDl === 156));
    assert.ok(nishaRxs.some((rx) => rx.gynecologyAssessment?.pcpndtFormFLogged === true));

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
});


import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { createAbdmRouter } from "./abdm.ts";
import { DEMO_TENANT_ID, getDb, initDatabase } from "./db.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

/**
 * Production mounts this router at /api/abdm and /api/v3 (and /v3).
 * The sample handler must require a staff session and must not echo a real chart.
 */
const SAMPLE_PATHS = ["/api/abdm/fhir/sample/op-consult", "/api/v3/fhir/sample/op-consult"];

const PATIENT_IDENTITY_KEYS = [
  "id",
  "uhid",
  "name",
  "phone",
  "email",
  "address",
  "emergency_contact",
  "abha_number",
  "abha_address",
] as const;

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function identityValues(row: Record<string, unknown> | undefined): string[] {
  if (!row) return [];
  const values: string[] = [];
  for (const key of PATIENT_IDENTITY_KEYS) {
    const value = String(row[key] ?? "").trim();
    if (value.length >= 4) values.push(value);
  }
  return values;
}

function assertAbsent(body: string, values: string[]) {
  for (const value of values) {
    assert.equal(body.includes(value), false, `response leaked ${value}`);
  }
}

describe("ABDM FHIR sample AuthZ", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  let seededPatientId = "";

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-fhir-sample-authz";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const server = await startTestServer((app) => {
      app.use("/api/v3", createAbdmRouter());
      app.use("/api", createApiRouter());
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    try {
      if (seededPatientId) getDb().prepare("DELETE FROM patients WHERE id = ?").run(seededPatientId);
    } catch {
      /* init never ran */
    }
    await close?.();
  });

  async function login(email: string): Promise<string> {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || `${email} login failed`));
    const token = String(res.json.token || "");
    assert.ok(token);
    return token;
  }

  function seedRealPatient(): Record<string, unknown> {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const digits = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
    seededPatientId = `pat-fhir-leak-${suffix}`;
    const row = {
      id: seededPatientId,
      tenant_id: DEMO_TENANT_ID,
      uhid: `PHI-LEAK-${suffix}`,
      name: `Zelda PhiLeak ${suffix}`,
      phone: `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`,
      email: `zelda.${suffix}@phi-leak.example`,
      address: `99 PhiLeak Lane ${suffix}`,
      emergency_contact: `PhiLeak Contact ${suffix}`,
      abha_number: `91-${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8).padEnd(4, "0")}`,
      abha_address: `zelda.phileak.${suffix}@abdm`,
    };
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO patients (
           id, tenant_id, uhid, name, age, gender, phone, email, blood_group,
           allergies, chronic_conditions, emergency_contact, address, last_visit, created_at,
           abha_number, abha_address, kyc_status
         ) VALUES (?, ?, ?, ?, 41, 'Female', ?, ?, 'B+', '[]', '[]', ?, ?, NULL, ?, ?, ?, 'LINKED_SANDBOX')`
      )
      .run(
        row.id,
        row.tenant_id,
        row.uhid,
        row.name,
        row.phone,
        row.email,
        row.emergency_contact,
        row.address,
        now,
        row.abha_number,
        row.abha_address
      );
    return row;
  }

  it("anonymous callers are 401 on both FHIR sample mounts", async () => {
    for (const path of SAMPLE_PATHS) {
      const res = await jsonRequest(port, "GET", path);
      assert.equal(res.status, 401, path);
      assert.equal(res.json.error, "Authentication required");
    }
  });

  it("patients are 403", async () => {
    const token = await login("patient@lumera.me");
    const res = await jsonRequest(port, "GET", SAMPLE_PATHS[0], undefined, auth(token));
    assert.equal(res.status, 403);
    assert.equal(res.json.error, "Insufficient permissions");
  });

  it("staff receive a synthetic bundle with no field from a real patient row", async () => {
    const seeded = seedRealPatient();
    const leakedPatient = getDb().prepare("SELECT * FROM patients LIMIT 1").get() as Record<string, unknown>;
    const leakedDoctor = getDb().prepare("SELECT * FROM doctors LIMIT 1").get() as
      | Record<string, unknown>
      | undefined;
    const forbidden = [
      ...identityValues(seeded),
      ...identityValues(leakedPatient),
      ...["id", "name", "phone", "email", "reg_number", "hpr_id", "qualification"].flatMap((key) => {
        const value = String(leakedDoctor?.[key] ?? "").trim();
        return value.length >= 4 ? [value] : [];
      }),
    ];
    assert.ok(forbidden.length > 0, "expected a real patient row to compare against");

    const token = await login("doctor@lumera.me");
    for (const path of SAMPLE_PATHS) {
      const res = await jsonRequest(port, "GET", path, undefined, auth(token));
      assert.equal(res.status, 200, path);
      const body = JSON.stringify(res.json);
      assert.match(body, /"resourceType":"Bundle"/);
      assert.match(body, /Fictional Sample Patient/);
      assert.match(body, /0000000000/);
      assert.match(body, /00-0000-0000-0000/);
      assert.match(body, /sample\.patient@abdm/);
      assertAbsent(body, forbidden);
    }
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { getAbdmBridgeStatus } from "./abdm-mode.ts";
import { hashPassword } from "./password.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

async function jsonRequest(
  port: number,
  method: string,
  urlPath: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function createClinicUser(label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const email = `${label}.${suffix}@abha-test.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, ?, ?, ?)`
  ).run(tenantId, `Clinic ${label}`, now, `HFR-${suffix}`, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(
    userId,
    tenantId,
    email,
    hashPassword("Lumera@2026"),
    `Dr ${label}`,
    `+91 90000 ${label.slice(0, 5).padEnd(5, "0")}`,
    `Clinic ${label}`,
    now,
    now
  );
  return { tenantId, userId, email, hfrId: `HFR-${suffix}` };
}

function uniquePhone(tag: string): string {
  const n = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  return `+91 98${n.slice(0, 3)} ${n.slice(3)}`;
}

function uniqueAbha(tag: string): string {
  const n = `${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 9000 + 1000)}`.slice(0, 12);
  return `91-${n.slice(0, 4)}-${n.slice(4, 8)}-${n.slice(8, 12)}`;
}

describe("#35 dual onboard — same patientId + frozen link-abha", () => {
  let port = 0;
  let server: Server | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-patient-abha";
    }
    process.env.ABDM_MODE = process.env.ABDM_MODE || "stub";
    try {
      getDb();
    } catch {
      initDatabase();
    }

    const app = express();
    app.use(express.json());
    app.use(attachUser);
    app.use("/api", createApiRouter());

    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("server did not bind a port");
    port = addr.port;
  });

  after(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
  });

  async function login(email: string): Promise<string> {
    const loginRes = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(loginRes.status, 200, String(loginRes.json.error || "login failed"));
    return String(loginRes.json.token || "");
  }

  it("(a) simple create P1 then link-abha → still P1 + consent + LINKED_SANDBOX", async () => {
    const clinic = createClinicUser("simpleFirst");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const phone = uniquePhone("a");
    const abhaNumber = uniqueAbha("a");

    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "P1 Simple", phone, age: 34, gender: "Female" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const p1 = created.json.patient as { id: string; kycStatus?: string; consentArtefacts?: unknown[] };
    assert.ok(p1.id);
    assert.equal(p1.kycStatus, "PENDING");

    const linked = await jsonRequest(
      port,
      "POST",
      "/api/patients/link-abha",
      {
        patientId: p1.id,
        phone,
        abhaNumber,
        abhaAddress: "p1.simple@sbx",
        demographics: { name: "P1 Simple", gender: "Female", dob: "1992-03-04", address: "Pune", pincode: "411001" },
        consentArtefact: {
          consentId: `consent-a-${p1.id}`,
          status: "GRANTED",
          hiTypes: ["Prescription", "OPConsultation"],
          dateRange: { from: "2026-01-01", to: "2026-12-31" },
          purpose: "OPD continuity",
          requesterName: "Clinic HIU",
          grantedAt: "2026-09-10T10:00:00Z",
        },
        source: "aadhaar_otp",
        abdmMode: "stub",
      },
      auth
    );
    assert.equal(linked.status, 200, String(linked.json.error || ""));
    const patient = linked.json.patient as {
      id: string;
      abhaNumber: string;
      kycStatus: string;
      abhaLinkedAt: string;
      consentArtefacts: Array<{ consentId: string }>;
    };
    assert.equal(patient.id, p1.id);
    assert.equal(patient.abhaNumber, abhaNumber);
    assert.equal(patient.kycStatus, "LINKED_SANDBOX");
    assert.ok(patient.abhaLinkedAt);
    assert.equal(linked.json.abdmMode, "stub");
    assert.ok(patient.consentArtefacts.some((c) => c.consentId === `consent-a-${p1.id}`));

    const list = await jsonRequest(port, "GET", "/api/patients", undefined, auth);
    const ids = ((list.json.patients as Array<{ id: string }>) || []).map((p) => p.id);
    assert.equal(ids.filter((id) => id === p1.id).length, 1);
    assert.equal(ids.length, 1);

    const audits = getDb()
      .prepare("SELECT action FROM audit_logs WHERE details LIKE ?")
      .all(`%${p1.id}%`) as Array<{ action: string }>;
    assert.ok(audits.some((a) => /ABHA linked/i.test(a.action)));
    assert.ok(audits.some((a) => /consent stored/i.test(a.action)));
  });

  it("(b) ABHA-first create then simple same phone → same id; simple path mints no consent", async () => {
    const clinic = createClinicUser("abhaFirst");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const phone = uniquePhone("b");
    const abhaNumber = uniqueAbha("b");

    const abdmFirst = await jsonRequest(
      port,
      "POST",
      "/api/patients/link-abha",
      {
        phone,
        abhaNumber,
        abhaAddress: "p2.abha@sbx",
        demographics: { name: "P2 Abha", gender: "Male", dob: "1988-01-15", address: "Delhi", pincode: "110001" },
        source: "abha_search",
        abdmMode: "stub",
      },
      auth
    );
    assert.equal(abdmFirst.status, 200, String(abdmFirst.json.error || ""));
    const p2 = abdmFirst.json.patient as { id: string; kycStatus: string; consentArtefacts: unknown[] };
    assert.ok(p2.id);
    assert.equal(p2.kycStatus, "LINKED_SANDBOX");
    assert.deepEqual(p2.consentArtefacts, []);

    const simple = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "P2 Clinic Edit", phone, age: 38, gender: "Male", address: "Delhi South" },
      auth
    );
    assert.ok([200, 201].includes(simple.status), String(simple.json.error || ""));
    const again = simple.json.patient as { id: string; name: string; kycStatus: string };
    assert.equal(again.id, p2.id);
    assert.equal(again.kycStatus, "LINKED_SANDBOX");

    const detail = await jsonRequest(port, "GET", `/api/patients/${p2.id}`, undefined, auth);
    const detailed = detail.json.patient as { consentArtefacts: unknown[]; kycStatus: string };
    assert.deepEqual(detailed.consentArtefacts, []);
    assert.equal(detailed.kycStatus, "LINKED_SANDBOX");
  });

  it("(c) cross-tenant cannot read or link", async () => {
    const clinicA = createClinicUser("isoA");
    const clinicB = createClinicUser("isoB");
    const tokenA = await login(clinicA.email);
    const tokenB = await login(clinicB.email);
    const authA = { Authorization: `Bearer ${tokenA}` };
    const authB = { Authorization: `Bearer ${tokenB}` };
    const phone = uniquePhone("c");
    const abhaNumber = uniqueAbha("c");

    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Tenant A Only", phone, age: 40, gender: "Female" },
      authA
    );
    const p1 = created.json.patient as { id: string };

    await jsonRequest(
      port,
      "POST",
      "/api/patients/link-abha",
      {
        patientId: p1.id,
        phone,
        abhaNumber,
        source: "qr",
        abdmMode: "stub",
      },
      authA
    );

    const stolenRead = await jsonRequest(port, "GET", `/api/patients/${p1.id}`, undefined, authB);
    assert.ok([403, 404].includes(stolenRead.status));

    const stolenLink = await jsonRequest(
      port,
      "POST",
      "/api/patients/link-abha",
      {
        patientId: p1.id,
        abhaNumber,
        source: "aadhaar_otp",
        abdmMode: "stub",
      },
      authB
    );
    assert.equal(stolenLink.status, 403);

    const stolenByAbha = await jsonRequest(
      port,
      "POST",
      "/api/patients/link-abha",
      {
        abhaNumber,
        source: "abha_search",
        abdmMode: "stub",
      },
      authB
    );
    assert.ok([403, 404].includes(stolenByAbha.status));
    assert.equal(stolenByAbha.json.patient, undefined);
  });

  it("(d) duplicate ABHA under tenant returns same id; unlocked kycStatus is rejected", async () => {
    const clinic = createClinicUser("dupAbha");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const phone = uniquePhone("d");
    const abhaNumber = uniqueAbha("d");

    const first = await jsonRequest(
      port,
      "POST",
      "/api/patients/link-abha",
      {
        phone,
        abhaNumber,
        abhaAddress: "dup@sbx",
        demographics: { name: "Dup One", gender: "Other", dob: "1990-06-01", address: "Goa", pincode: "403001" },
        source: "aadhaar_otp",
        abdmMode: "stub",
      },
      auth
    );
    const p = first.json.patient as { id: string };
    assert.ok(p.id);

    const again = await jsonRequest(
      port,
      "POST",
      "/api/patients/link-abha",
      {
        abhaNumber,
        source: "aadhaar_otp",
        abdmMode: "stub",
      },
      auth
    );
    assert.equal(again.status, 200, String(again.json.error || ""));
    assert.equal((again.json.patient as { id: string }).id, p.id);

    const rejected = await jsonRequest(
      port,
      "POST",
      "/api/patients/link-abha",
      {
        patientId: p.id,
        abhaNumber,
        kycStatus: "VERIFIED",
        source: "aadhaar_otp",
        abdmMode: "stub",
      },
      auth
    );
    assert.equal(rejected.status, 400);
    assert.match(String(rejected.json.error || ""), /NHA sandbox/);
    assert.match(String(rejected.json.error || ""), /LINKED_SANDBOX/);

    for (const unlocked of ["Government", "Unlocked"]) {
      const again = await jsonRequest(
        port,
        "POST",
        "/api/patients/link-abha",
        {
          patientId: p.id,
          abhaNumber,
          kycStatus: unlocked,
          source: "aadhaar_otp",
          abdmMode: "stub",
        },
        auth
      );
      assert.equal(again.status, 400, unlocked);
      assert.match(String(again.json.error || ""), /NHA sandbox/);
    }
  });

  it("GET /api/abdm/status is { abdmMode, bridgeReady } only", async () => {
    const status = await jsonRequest(port, "GET", "/api/abdm/status");
    assert.equal(status.status, 200);
    assert.deepEqual(Object.keys(status.json).sort(), ["abdmMode", "bridgeReady"]);
    assert.equal(status.json.abdmMode, "stub");
    assert.equal(status.json.bridgeReady, true);
    assert.equal(status.json.sandboxAuditStatus, undefined);
    assert.equal(status.json.abdmGateway, undefined);
  });

  it("HIP + HIU freeze paths persist artefacts on the same patientId and 403 cross-tenant", async () => {
    const clinic = createClinicUser("hiu");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const phone = uniquePhone("h");
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "HIU Patient", phone, age: 29, gender: "Male" },
      auth
    );
    const patient = created.json.patient as { id: string; uhid: string };
    const patientId = patient.id;
    const linked = await jsonRequest(
      port,
      "POST",
      "/api/patients/link-abha",
      {
        patientId,
        phone,
        abhaNumber: uniqueAbha("h"),
        abhaAddress: "hiu.patient@sbx",
        source: "aadhaar_otp",
        abdmMode: "stub",
      },
      auth
    );
    assert.equal(linked.status, 200, String(linked.json.error || ""));
    const abhaNumber = (linked.json.patient as { abhaNumber: string }).abhaNumber;
    const consentId = `hiu-${patientId}`;

    const ctx = await jsonRequest(
      port,
      "POST",
      "/api/abdm/hip/link/care-context",
      { patientId, encounterId: "enc-1", hiTypes: ["Prescription"], display: "OPD" },
      auth
    );
    assert.equal(ctx.status, 200, String(ctx.json.error || ""));
    assert.equal(ctx.json.careContextReference, `CARE-CTX-${patient.uhid}-enc-1`);
    assert.equal(ctx.json.abdmMode, "stub");

    const discover = await jsonRequest(
      port,
      "POST",
      "/api/abdm/hip/patient-discover",
      { abhaNumber },
      auth
    );
    assert.equal(discover.status, 200, String(discover.json.error || ""));
    assert.equal(discover.json.abdmMode, "stub");
    assert.equal((discover.json.patient as { patientId: string }).patientId, patientId);
    const careContexts = discover.json.careContexts as Array<{ careContextReference: string }>;
    assert.ok(careContexts.some((row) => row.careContextReference === `CARE-CTX-${patient.uhid}-enc-1`));

    const confirm = await jsonRequest(
      port,
      "POST",
      "/api/abdm/hip/link/on-confirm",
      { patientId, careContextReference: ctx.json.careContextReference },
      auth
    );
    assert.equal(confirm.status, 202, String(confirm.json.error || ""));
    assert.equal(confirm.json.abdmMode, "stub");

    const init = await jsonRequest(
      port,
      "POST",
      "/api/abdm/hiu/consent-request/init",
      {
        patientId,
        abhaAddress: "hiu.patient@sbx",
        hiTypes: ["Prescription"],
        dateRange: { from: "2026-01-01", to: "2026-12-31" },
        purpose: "HIU init stub",
      },
      auth
    );
    assert.equal(init.status, 200, String(init.json.error || ""));
    assert.ok(init.json.consentRequestId);
    assert.equal(init.json.abdmMode, "stub");

    const notify = await jsonRequest(
      port,
      "POST",
      "/api/abdm/hiu/consent-request/on-status",
      {
        patientId,
        consentArtefact: {
          consentId,
          status: "GRANTED",
          hiTypes: ["Prescription"],
          dateRange: { from: "2026-01-01", to: "2026-12-31" },
          purpose: "HIU notify stub",
          requesterName: "Peer HIU",
          grantedAt: "2026-09-10T12:00:00Z",
        },
      },
      auth
    );
    assert.equal(notify.status, 202, String(notify.json.error || ""));
    assert.equal(notify.json.patientId, patientId);
    assert.equal(notify.json.kind, "hiu_consent");
    assert.equal(notify.json.abdmMode, "stub");
    assert.match(String(notify.json.sandboxNotice || ""), /NHA sandbox/);

    const hip = await jsonRequest(
      port,
      "POST",
      "/api/abdm/hip/consent/on-notify",
      { patientId, consentId: `hip-${patientId}`, purpose: "HIP share stub" },
      auth
    );
    assert.equal(hip.status, 202, String(hip.json.error || ""));
    assert.equal(hip.json.kind, "hip_notify");
    assert.equal(hip.json.abdmMode, "stub");

    const requested = await jsonRequest(
      port,
      "POST",
      "/api/abdm/hiu/health-information/request",
      { patientId, consentId },
      auth
    );
    assert.equal(requested.status, 200, String(requested.json.error || ""));
    assert.equal(requested.json.kind, "hiu_fetch");

    const received = await jsonRequest(
      port,
      "POST",
      "/api/abdm/hiu/health-information/on-receive",
      { patientId, consentId },
      auth
    );
    assert.equal(received.status, 200, String(received.json.error || ""));
    assert.equal(received.json.kind, "hiu_receive");

    const onRequest = await jsonRequest(
      port,
      "POST",
      "/api/abdm/hip/health-information/on-request",
      { patientId, consentId, encounterId: "enc-1", transactionId: "tx-1" },
      auth
    );
    assert.equal(onRequest.status, 200, String(onRequest.json.error || ""));
    assert.equal(onRequest.json.abdmMode, "stub");
    assert.equal(onRequest.json.careContextReference, `CARE-CTX-${patient.uhid}-enc-1`);
    assert.ok(Array.isArray(onRequest.json.entries));

    const alias = await jsonRequest(
      port,
      "POST",
      "/api/abdm/hip/data-notification",
      { patientId, consentId, encounterId: "enc-1" },
      auth
    );
    assert.equal(alias.status, 200, String(alias.json.error || ""));
    assert.equal(alias.json.abdmMode, "stub");

    const listed = await jsonRequest(port, "GET", `/api/abdm/hiu/consents?patientId=${patientId}`, undefined, auth);
    assert.equal(listed.status, 200, String(listed.json.error || ""));
    assert.equal(listed.json.abdmMode, "stub");
    const artefacts = listed.json.artefacts as Array<{ patientId?: string; kind?: string; consentId?: string }>;
    assert.ok(artefacts.some((row) => row.kind === "hiu_consent" || row.consentId === consentId));
    assert.ok(artefacts.some((row) => row.kind === "hip_notify"));
    assert.ok(artefacts.some((row) => row.kind === "hip_care_context"));
    assert.ok(artefacts.some((row) => row.kind === "hiu_consent_init"));
    assert.ok(artefacts.every((row) => !row.patientId || row.patientId === patientId));

    const clinicB = createClinicUser("hiuB");
    const tokenB = await login(clinicB.email);
    const authB = { Authorization: `Bearer ${tokenB}` };
    for (const path of [
      "/api/abdm/hiu/health-information/request",
      "/api/abdm/hip/consent/on-notify",
      "/api/abdm/hip/link/care-context",
    ] as const) {
      const stolen = await jsonRequest(port, "POST", path, { patientId, consentId, encounterId: "x" }, authB);
      assert.equal(stolen.status, 403, `${path} should 403 cross-tenant`);
    }

    const deniedId = `denied-${patientId}`;
    await jsonRequest(
      port,
      "POST",
      "/api/abdm/hiu/consent-request/on-status",
      { patientId, consentArtefact: { consentId: deniedId, status: "DENIED", purpose: "blocked" } },
      auth
    );
    const blocked = await jsonRequest(
      port,
      "POST",
      "/api/abdm/hiu/health-information/request",
      { patientId, consentId: deniedId },
      auth
    );
    assert.equal(blocked.status, 403);
  });
});

describe("#38 ABDM_MODE stub|sandbox", () => {
  it("defaults to stub with bridgeReady true; sandbox without creds is not ready", () => {
    assert.deepEqual(getAbdmBridgeStatus({} as NodeJS.ProcessEnv), { abdmMode: "stub", bridgeReady: true });
    assert.deepEqual(getAbdmBridgeStatus({ ABDM_MODE: "sandbox" } as NodeJS.ProcessEnv), {
      abdmMode: "sandbox",
      bridgeReady: false,
    });
    assert.deepEqual(
      getAbdmBridgeStatus({
        ABDM_MODE: "sandbox",
        ABDM_CLIENT_ID: "real-client",
        ABDM_CLIENT_SECRET: "real-secret",
        ABDM_GATEWAY_URL: "https://sandbox.abdm.gov.in/api/v3",
      } as NodeJS.ProcessEnv),
      { abdmMode: "sandbox", bridgeReady: true }
    );
    assert.equal(
      getAbdmBridgeStatus({
        ABDM_MODE: "sandbox",
        ABDM_CLIENT_ID: "SBX_LUMERA_HEALTH_2026",
        ABDM_CLIENT_SECRET: "lumera_abdm_sandbox_sec_99182",
        ABDM_GATEWAY_URL: "https://sandbox.abdm.gov.in/api/v3",
      } as NodeJS.ProcessEnv).bridgeReady,
      false
    );
  });
});

describe("#35 overclaim grep (Platform ABHA / ABDM)", () => {
  const files = [
    "server/clinical.ts",
    "server/abdm.ts",
    "server/abdm-mode.ts",
    "server/abdm-hmac.ts",
    "src/types.ts",
  ];

  it("no Ready/Compliant/M1/M2/M3/certified/live HIP-HIU claims except reject-unlocked KYC and bridgeReady", () => {
    const overclaim =
      /\bReady\b|\bCompliant\b|\bM1\b|\bM2\b|\bM3\b|M1[–-]M3|certified|live HIP|live HIU|live HRP|ABDM live|Government e-KYC|Government Verified|\bVERIFIED\b/i;
    for (const rel of files) {
      const src = fs.readFileSync(path.join(root, rel), "utf8");
      const leftover = src
        .split(/\n/)
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => {
          if (/\/\^verified\$\/i/.test(line)) {
            return false;
          }
          const stripped = line.replace(/bridgeReady/g, "");
          return overclaim.test(stripped);
        });
      assert.deepEqual(
        leftover,
        [],
        `${rel} overclaim:\n${leftover.map((r) => `  L${r.n}: ${r.line.trim()}`).join("\n")}`
      );
    }
  });

  it("NHA sandbox notices are present on Platform ABHA/ABDM files", () => {
    const clinical = fs.readFileSync(path.join(root, "server/clinical.ts"), "utf8");
    const abdm = fs.readFileSync(path.join(root, "server/abdm.ts"), "utf8");
    assert.match(clinical, /NHA sandbox/);
    assert.match(abdm, /NHA sandbox/);
    assert.match(clinical, /LINKED_SANDBOX/);
    assert.match(abdm, /\/hip\/link\/care-context/);
    assert.match(abdm, /\/hip\/patient-discover/);
    assert.match(abdm, /\/hip\/link\/on-confirm/);
    assert.match(abdm, /\/hip\/consent\/on-notify/);
    assert.match(abdm, /\/hip\/health-information\/on-request/);
    assert.match(abdm, /\/hiu\/consent-request\/init/);
    assert.match(abdm, /\/hiu\/consent-request\/on-status/);
    assert.match(abdm, /\/hiu\/health-information\/request/);
    assert.match(abdm, /\/hiu\/health-information\/on-receive/);
    assert.match(abdm, /\/hiu\/consents/);
  });

  it("demo patient ABHA seed is LINKED_SANDBOX, never an unlocked KYC value", () => {
    const db = fs.readFileSync(path.join(root, "server/db.ts"), "utf8");
    assert.equal(/kycStatus:\s*"VERIFIED"/.test(db), false);
    assert.match(db, /kycStatus: "LINKED_SANDBOX"/);
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createApiRouter } from "./api.ts";
import { INDIVIDUAL_DEMO_TENANT_ID, POLYCLINIC_DEMO_TENANT_ID } from "./demo-workspace-tenants.ts";
import { DEMO_TENANT_ID, getDb, initDatabase } from "./db.ts";
import { escapeHtml } from "./letterhead.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { InertText } from "../src/lib/inertText.tsx";
import { DocumentPreviewModal } from "../src/components/whatsapp/DocumentPreviewModal.tsx";

const PHI = ["Rajiv Saxena", "Sunita Roy", "+91 98234 55667"];
const XSS = `"><script>alert(1)</script><img src=x onerror=alert(1)>`;

function assertNoPhi(body: string) {
  for (const marker of PHI) {
    assert.equal(body.includes(marker), false, `response leaked ${marker}`);
  }
}

function assertInertHtml(html: string) {
  assert.equal(html.toLowerCase().includes("<script"), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
}

describe("LUM-TIP-009 / LUM-TIP-010 / branches authz", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  const createdBranchIds: string[] = [];

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-tip-009";
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
    for (const id of createdBranchIds) {
      try {
        getDb().prepare("DELETE FROM branches WHERE id = ?").run(id);
      } catch {
        /* test db already closed */
      }
    }
    try {
      getDb().prepare("DELETE FROM prescriptions WHERE id = ?").run("rx-xss-tip");
      getDb().prepare("DELETE FROM lab_reports WHERE id IN (?, ?)").run("lab-xss-tip", "lab-own-tip");
      getDb().prepare("DELETE FROM patients WHERE id IN (?, ?)").run("pat-xss-tip", "pat-own-tip");
      getDb().prepare("DELETE FROM whatsapp_messages WHERE id = ?").run("msg-xss-tip");
    } catch {
      /* ignore */
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

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function textGet(urlPath: string, headers: Record<string, string> = {}) {
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { headers, redirect: "manual" });
    const body = await res.text();
    return { status: res.status, body };
  }

  function seedOtherClinic(role: "CLINIC_ADMIN" | "doctor" = "CLINIC_ADMIN") {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const tenantId = `tenant-tip9-${suffix}`;
    const email = `tip9.${suffix}@sec-test.example`.toLowerCase();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
         VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000099', ?, 500, 0, 1, '', ?, ?)`
      )
      .run(tenantId, `Other Clinic ${suffix}`, now, now, now);
    getDb()
      .prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
         VALUES (?, ?, ?, ?, 'Dr Other', ?, 'active', ?, 'Other Clinic', 1, 'polyclinic', 'General Medicine', ?, ?)`
      )
      .run(`user-tip9-${suffix}`, tenantId, email, hashPassword("Lumera@2026"), role, `+91 90000 ${suffix.slice(0, 5)}`, now, now);
    return { tenantId, email };
  }

  it("anonymous lab-report PDF and alias are 401 and contain no PHI", async () => {
    for (const id of ["lab-101", "lab-102"]) {
      const direct = await textGet(`/api/whatsapp/lab-report/${id}/pdf`);
      assert.equal(direct.status, 401, id);
      assert.match(direct.body, /Authentication required/);
      assertNoPhi(direct.body);
      const alias = await textGet(`/api/emr/lab-report/${id}/pdf`);
      assert.equal(alias.status, 401, `emr ${id}`);
      assert.match(alias.body, /Authentication required/);
      assertNoPhi(alias.body);
      assert.equal(alias.body.toLowerCase().includes("<html"), false);
    }
  });

  it("own-tenant clinician can read a lab report; another tenant and a patient cannot", async () => {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO patients (
           id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions,
           emergency_contact, address, last_visit, created_at
         ) VALUES (?, ?, ?, ?, 40, 'Female', ?, '', 'O+', '[]', '[]', '', '', ?, ?)`
      )
      .run("pat-own-tip", INDIVIDUAL_DEMO_TENANT_ID, "UHID-OWN-TIP", "Own Clinic Patient", "+91 90000 77001", now, now);
    getDb()
      .prepare(
        `INSERT INTO lab_reports (
           id, tenant_id, patient_id, patient_uhid, patient_name, date, lab_name, category,
           doctor_interpretation, results, pdf_url, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "lab-own-tip",
        INDIVIDUAL_DEMO_TENANT_ID,
        "pat-own-tip",
        "UHID-OWN-TIP",
        "Own Clinic Patient",
        "2026-10-15",
        "Own Lab",
        "Chemistry",
        "Within range",
        "[]",
        "/api/emr/lab-report/lab-own-tip/pdf",
        now
      );

    const doctor = await login("doctor@lumera.me");
    const own = await textGet("/api/whatsapp/lab-report/lab-own-tip/pdf", auth(doctor));
    assert.equal(own.status, 200);
    assert.match(own.body, /Own Clinic Patient/);
    assert.match(own.body, /Diagnostic Laboratory Report/);
    const alias = await textGet("/api/emr/lab-report/lab-own-tip/pdf", auth(doctor));
    assert.equal(alias.status, 302);
    assert.doesNotMatch(alias.body, /Own Clinic Patient/);

    const metaLab = await textGet("/api/whatsapp/lab-report/lab-101/pdf", auth(doctor));
    assert.equal(metaLab.status, 404);
    assert.equal(metaLab.body, "Lab report not found");
    assertNoPhi(metaLab.body);
    assert.doesNotMatch(metaLab.body, /Sunita|Rajiv|Lumera Central/i);

    const admin = await login("admin@lumera.me");
    const metaOwn = await textGet("/api/whatsapp/lab-report/lab-101/pdf", auth(admin));
    assert.equal(metaOwn.status, 200);
    assert.match(metaOwn.body, /Sunita Roy/);
    const metaAlias = await textGet("/api/emr/lab-report/lab-102/pdf", auth(admin));
    assert.equal(metaAlias.status, 302);
    assert.doesNotMatch(metaAlias.body, /Rajiv Saxena/);

    const other = seedOtherClinic("doctor");
    const stolen = await textGet("/api/whatsapp/lab-report/lab-101/pdf", auth(await login(other.email)));
    assert.equal(stolen.status, 404);
    assert.equal(stolen.body, "Lab report not found");
    assertNoPhi(stolen.body);
    const stolenOwn = await textGet("/api/whatsapp/lab-report/lab-own-tip/pdf", auth(await login(other.email)));
    assert.equal(stolenOwn.status, 404);
    assert.doesNotMatch(stolenOwn.body, /Own Clinic Patient/);
    const stolenAlias = await textGet("/api/emr/lab-report/lab-102/pdf", auth(await login(other.email)));
    assert.equal(stolenAlias.status, 404);
    assertNoPhi(stolenAlias.body);

    const patient = await login("patient@lumera.me");
    const denied = await textGet("/api/whatsapp/lab-report/lab-101/pdf", auth(patient));
    assert.equal(denied.status, 403);
    assertNoPhi(denied.body);
  });

  it("renders XSS in patient names, notes, WhatsApp text, and Rx/lab HTML as inert text", async () => {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO patients (
           id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions,
           emergency_contact, address, last_visit, created_at
         ) VALUES (?, ?, ?, ?, 40, 'Female', ?, '', 'O+', '[]', '[]', '', '', ?, ?)`
      )
      .run("pat-xss-tip", INDIVIDUAL_DEMO_TENANT_ID, "UHID-XSS-TIP", XSS, "+91 90000 77002", now, now);
    getDb()
      .prepare(
        `INSERT INTO prescriptions (
           id, tenant_id, rx_number, patient_id, patient_name, patient_phone, patient_uhid,
           doctor_id, doctor_name, doctor_specialty, doctor_reg_number, date, diagnosis,
           medicines, lab_tests, advice, diet_instructions, follow_up_date, pdf_url, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "rx-xss-tip",
        INDIVIDUAL_DEMO_TENANT_ID,
        "RX-XSS-TIP",
        "pat-xss-tip",
        XSS,
        "+91 90000 00001",
        "UHID-XSS",
        "doc-1",
        "Dr Safe",
        "Medicine",
        "REG-1",
        "2026-10-15",
        XSS,
        JSON.stringify([{ drugName: XSS, composition: "x", dosage: "1", form: "tab", frequency: "1-0-0", timing: "Morning", durationDays: 3, instructions: XSS }]),
        JSON.stringify([{ testName: XSS, urgency: "Routine" }]),
        JSON.stringify([XSS]),
        XSS,
        "2026-11-01",
        "/api/emr/prescription/rx-xss-tip/pdf",
        now
      );
    getDb()
      .prepare(
        `INSERT INTO lab_reports (
           id, tenant_id, patient_id, patient_uhid, patient_name, date, lab_name, category,
           doctor_interpretation, results, pdf_url, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "lab-xss-tip",
        INDIVIDUAL_DEMO_TENANT_ID,
        "pat-xss-tip",
        "UHID-XSS",
        XSS,
        "2026-10-15",
        "Safe Lab",
        "Chemistry",
        XSS,
        JSON.stringify([{ param: XSS, value: XSS, unit: "mg", normalRange: "0-1", status: XSS, trendDelta: XSS }]),
        "/api/emr/lab-report/lab-xss-tip/pdf",
        now
      );
    getDb()
      .prepare(
        `INSERT INTO whatsapp_messages (
           id, conversation_id, patient_phone, sender, staff_name, content, translated_content,
           detected_language, time_display, status, created_at
         ) VALUES (?, ?, ?, 'user', NULL, ?, NULL, 'en', '10:00 AM', 'delivered', ?)`
      )
      .run("msg-xss-tip", "conv-rajiv", "+91 90000 00001", XSS, now);

    const doctor = await login("doctor@lumera.me");
    const rx = await textGet("/api/whatsapp/prescription/rx-xss-tip/pdf", auth(doctor));
    assert.equal(rx.status, 200);
    assertInertHtml(rx.body);
    const lab = await textGet("/api/whatsapp/lab-report/lab-xss-tip/pdf", auth(doctor));
    assert.equal(lab.status, 200);
    assertInertHtml(lab.body);
    assert.equal(lab.body.toLowerCase().includes("<img"), false);
    assert.equal(lab.body.includes(XSS), false);

    const message = getDb().prepare("SELECT content FROM whatsapp_messages WHERE id = ?").get("msg-xss-tip") as {
      content: string;
    };
    const bubble = renderToStaticMarkup(React.createElement(InertText, { value: message.content }));
    assertInertHtml(bubble);
    const preview = renderToStaticMarkup(
      React.createElement(DocumentPreviewModal, {
        onClose: () => undefined,
        document: {
          type: "prescription",
          id: "rx-xss-tip",
          title: XSS,
          pdfUrl: "/api/emr/prescription/rx-xss-tip/pdf",
          data: {
            patientName: XSS,
            diagnosis: XSS,
            dietInstructions: XSS,
            advice: [XSS],
            medicines: [{ drugName: "Safe", dosage: "1", frequency: "od", timing: "Morning", durationDays: 1, instructions: XSS }],
          },
        },
      })
    );
    assertInertHtml(preview);
    assert.equal(escapeHtml(XSS).includes("<script"), false);
  });

  it("has no dangerouslySetInnerHTML sinks", () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "data") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(tsx|ts|jsx|js)$/.test(entry.name) && !entry.name.includes(".test.")) {
          const text = fs.readFileSync(full, "utf8");
          if (text.includes("dangerouslySetInnerHTML")) hits.push(path.relative(root, full));
        }
      }
    };
    walk(path.join(root, "src"));
    walk(path.join(root, "server"));
    assert.deepEqual(hits, []);
  });

  it("anonymous branch reads and mutations are 401", async () => {
    const get = await jsonRequest(port, "GET", "/api/branches");
    assert.equal(get.status, 401);
    assert.equal(get.json.error, "Authentication required");
    const post = await jsonRequest(port, "POST", "/api/branches", { name: "Anon Branch" });
    assert.equal(post.status, 401);
    const patch = await jsonRequest(port, "PATCH", "/api/branches/b-1", { name: "Hijack" });
    assert.equal(patch.status, 401);
    const del = await jsonRequest(port, "DELETE", "/api/branches/b-1");
    assert.equal(del.status, 401);
    const still = getDb().prepare("SELECT name FROM branches WHERE id = ?").get("b-1") as { name: string };
    assert.equal(still.name, "Lumera Central Polyclinic & Diagnostics");
  });

  it("scopes branch reads to the session tenant and stamps mutations from that session", async () => {
    const doctor = await login("doctor@lumera.me");
    const listed = await jsonRequest(port, "GET", "/api/branches", undefined, auth(doctor));
    assert.equal(listed.status, 200);
    const doctorRows = listed.json.branches as Array<{ id: string; name: string; tenant_id?: string }>;
    assert.equal(doctorRows.some((b) => b.id === "b-1"), false);
    assert.equal(doctorRows.some((b) => b.name === "Lumera Central Polyclinic & Diagnostics"), false);
    const doctorPost = await jsonRequest(port, "POST", "/api/branches", { name: "Doctor Branch" }, auth(doctor));
    assert.equal(doctorPost.status, 403);

    const clinic = await login("clinic.admin@lumera.me");
    const clinicList = await jsonRequest(port, "GET", "/api/branches", undefined, auth(clinic));
    assert.equal(clinicList.status, 200);
    const clinicRows = clinicList.json.branches as Array<{ id: string; tenant_id?: string }>;
    assert.ok(clinicRows.some((b) => b.id === "b-1"));
    assert.ok(clinicRows.every((b) => !b.tenant_id || b.tenant_id === POLYCLINIC_DEMO_TENANT_ID));
    const forged = await jsonRequest(
      port,
      "POST",
      "/api/branches",
      { name: "Clinic Owned Branch", tenantId: "tenant-attacker" },
      auth(clinic)
    );
    assert.equal(forged.status, 403);
    assert.equal(forged.json.error, "Forbidden");
    assert.equal(forged.json.branch, undefined);
    const created = await jsonRequest(port, "POST", "/api/branches", { name: "Clinic Owned Branch" }, auth(clinic));
    assert.equal(created.status, 201, String(created.json.error || "create branch"));
    const branch = created.json.branch as { id: string; tenant_id: string; name: string };
    createdBranchIds.push(branch.id);
    assert.equal(branch.tenant_id, POLYCLINIC_DEMO_TENANT_ID);
    assert.equal(branch.name, "Clinic Owned Branch");

    const admin = await login("admin@lumera.me");
    const adminList = await jsonRequest(port, "GET", "/api/branches", undefined, auth(admin));
    assert.equal(adminList.status, 200);
    assert.ok(Array.isArray(adminList.json.branches));
    const adminPost = await jsonRequest(
      port,
      "POST",
      "/api/branches",
      { name: "Super Branch", tenantId: "tenant-attacker" },
      auth(admin)
    );
    assert.equal(adminPost.status, 201, String(adminPost.json.error || "super create"));
    const superBranch = adminPost.json.branch as { id: string; tenant_id: string };
    createdBranchIds.push(superBranch.id);
    assert.equal(superBranch.tenant_id, DEMO_TENANT_ID);

    const other = seedOtherClinic("CLINIC_ADMIN");
    const otherToken = await login(other.email);
    const foreignList = await jsonRequest(port, "GET", "/api/branches", undefined, auth(otherToken));
    assert.equal(foreignList.status, 200);
    const foreignNames = (foreignList.json.branches as Array<{ name: string }>).map((b) => b.name);
    assert.equal(foreignNames.includes("Lumera Central Polyclinic & Diagnostics"), false);
    assert.equal(foreignNames.includes("Clinic Owned Branch"), false);
    const steal = await jsonRequest(port, "PATCH", `/api/branches/${branch.id}`, { name: "Stolen" }, auth(otherToken));
    assert.equal(steal.status, 404);
    const stealDelete = await jsonRequest(port, "DELETE", `/api/branches/b-1`, undefined, auth(otherToken));
    assert.equal(stealDelete.status, 404);
    const kept = getDb().prepare("SELECT name, tenant_id FROM branches WHERE id = ?").get(branch.id) as {
      name: string;
      tenant_id: string;
    };
    assert.equal(kept.name, "Clinic Owned Branch");
    assert.equal(kept.tenant_id, POLYCLINIC_DEMO_TENANT_ID);
    const demoBranch = getDb().prepare("SELECT name FROM branches WHERE id = ?").get("b-1") as { name: string };
    assert.equal(demoBranch.name, "Lumera Central Polyclinic & Diagnostics");

    const otherCreated = await jsonRequest(port, "POST", "/api/branches", { name: "Foreign Only Branch" }, auth(otherToken));
    assert.equal(otherCreated.status, 201, String(otherCreated.json.error || "foreign create"));
    const foreignBranch = otherCreated.json.branch as { id: string; tenant_id: string };
    createdBranchIds.push(foreignBranch.id);
    assert.equal(foreignBranch.tenant_id, other.tenantId);
    const doctorAgain = await jsonRequest(port, "GET", "/api/branches", undefined, auth(doctor));
    const doctorNames = (doctorAgain.json.branches as Array<{ name: string }>).map((b) => b.name);
    assert.equal(doctorNames.includes("Foreign Only Branch"), false);
    assert.equal(doctorNames.includes("Clinic Owned Branch"), false);
    const clinicAgain = await jsonRequest(port, "GET", "/api/branches", undefined, auth(clinic));
    const clinicNames = (clinicAgain.json.branches as Array<{ name: string }>).map((b) => b.name);
    assert.ok(clinicNames.includes("Clinic Owned Branch"));
    assert.equal(clinicNames.includes("Foreign Only Branch"), false);
  });
});

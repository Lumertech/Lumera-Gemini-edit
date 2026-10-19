import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  migrateUnownedDomains,
  rewriteSeedTemplateLinks,
  rewriteUnownedSeedText,
} from "./migrate-unowned-domains.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("unowned domain seed rewrite", () => {
  it("rewrites whole seed values and known phrases, and leaves lookalikes", () => {
    assert.equal(rewriteUnownedSeedText("lumerahealth@icici"), "demo@upi-sandbox");
    assert.equal(rewriteUnownedSeedText("LumeraHealth@ICICI"), "demo@upi-sandbox");
    assert.equal(rewriteUnownedSeedText("demo-clinic@upi-sample"), "demo@upi-sandbox");
    assert.equal(rewriteUnownedSeedText("demo@upi-sandbox"), "demo@upi-sandbox");
    assert.equal(rewriteUnownedSeedText("pay lumerahealth@icici now"), "pay lumerahealth@icici now");
    assert.equal(rewriteUnownedSeedText("care@lumeraclinic.in"), "care@example.com");
    assert.equal(rewriteUnownedSeedText("not-care@lumeraclinic.in"), "not-care@lumeraclinic.in");
    assert.equal(rewriteUnownedSeedText("dr.meera@lumera.health"), "dr.meera@example.com");
    assert.equal(rewriteUnownedSeedText("see lumera.health today"), "see lumera.health today");
    assert.equal(rewriteUnownedSeedText("https://lumeraclinic.in"), "https://example.com");
    assert.equal(rewriteUnownedSeedText("https://lumeraclinic.in/about"), "https://example.com");
    assert.equal(rewriteUnownedSeedText("https://www.lumera.health/clinic"), "https://example.com");
    assert.equal(rewriteUnownedSeedText("https://files.lumera.health/about"), "https://files.lumera.health/about");
    assert.equal(rewriteUnownedSeedText("https://lumera.healthcare/about"), "https://lumera.healthcare/about");
    assert.equal(rewriteUnownedSeedText("https://notlumera.health/about"), "https://notlumera.health/about");
    assert.equal(rewriteUnownedSeedText("xlumerahealth@icici"), "xlumerahealth@icici");
    assert.equal(rewriteUnownedSeedText("doctor@lumera.me"), "doctor@lumera.me");
    assert.equal(
      rewriteUnownedSeedText("https://images.unsplash.com/photo-1?auto=format&fit=crop&w=400&q=80"),
      "https://images.unsplash.com/photo-1?auto=format&fit=crop&w=400&q=80"
    );
    assert.equal(
      rewriteSeedTemplateLinks('[{"type":"URL","url":"https://lumera.health/portal","text":"Open"}]'),
      '[{"type":"URL","url":"https://www.mylumera.in/portal/v/{{1}}","text":"Open"}]'
    );
    assert.equal(
      rewriteSeedTemplateLinks("https://www.mylumera.in/rx/RX-9"),
      "https://www.mylumera.in/rx/v/{{1}}"
    );
    assert.equal(
      rewriteSeedTemplateLinks("https://www.mylumera.in/payments"),
      "https://www.mylumera.in/payments"
    );
    assert.equal(
      rewriteSeedTemplateLinks("https://www.mylumera.in/portal/v/{{1}}"),
      "https://www.mylumera.in/portal/v/{{1}}"
    );
    assert.equal(rewriteSeedTemplateLinks("https://lumera.health/about"), "https://example.com");
    assert.equal(rewriteSeedTemplateLinks("https://lumera.health/payments"), "https://example.com");
    assert.equal(
      rewriteSeedTemplateLinks("https://www.lumera.health/rx/RX-1"),
      "https://www.mylumera.in/rx/v/{{1}}"
    );
    assert.equal(
      rewriteSeedTemplateLinks("https://evil.lumera.health/portal"),
      "https://evil.lumera.health/portal"
    );
    assert.equal(
      rewriteSeedTemplateLinks("https://lumera.healthcare/portal"),
      "https://lumera.healthcare/portal"
    );
    assert.equal(
      rewriteUnownedSeedText("Welcome to *Lumera Polyclinic WhatsApp Health Desk*."),
      "Welcome to *Demo clinic*."
    );
    assert.equal(
      rewriteUnownedSeedText("Namaste Rajiv Saxena! Welcome to Lumera Health Desk."),
      "Namaste Rajiv Saxena! Welcome to Demo clinic."
    );
    assert.equal(rewriteUnownedSeedText("Lumera Clinical Care Team"), "Demo clinic");
    assert.equal(
      rewriteUnownedSeedText("City Clinic keeps its own footer."),
      "City Clinic keeps its own footer."
    );
  });

  it("rewrites sqlite seed rows on demo tenants only and is a no-op on the second boot", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE tenants (
        id TEXT PRIMARY KEY,
        email TEXT DEFAULT '',
        website TEXT DEFAULT '',
        upi_id TEXT DEFAULT '',
        name TEXT DEFAULT ''
      );
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT DEFAULT '',
        tenant_id TEXT DEFAULT ''
      );
      CREATE TABLE doctors (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        email TEXT DEFAULT '',
        avatar_url TEXT DEFAULT ''
      );
      CREATE TABLE staff (id TEXT PRIMARY KEY, user_id TEXT, email TEXT DEFAULT '');
      CREATE TABLE meta_templates (
        id TEXT PRIMARY KEY,
        tenant_id TEXT DEFAULT '',
        components TEXT DEFAULT '[]'
      );
      CREATE TABLE cms_settings (key TEXT PRIMARY KEY, value TEXT DEFAULT '');
      CREATE TABLE whatsapp_messages (
        id TEXT PRIMARY KEY,
        tenant_id TEXT DEFAULT '',
        content TEXT DEFAULT ''
      );
      CREATE TABLE whatsapp_conversations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT DEFAULT '',
        last_message TEXT DEFAULT ''
      );
      CREATE TABLE prescriptions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT DEFAULT '',
        qr_verification_url TEXT DEFAULT ''
      );
      CREATE TABLE patients (
        id TEXT PRIMARY KEY,
        tenant_id TEXT DEFAULT '',
        email TEXT DEFAULT ''
      );
      CREATE TABLE invoices (
        id TEXT PRIMARY KEY,
        tenant_id TEXT DEFAULT '',
        upi_id TEXT DEFAULT ''
      );
      CREATE TABLE whatsapp_outbound_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT DEFAULT '',
        details TEXT DEFAULT '',
        action_payload TEXT DEFAULT ''
      );
      CREATE TABLE audit_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        user_id TEXT,
        user_name TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        tenant_id TEXT NOT NULL DEFAULT '',
        patient_id TEXT NOT NULL DEFAULT '',
        actor_role TEXT NOT NULL DEFAULT '',
        entity_type TEXT NOT NULL DEFAULT '',
        entity_id TEXT NOT NULL DEFAULT ''
      );
    `);
    const insertTenant = db.prepare(
      "INSERT INTO tenants (id, email, website, upi_id, name) VALUES (?, ?, ?, ?, ?)"
    );
    insertTenant.run(
      "tenant-lumera-main",
      "care@lumeraclinic.in",
      "https://lumeraclinic.in",
      "lumerahealth@icici",
      "Lumera Healthcare & Polyclinic Institute"
    );
    insertTenant.run(
      "tenant-real",
      "care@lumeraclinic.in",
      "https://lumeraclinic.in",
      "lumerahealth@icici",
      "City Clinic"
    );
    db.prepare("INSERT INTO users (id, email, tenant_id) VALUES (?, ?, ?)").run(
      "user-demo-doctor",
      "doctor@lumera.me",
      "tenant-lumera-main"
    );
    db.prepare("INSERT INTO users (id, email, tenant_id) VALUES (?, ?, ?)").run(
      "user-real-doctor",
      "dr.meera@lumera.health",
      "tenant-real"
    );
    db.prepare("INSERT INTO doctors (id, user_id, email, avatar_url) VALUES (?, ?, ?, ?)").run(
      "doc-6",
      "user-demo-doctor",
      "dr.siddharth@lumera.health",
      "https://images.unsplash.com/photo-1?auto=format&fit=crop&w=400&q=80"
    );
    db.prepare("INSERT INTO doctors (id, user_id, email, avatar_url) VALUES (?, ?, ?, ?)").run(
      "doc-real",
      "user-real-doctor",
      "dr.siddharth@lumera.health",
      "https://images.unsplash.com/photo-real"
    );
    db.prepare("INSERT INTO doctors (id, user_id, email, avatar_url) VALUES (?, ?, ?, ?)").run(
      "doc-2",
      null,
      "dr.ananya@lumera.health",
      ""
    );
    db.prepare("INSERT INTO doctors (id, user_id, email, avatar_url) VALUES (?, ?, ?, ?)").run(
      "doc-3",
      null,
      "desk@city.example",
      ""
    );
    db.prepare("INSERT INTO doctors (id, user_id, email, avatar_url) VALUES (?, ?, ?, ?)").run(
      "doc-outside",
      null,
      "dr.ananya@lumera.health",
      ""
    );
    const insertTemplate = db.prepare(
      "INSERT INTO meta_templates (id, tenant_id, components) VALUES (?, ?, ?)"
    );
    insertTemplate.run(
      "tpl-2",
      "tenant-lumera-main",
      JSON.stringify([
        { type: "BODY", text: "See your Lumera Portal" },
        { type: "BUTTONS", buttons: [{ type: "URL", url: "https://lumera.health/portal" }] },
        { type: "BUTTONS", buttons: [{ type: "URL", url: "https://www.mylumera.in/payments" }] },
        { type: "FOOTER", text: "Lumera Health EMR System • Digital Rx" },
      ])
    );
    insertTemplate.run(
      "tpl-custom",
      "tenant-lumera-main",
      JSON.stringify([
        { type: "BUTTONS", buttons: [{ type: "URL", url: "https://lumera.health/portal" }] },
        { type: "FOOTER", text: "City Clinic • Digital Rx" },
      ])
    );
    insertTemplate.run(
      "tpl-2-real",
      "tenant-real",
      JSON.stringify([{ type: "BUTTONS", buttons: [{ type: "URL", url: "https://lumera.health/portal" }] }])
    );
    db.prepare("INSERT INTO cms_settings (key, value) VALUES (?, ?)").run(
      "contact_email",
      "contact@lumera.health"
    );
    db.prepare("INSERT INTO whatsapp_messages (id, tenant_id, content) VALUES (?, ?, ?)").run(
      "msg-1",
      "tenant-lumera-main",
      "Welcome to *Lumera Polyclinic WhatsApp Health Desk*."
    );
    db.prepare("INSERT INTO whatsapp_messages (id, tenant_id, content) VALUES (?, ?, ?)").run(
      "msg-real",
      "tenant-real",
      "Welcome to *Lumera Polyclinic WhatsApp Health Desk*."
    );
    db.prepare("INSERT INTO whatsapp_conversations (id, tenant_id, last_message) VALUES (?, ?, ?)").run(
      "conv-demo",
      "tenant-lumera-main",
      "Welcome to Lumera Health Desk."
    );
    db.prepare("INSERT INTO whatsapp_conversations (id, tenant_id, last_message) VALUES (?, ?, ?)").run(
      "conv-real",
      "tenant-real",
      "Welcome to Lumera Health Desk."
    );
    const sentPayload = JSON.stringify({ url: "https://lumera.health/rx/RX-1", upi: "lumerahealth@icici" });
    db.prepare(
      "INSERT INTO whatsapp_outbound_events (id, tenant_id, details, action_payload) VALUES (?, ?, ?, ?)"
    ).run("evt-demo", "tenant-lumera-main", "Sent https://lumera.health/rx/RX-1", sentPayload);
    db.prepare(
      "INSERT INTO whatsapp_outbound_events (id, tenant_id, details, action_payload) VALUES (?, ?, ?, ?)"
    ).run("evt-real", "tenant-real", "Sent https://lumeraclinic.in/pay/9", sentPayload);
    const priorAudit = "Patient was sent https://lumera.health/rx/RX-1";
    db.prepare(
      `INSERT INTO audit_logs (
        id, timestamp, user_id, user_name, action, details,
        tenant_id, patient_id, actor_role, entity_type, entity_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "audit-sent-1",
      "2026-10-01T00:00:00.000Z",
      "user-demo-doctor",
      "Dr Demo",
      "whatsapp_sent",
      priorAudit,
      "tenant-lumera-main",
      "pat-6",
      "doctor",
      "whatsapp_message",
      "msg-1"
    );
    db.prepare("INSERT INTO prescriptions (id, tenant_id, qr_verification_url) VALUES (?, ?, ?)").run(
      "rx-1",
      "tenant-demo-physio",
      "https://lumera.health/rx/RX-1"
    );
    db.prepare("INSERT INTO prescriptions (id, tenant_id, qr_verification_url) VALUES (?, ?, ?)").run(
      "rx-subdomain",
      "tenant-demo-physio",
      "https://files.lumera.health/rx/RX-9"
    );
    db.prepare("INSERT INTO prescriptions (id, tenant_id, qr_verification_url) VALUES (?, ?, ?)").run(
      "rx-real",
      "tenant-real",
      "https://lumera.health/rx/RX-1"
    );
    db.prepare("INSERT INTO patients (id, tenant_id, email) VALUES (?, ?, ?)").run(
      "pat-6",
      "tenant-lumera-main",
      "rajiv.saxena@gmail.com"
    );
    db.prepare("INSERT INTO patients (id, tenant_id, email) VALUES (?, ?, ?)").run(
      "pat-real",
      "tenant-real",
      "rajiv.saxena@gmail.com"
    );
    db.prepare("INSERT INTO invoices (id, tenant_id, upi_id) VALUES (?, ?, ?)").run(
      "inv-1",
      "tenant-543feff7",
      "lumerahealth@icici"
    );
    db.prepare("INSERT INTO invoices (id, tenant_id, upi_id) VALUES (?, ?, ?)").run(
      "inv-real",
      "tenant-real",
      "lumerahealth@icici"
    );

    migrateUnownedDomains(db);
    migrateUnownedDomains(db);

    const tenant = db.prepare("SELECT email, website, upi_id, name FROM tenants WHERE id = ?").get(
      "tenant-lumera-main"
    ) as { email: string; website: string; upi_id: string; name: string };
    assert.equal(tenant.email, "care@example.com");
    assert.equal(tenant.website, "https://example.com");
    assert.equal(tenant.upi_id, "demo@upi-sandbox");
    assert.equal(tenant.name, "Lumera Healthcare & Polyclinic Institute");

    const real = db.prepare("SELECT email, website, upi_id FROM tenants WHERE id = ?").get("tenant-real") as {
      email: string;
      website: string;
      upi_id: string;
    };
    assert.equal(real.email, "care@lumeraclinic.in");
    assert.equal(real.website, "https://lumeraclinic.in");
    assert.equal(real.upi_id, "lumerahealth@icici");

    const doctor = db.prepare("SELECT email, avatar_url FROM doctors WHERE id = ?").get("doc-6") as {
      email: string;
      avatar_url: string;
    };
    assert.equal(doctor.email, "dr.siddharth@example.com");
    assert.equal(
      doctor.avatar_url,
      "https://images.unsplash.com/photo-1?auto=format&fit=crop&w=400&q=80"
    );
    assert.equal(
      (db.prepare("SELECT email FROM doctors WHERE id = ?").get("doc-real") as { email: string }).email,
      "dr.siddharth@lumera.health"
    );
    assert.equal(
      (db.prepare("SELECT email FROM doctors WHERE id = ?").get("doc-2") as { email: string }).email,
      "dr.ananya@example.com"
    );
    assert.equal(
      (db.prepare("SELECT email FROM doctors WHERE id = ?").get("doc-3") as { email: string }).email,
      "desk@city.example"
    );
    assert.equal(
      (db.prepare("SELECT email FROM doctors WHERE id = ?").get("doc-outside") as { email: string }).email,
      "dr.ananya@lumera.health"
    );
    assert.equal(
      (db.prepare("SELECT email FROM users WHERE id = ?").get("user-demo-doctor") as { email: string }).email,
      "doctor@lumera.me"
    );
    assert.equal(
      (db.prepare("SELECT email FROM users WHERE id = ?").get("user-real-doctor") as { email: string }).email,
      "dr.meera@lumera.health"
    );

    const components = JSON.parse(
      (db.prepare("SELECT components AS v FROM meta_templates WHERE id = ?").get("tpl-2") as { v: string }).v
    ) as Array<{ text?: string; buttons?: Array<{ url?: string }> }>;
    assert.equal(components[0].text, "See your patient portal");
    assert.equal(components[1].buttons?.[0].url, "https://www.mylumera.in/portal/v/{{1}}");
    assert.equal(components[2].buttons?.[0].url, "https://www.mylumera.in/payments");
    assert.equal(components[3].text, "Demo clinic • Digital Rx");
    const custom = JSON.parse(
      (db.prepare("SELECT components AS v FROM meta_templates WHERE id = ?").get("tpl-custom") as { v: string }).v
    ) as Array<{ text?: string; buttons?: Array<{ url?: string }> }>;
    assert.equal(custom[0].buttons?.[0].url, "https://lumera.health/portal");
    assert.equal(custom[1].text, "City Clinic • Digital Rx");
    const realTemplate = JSON.parse(
      (db.prepare("SELECT components AS v FROM meta_templates WHERE id = ?").get("tpl-2-real") as { v: string }).v
    ) as Array<{ buttons?: Array<{ url?: string }> }>;
    assert.equal(realTemplate[0].buttons?.[0].url, "https://lumera.health/portal");

    assert.equal(
      (db.prepare("SELECT value AS v FROM cms_settings WHERE key = ?").get("contact_email") as { v: string }).v,
      "ravee@lumer.me"
    );
    assert.equal(
      (db.prepare("SELECT content AS v FROM whatsapp_messages WHERE id = ?").get("msg-1") as { v: string }).v,
      "Welcome to *Lumera Polyclinic WhatsApp Health Desk*."
    );
    assert.equal(
      (db.prepare("SELECT content AS v FROM whatsapp_messages WHERE id = ?").get("msg-real") as { v: string }).v,
      "Welcome to *Lumera Polyclinic WhatsApp Health Desk*."
    );
    assert.equal(
      (db.prepare("SELECT last_message AS v FROM whatsapp_conversations WHERE id = ?").get("conv-demo") as { v: string })
        .v,
      "Welcome to Lumera Health Desk."
    );
    assert.equal(
      (db.prepare("SELECT last_message AS v FROM whatsapp_conversations WHERE id = ?").get("conv-real") as { v: string })
        .v,
      "Welcome to Lumera Health Desk."
    );
    const demoEvent = db
      .prepare("SELECT details, action_payload FROM whatsapp_outbound_events WHERE id = ?")
      .get("evt-demo") as { details: string; action_payload: string };
    assert.equal(demoEvent.details, "Sent https://lumera.health/rx/RX-1");
    assert.equal(demoEvent.action_payload, sentPayload);
    assert.equal(
      (db.prepare("SELECT details AS v FROM whatsapp_outbound_events WHERE id = ?").get("evt-real") as { v: string }).v,
      "Sent https://lumeraclinic.in/pay/9"
    );
    const keptAudit = db.prepare("SELECT action, details FROM audit_logs WHERE id = ?").get("audit-sent-1") as {
      action: string;
      details: string;
    };
    assert.equal(keptAudit.action, "whatsapp_sent");
    assert.equal(keptAudit.details, priorAudit);
    const migrationAudits = db
      .prepare("SELECT details FROM audit_logs WHERE action = ?")
      .all("Unowned domain migration") as Array<{ details: string }>;
    assert.equal(migrationAudits.length, 1);
    assert.match(migrationAudits[0].details, /tenants=1/);
    assert.match(migrationAudits[0].details, /invoices=1/);
    assert.match(migrationAudits[0].details, /prescriptions=1/);
    assert.match(migrationAudits[0].details, /patients=1/);
    assert.doesNotMatch(migrationAudits[0].details, /whatsapp/);
    assert.equal(
      (db.prepare("SELECT qr_verification_url AS v FROM prescriptions WHERE id = ?").get("rx-1") as { v: string | null })
        .v,
      null
    );
    assert.equal(
      (
        db.prepare("SELECT qr_verification_url AS v FROM prescriptions WHERE id = ?").get("rx-real") as {
          v: string | null;
        }
      ).v,
      "https://lumera.health/rx/RX-1"
    );
    assert.equal(
      (
        db.prepare("SELECT qr_verification_url AS v FROM prescriptions WHERE id = ?").get("rx-subdomain") as {
          v: string | null;
        }
      ).v,
      "https://files.lumera.health/rx/RX-9"
    );
    assert.equal(
      (db.prepare("SELECT email AS v FROM patients WHERE id = ?").get("pat-6") as { v: string }).v,
      "rajiv.saxena@example.com"
    );
    assert.equal(
      (db.prepare("SELECT email AS v FROM patients WHERE id = ?").get("pat-real") as { v: string }).v,
      "rajiv.saxena@gmail.com"
    );
    assert.equal(
      (db.prepare("SELECT upi_id AS v FROM invoices WHERE id = ?").get("inv-1") as { v: string }).v,
      "demo@upi-sandbox"
    );
    assert.equal(
      (db.prepare("SELECT upi_id AS v FROM invoices WHERE id = ?").get("inv-real") as { v: string }).v,
      "lumerahealth@icici"
    );
  });

  it("reports a row error and keeps going", () => {
    const logged: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(
        args
          .map((item) => (item && typeof item === "object" ? JSON.stringify(item) : String(item)))
          .join(" ")
      );
    };
    const db = {
      prepare(sql: string) {
        return {
          all() {
            if (sql.includes("FROM tenants")) {
              return [
                {
                  id: "tenant-lumera-main",
                  email: "care@lumeraclinic.in",
                  website: "https://lumeraclinic.in",
                  upi_id: "lumerahealth@icici",
                },
              ];
            }
            return [];
          },
          get() {
            return undefined;
          },
          run() {
            if (sql.startsWith("UPDATE tenants")) throw new Error("row failed");
            return { changes: 0, lastInsertRowid: 0 };
          },
        };
      },
      exec() {},
    };
    try {
      migrateUnownedDomains(db);
    } finally {
      console.error = original;
    }
    assert.ok(logged.some((line) => line.includes("tenants tenant-lumera-main")));
  });

  it("does not touch sqlite_master and does not hardcode Lumera into clinic WhatsApp replacements", () => {
    const source = fs.readFileSync(path.join(root, "server/migrate-unowned-domains.ts"), "utf8");
    assert.equal(source.includes("sqlite_master"), false);
    assert.equal(source.includes("PRAGMA"), false);
    assert.equal(source.includes("unsplash"), false);
    assert.equal(source.includes("whatsapp_messages"), false);
    assert.equal(source.includes("whatsapp_conversations"), false);
    assert.equal(source.includes("whatsapp_outbound_events"), false);
    assert.equal(source.includes("UPDATE audit_logs"), false);
    const clinicLine = source
      .split("\n")
      .find((line) => line.includes("Lumera Polyclinic WhatsApp Health Desk"));
    assert.ok(clinicLine);
    assert.match(clinicLine || "", /Demo clinic/);
    assert.doesNotMatch(clinicLine || "", /"Demo clinic Lumera"|Lumera clinic WhatsApp/i);
  });
});

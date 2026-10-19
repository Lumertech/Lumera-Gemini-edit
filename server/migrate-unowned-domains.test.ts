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
    assert.equal(rewriteUnownedSeedText("https://lumeraclinic.in/about"), "https://lumeraclinic.in/about");
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
      "conv-real",
      "tenant-real",
      "Welcome to Lumera Health Desk."
    );
    db.prepare("INSERT INTO prescriptions (id, tenant_id, qr_verification_url) VALUES (?, ?, ?)").run(
      "rx-1",
      "tenant-demo-physio",
      "https://lumera.health/rx/RX-1"
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
    assert.match(
      (db.prepare("SELECT content AS v FROM whatsapp_messages WHERE id = ?").get("msg-1") as { v: string }).v,
      /Demo clinic/
    );
    assert.match(
      (db.prepare("SELECT content AS v FROM whatsapp_messages WHERE id = ?").get("msg-real") as { v: string }).v,
      /Lumera Polyclinic WhatsApp Health Desk/
    );
    assert.match(
      (db.prepare("SELECT last_message AS v FROM whatsapp_conversations WHERE id = ?").get("conv-real") as { v: string })
        .v,
      /Lumera Health Desk/
    );
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
    const clinicLine = source
      .split("\n")
      .find((line) => line.includes("Lumera Polyclinic WhatsApp Health Desk"));
    assert.ok(clinicLine);
    assert.match(clinicLine || "", /Demo clinic/);
    assert.doesNotMatch(clinicLine || "", /"Demo clinic Lumera"|Lumera clinic WhatsApp/i);
  });
});

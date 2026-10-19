import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { migrateUnownedDomains, rewriteUnownedSeedText } from "./migrate-unowned-domains.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("unowned domain seed rewrite", () => {
  it("rewrites old domains, UPI, portal links, and clinic WhatsApp phrases once", () => {
    const portal = rewriteUnownedSeedText(
      '[{"type":"URL","url":"https://lumera.health/portal","text":"Open"}]'
    );
    assert.equal(portal, '[{"type":"URL","url":"https://www.mylumera.in/portal/v/{{1}}","text":"Open"}]');
    assert.doesNotMatch(portal, /lumera\.health/);

    const again = rewriteUnownedSeedText(portal);
    assert.equal(again, portal);

    assert.equal(rewriteUnownedSeedText("lumerahealth@icici"), "demo@upi-sandbox");
    assert.equal(rewriteUnownedSeedText("LumeraHealth@ICICI"), "demo@upi-sandbox");
    assert.equal(rewriteUnownedSeedText("demo-clinic@upi-sample"), "demo@upi-sandbox");
    assert.equal(rewriteUnownedSeedText("demo@upi-sandbox"), "demo@upi-sandbox");
    assert.equal(rewriteUnownedSeedText("care@lumeraclinic.in"), "care@example.com");
    assert.equal(rewriteUnownedSeedText("dr.meera@lumera.health"), "dr.meera@example.com");
    assert.equal(
      rewriteUnownedSeedText("https://www.mylumera.in/rx/RX-9"),
      "https://www.mylumera.in/rx/v/{{1}}"
    );
    assert.equal(rewriteUnownedSeedText("doctor@lumera.me"), "doctor@lumera.me");
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

  it("rewrites sqlite seed rows and is a no-op on the second boot", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE tenants (
        id TEXT PRIMARY KEY,
        email TEXT DEFAULT '',
        website TEXT DEFAULT '',
        upi_id TEXT DEFAULT '',
        name TEXT DEFAULT ''
      );
      CREATE TABLE doctors (id TEXT PRIMARY KEY, email TEXT DEFAULT '', avatar_url TEXT DEFAULT '');
      CREATE TABLE staff (id TEXT PRIMARY KEY, email TEXT DEFAULT '');
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT DEFAULT '');
      CREATE TABLE meta_templates (id TEXT PRIMARY KEY, components TEXT DEFAULT '[]');
      CREATE TABLE cms_settings (key TEXT PRIMARY KEY, value TEXT DEFAULT '');
      CREATE TABLE whatsapp_messages (id TEXT PRIMARY KEY, content TEXT DEFAULT '');
      CREATE TABLE prescriptions (id TEXT PRIMARY KEY, qr_verification_url TEXT DEFAULT '');
      CREATE TABLE patients (id TEXT PRIMARY KEY, email TEXT DEFAULT '');
    `);
    db.prepare("INSERT INTO tenants (id, email, website, upi_id, name) VALUES (?, ?, ?, ?, ?)").run(
      "tenant-lumera-main",
      "care@lumeraclinic.in",
      "https://lumeraclinic.in",
      "lumerahealth@icici",
      "Lumera Healthcare & Polyclinic Institute"
    );
    db.prepare("INSERT INTO tenants (id, email, website, upi_id, name) VALUES (?, ?, ?, ?, ?)").run(
      "tenant-real",
      "desk@cityclinic.example",
      "https://cityclinic.example",
      "city@upi",
      "City Clinic"
    );
    db.prepare("INSERT INTO doctors (id, email, avatar_url) VALUES (?, ?, ?)").run(
      "doc-6",
      "dr.siddharth@lumera.health",
      "https://images.unsplash.com/photo-1?auto=format&fit=crop&w=400&q=80"
    );
    db.prepare("INSERT INTO users (id, email) VALUES (?, ?)").run("user-doctor", "doctor@lumera.me");
    db.prepare("INSERT INTO meta_templates (id, components) VALUES (?, ?)").run(
      "tpl-2",
      JSON.stringify([
        { type: "BODY", text: "See your Lumera Portal" },
        { type: "BUTTONS", buttons: [{ type: "URL", url: "https://lumera.health/portal" }] },
        { type: "FOOTER", text: "Lumera Health EMR System • Digital Rx" },
      ])
    );
    db.prepare("INSERT INTO meta_templates (id, components) VALUES (?, ?)").run(
      "tpl-custom",
      JSON.stringify([{ type: "FOOTER", text: "City Clinic • Digital Rx" }])
    );
    db.prepare("INSERT INTO cms_settings (key, value) VALUES (?, ?)").run(
      "contact_email",
      "contact@lumera.health"
    );
    db.prepare("INSERT INTO whatsapp_messages (id, content) VALUES (?, ?)").run(
      "msg-1",
      "Welcome to *Lumera Polyclinic WhatsApp Health Desk*."
    );
    db.prepare("INSERT INTO prescriptions (id, qr_verification_url) VALUES (?, ?)").run(
      "rx-1",
      "https://lumera.health/rx/RX-1"
    );
    db.prepare("INSERT INTO patients (id, email) VALUES (?, ?)").run("pat-6", "rajiv.saxena@gmail.com");
    db.prepare("INSERT INTO patients (id, email) VALUES (?, ?)").run("pat-real", "patient@cityclinic.example");

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
    assert.equal(real.email, "desk@cityclinic.example");
    assert.equal(real.website, "https://cityclinic.example");
    assert.equal(real.upi_id, "city@upi");

    const doctor = db.prepare("SELECT email, avatar_url FROM doctors WHERE id = ?").get("doc-6") as {
      email: string;
      avatar_url: string;
    };
    assert.equal(doctor.email, "dr.siddharth@example.com");
    assert.equal(doctor.avatar_url, "/lumera-logo.svg");
    assert.equal(
      (db.prepare("SELECT email FROM users WHERE id = ?").get("user-doctor") as { email: string }).email,
      "doctor@lumera.me"
    );

    const components = JSON.parse(
      (db.prepare("SELECT components AS v FROM meta_templates WHERE id = ?").get("tpl-2") as { v: string }).v
    ) as Array<{ text?: string; buttons?: Array<{ url?: string }> }>;
    assert.equal(components[0].text, "See your patient portal");
    assert.equal(components[1].buttons?.[0].url, "https://www.mylumera.in/portal/v/{{1}}");
    assert.equal(components[2].text, "Demo clinic • Digital Rx");
    assert.equal(
      (db.prepare("SELECT components AS v FROM meta_templates WHERE id = ?").get("tpl-custom") as { v: string }).v.includes(
        "City Clinic • Digital Rx"
      ),
      true
    );
    assert.equal(
      (db.prepare("SELECT value AS v FROM cms_settings WHERE key = ?").get("contact_email") as { v: string }).v,
      "ravee@lumer.me"
    );
    assert.match(
      (db.prepare("SELECT content AS v FROM whatsapp_messages WHERE id = ?").get("msg-1") as { v: string }).v,
      /Demo clinic/
    );
    assert.equal(
      (db.prepare("SELECT qr_verification_url AS v FROM prescriptions WHERE id = ?").get("rx-1") as { v: string | null }).v,
      null
    );
    assert.equal(
      (db.prepare("SELECT email AS v FROM patients WHERE id = ?").get("pat-6") as { v: string }).v,
      "rajiv.saxena@mylumera.in"
    );
    assert.equal(
      (db.prepare("SELECT email AS v FROM patients WHERE id = ?").get("pat-real") as { v: string }).v,
      "patient@cityclinic.example"
    );
  });

  it("does not touch sqlite_master and does not hardcode Lumera into clinic WhatsApp replacements", () => {
    const source = fs.readFileSync(path.join(root, "server/migrate-unowned-domains.ts"), "utf8");
    assert.equal(source.includes("sqlite_master"), false);
    assert.equal(source.includes("PRAGMA"), false);
    const clinicLine = source
      .split("\n")
      .find((line) => line.includes("Lumera Polyclinic WhatsApp Health Desk"));
    assert.ok(clinicLine);
    assert.match(clinicLine || "", /Demo clinic/);
    assert.doesNotMatch(clinicLine || "", /"Demo clinic Lumera"|Lumera clinic WhatsApp/i);
  });
});

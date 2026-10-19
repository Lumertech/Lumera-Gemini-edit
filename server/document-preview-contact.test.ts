import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DocumentPreviewModal,
  clinicDocumentEmail,
} from "../src/components/whatsapp/DocumentPreviewModal.tsx";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function preview(data: Record<string, unknown>) {
  return renderToStaticMarkup(
    React.createElement(DocumentPreviewModal, {
      onClose: () => undefined,
      document: {
        type: "prescription",
        id: "rx-1",
        title: "Clinical Prescription",
        pdfUrl: "/api/emr/prescription/rx-1/pdf",
        data,
      },
    })
  );
}

describe("patient-facing clinic document contact", () => {
  it("prints the clinic mailbox and omits the email line when the clinic has none", () => {
    assert.equal(clinicDocumentEmail({ clinicEmail: "  desk@cityclinic.example  " }), "desk@cityclinic.example");
    assert.equal(clinicDocumentEmail({ clinicEmail: "   ", contactEmail: "front@cityclinic.example" }), "front@cityclinic.example");
    assert.equal(clinicDocumentEmail({ contact_email: "records@cityclinic.example" }), "records@cityclinic.example");
    assert.equal(clinicDocumentEmail({ email: "patient@example.com" }), "");
    assert.equal(clinicDocumentEmail({}), "");

    const shown = preview({ clinicEmail: "desk@cityclinic.example", email: "patient@example.com" });
    assert.match(shown, /data-testid="clinic-document-email"/);
    assert.ok(shown.includes("desk@cityclinic.example"));
    assert.equal(shown.includes("patient@example.com"), false);
    assert.equal(shown.includes("care@example.com"), false);
    assert.ok(shown.includes("Phone: +91 80 4123 4567"));

    const omitted = preview({ patientName: "Asha Rao" });
    assert.equal(omitted.includes("clinic-document-email"), false);
    assert.equal(omitted.includes("care@example.com"), false);
    assert.equal(omitted.includes("@"), false);
    assert.ok(omitted.includes("Phone: +91 80 4123 4567"));

    const source = fs.readFileSync(path.join(root, "src/components/whatsapp/DocumentPreviewModal.tsx"), "utf8");
    assert.equal(source.includes("care@example.com"), false);

    const whatsapp = fs.readFileSync(path.join(root, "server/whatsapp.ts"), "utf8");
    const previews = whatsapp.slice(
      whatsapp.indexOf('if (action === "get_prescription")'),
      whatsapp.indexOf('if (action === "get_doctors")')
    );
    const botPreview = whatsapp.split("async function processBotActionOrQuery")[1] || "";
    assert.equal(previews.includes("clinicEmail"), false);
    assert.equal(botPreview.includes("clinicEmail"), false);
  });

  it("keeps the public landing contact at ravee@lumer.me", () => {
    const landing = fs.readFileSync(path.join(root, "src/components/LandingPage.tsx"), "utf8");
    assert.match(landing, /contactEmail:\s*"ravee@lumer\.me"/);
  });
});

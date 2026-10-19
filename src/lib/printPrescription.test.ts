import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import {
  finishPrescriptionPrint,
  joinPresent,
  preparePrescriptionPrint,
  printPrescriptionDocument,
  RX_PRINT_ROOT_ID,
  waitForPrintAssets,
} from "./printPrescription.ts";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function rxPage(): Document {
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="root">
        <header data-print-chrome="">OPD Queue</header>
        <div role="status">Draft saved toast</div>
        <div data-rx-modal="" data-print-chrome="">
          <h3>Prescription Digitally Signed</h3>
          <button type="button">Print Paper Rx</button>
        </div>
        <article data-rx-document="">
          <h1>Malhotra Individual Practice</h1>
          <p>Patient Name</p>
          <strong>QA Paper Patient</strong>
          <p>Paracetamol 650</p>
          <p>Authorized Medical Signature</p>
          <p>Dr. Vikram Malhotra</p>
          <footer>For the named patient only. Not valid without the practice seal.</footer>
          <button type="button">View Full Patient Record</button>
          <input value="Lumbar strain" />
        </article>
      </div>
    </body></html>`,
    { url: "https://www.mylumera.in/w/malhotra-individual-practice/rx/visit-1" }
  );
  return dom.window.document;
}

describe("paper Rx print isolation", () => {
  it("joins only the contact fields that have a value", () => {
    assert.equal(joinPresent(["", "Tel: +91 98000 12000"]), "Tel: +91 98000 12000");
    assert.equal(joinPresent(["", "Email: doctor@lumera.me"]), "Email: doctor@lumera.me");
    assert.equal(
      joinPresent(["12 MG Road, Bengaluru", "Tel: +91 98000 12000"]),
      "12 MG Road, Bengaluru · Tel: +91 98000 12000"
    );
    assert.equal(joinPresent(["", "  ", null]), "");
  });

  it("omits blank clinical sections and an unset risk level from the print root", async () => {
    const dom = new JSDOM(
      `<!doctype html><body>
        <article data-rx-document="">
          <p>Malhotra Individual Practice</p>
          <p>Tel: +91 98000 12000</p>
          <p>Email: doctor@lumera.me</p>
          <p>MBBS, MD (General Medicine), FICP</p>
          <p>Reg No: MCI-2012-74892</p>
          <div data-rx-section-group="">
            <div data-rx-has-content="false"><label>Chief Complaints & Symptom Duration:</label></div>
            <div data-rx-has-content="false"><label>History of Present Illness</label><textarea></textarea></div>
          </div>
          <div data-rx-has-content="false"><span>Vitals</span><label>BP systolic<input value="" /></label></div>
          <label data-rx-has-content="false">Risk Level<select><option>Unset</option></select></label>
          <div data-rx-has-content="false"><label>Red Flags</label></div>
          <div data-rx-has-content="false"><label>Ergonomic & Lifestyle Directives:</label></div>
          <div data-rx-has-content="true"><p>Clinical Diagnosis: Lumbar strain</p></div>
          <div data-rx-meds="">
            <h3>Medication Schedule</h3>
            <p>No medicines prescribed</p>
          </div>
          <div data-rx-signature=""><p>Authorized Medical Signature</p></div>
        </article>
      </body>`,
      { url: "https://www.mylumera.in/w/malhotra-individual-practice/rx/visit-1" }
    );
    const doc = dom.window.document;
    (doc.defaultView as Window).print = () => {};
    assert.equal(await printPrescriptionDocument(doc), true);
    const printed = doc.getElementById(RX_PRINT_ROOT_ID)?.textContent || "";
    assert.match(printed, /Malhotra Individual Practice/);
    assert.match(printed, /Tel: \+91 98000 12000/);
    assert.match(printed, /Email: doctor@lumera\.me/);
    assert.match(printed, /MBBS, MD \(General Medicine\), FICP/);
    assert.match(printed, /Reg No: MCI-2012-74892/);
    assert.match(printed, /Lumbar strain/);
    assert.match(printed, /Medication Schedule/);
    assert.match(printed, /No medicines prescribed/);
    assert.match(printed, /Authorized Medical Signature/);
    for (const heading of [
      "Chief Complaints",
      "History of Present Illness",
      "Vitals",
      "BP systolic",
      "Risk Level",
      "Unset",
      "Red Flags",
      "Lifestyle",
    ]) {
      assert.equal(printed.includes(heading), false, heading);
    }
    assert.equal(printed.includes("| Tel:"), false);
    assert.equal(printed.includes("Web:"), false);
  });

  it("prints the letterhead Rx and not the digitally signed modal", async () => {
    const doc = rxPage();
    const win = doc.defaultView as Window & { print: () => void };
    let printedRoot = "";
    let modalHiddenAtPrint = false;
    let navInRoot = false;
    let toastInRoot = false;
    let printingClass = false;
    win.print = () => {
      const root = doc.getElementById(RX_PRINT_ROOT_ID);
      printedRoot = root?.textContent || "";
      modalHiddenAtPrint = Boolean(doc.querySelector("[data-rx-modal]")?.hasAttribute("hidden") || (doc.querySelector("[data-rx-modal]") as HTMLElement | null)?.hidden);
      navInRoot = printedRoot.includes("OPD Queue");
      toastInRoot = printedRoot.includes("Draft saved toast");
      printingClass = doc.body.classList.contains("printing-rx");
    };

    const didPrint = await printPrescriptionDocument(doc);
    assert.equal(didPrint, true);
    assert.equal(printingClass, true);
    assert.equal(modalHiddenAtPrint, true);
    assert.equal(navInRoot, false);
    assert.equal(toastInRoot, false);
    assert.match(printedRoot, /Malhotra Individual Practice/);
    assert.match(printedRoot, /QA Paper Patient/);
    assert.match(printedRoot, /Paracetamol 650/);
    assert.match(printedRoot, /Authorized Medical Signature/);
    assert.match(printedRoot, /Dr\. Vikram Malhotra/);
    assert.match(printedRoot, /For the named patient only/);
    assert.match(printedRoot, /Lumbar strain/);
    assert.equal(printedRoot.includes("Prescription Digitally Signed"), false);
    assert.equal(printedRoot.includes("Print Paper Rx"), false);
    assert.equal(printedRoot.includes("View Full Patient Record"), false);
    assert.equal(doc.body.contains(doc.getElementById(RX_PRINT_ROOT_ID)), true);
    assert.equal(doc.getElementById(RX_PRINT_ROOT_ID)?.parentElement, doc.body);

    finishPrescriptionPrint(doc);
    const modal = doc.querySelector("[data-rx-modal]") as HTMLElement | null;
    assert.equal(modal?.hidden, false);
    assert.equal(doc.getElementById(RX_PRINT_ROOT_ID), null);
    assert.equal(doc.body.classList.contains("printing-rx"), false);
  });

  it("does not call print when the Rx document is missing", async () => {
    const dom = new JSDOM(`<!doctype html><body><div data-rx-modal=""><h3>Prescription Digitally Signed</h3></div></body>`);
    const doc = dom.window.document;
    let calls = 0;
    (doc.defaultView as Window).print = () => {
      calls += 1;
    };
    const didPrint = await printPrescriptionDocument(doc);
    assert.equal(didPrint, false);
    assert.equal(calls, 0);
    assert.equal(preparePrescriptionPrint(doc), false);
    assert.equal(doc.body.textContent?.includes("Prescription Digitally Signed"), true);
  });

  it("waits for a signature image before printing", async () => {
    const doc = rxPage();
    const root = doc.createElement("div");
    const img = doc.createElement("img");
    img.alt = "Dr. Vikram Malhotra signature";
    let complete = false;
    Object.defineProperty(img, "complete", { configurable: true, get: () => complete });
    root.appendChild(img);
    let settled = false;
    const pending = waitForPrintAssets(root, doc).then(() => {
      settled = true;
    });
    await Promise.resolve();
    assert.equal(settled, false);
    complete = true;
    const DomEvent = (doc.defaultView as unknown as { Event: new (type: string) => Event }).Event;
    img.dispatchEvent(new DomEvent("load"));
    await pending;
    assert.equal(settled, true);
  });

  it("keeps the Rx print stylesheet on A4 and wires every Print control", () => {
    const css = fs.readFileSync(path.join(rootDir, "src/index.css"), "utf8");
    assert.match(css, /@page\s*\{[^}]*size:\s*A4/s);
    assert.match(css, /margin:\s*12mm/);
    assert.match(css, /width:\s*100%/);
    assert.match(css, /box-sizing:\s*border-box/);
    assert.match(css, /page-break-inside:\s*avoid/);
    assert.match(css, /body\.printing-rx > \*:not\(#rx-print-root\)/);
    assert.match(css, /\[data-rx-modal\]/);
    const writer = fs.readFileSync(path.join(rootDir, "src/components/PrescriptionWriter.tsx"), "utf8");
    assert.match(writer, /data-rx-document/);
    assert.match(writer, /data-rx-modal/);
    assert.match(writer, /printPrescriptionDocument\(document\)/);
    assert.equal(writer.includes("window.print()"), false);
    assert.equal(writer.includes("| Tel:"), false);
    assert.equal(writer.includes("Web: {clinicSettings.website} | Email:"), false);
    assert.match(writer, /joinPresent\(/);
    assert.match(writer, /No medicines prescribed/);
    assert.match(writer, /data-rx-has-content=\{riskLevel \? "true" : "false"\}/);
    assert.match(writer, /data-rx-signature/);
    assert.match(writer, /data-rx-meds/);
    assert.match(writer, /Print Paper Rx/);
    assert.match(writer, /Print Prescription/);
    assert.match(writer, /Print Rx/);
  });
});

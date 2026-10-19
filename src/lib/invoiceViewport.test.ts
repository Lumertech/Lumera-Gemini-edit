import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const chrome = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find((bin) =>
  fs.existsSync(bin)
);

function invoiceCss(): string {
  const css = fs.readFileSync(path.join(rootDir, "src/index.css"), "utf8");
  const start = css.indexOf(".invoice-fit {");
  assert.ok(start >= 0, "invoice fit rules missing");
  return css.slice(start);
}

describe("invoice detail phone width", () => {
  it("wraps the bill chrome instead of letting a toolbar widen the page", () => {
    const source = fs.readFileSync(path.join(rootDir, "src/components/BillingManager.tsx"), "utf8");
    assert.match(source, /className="invoice-fit /);
    assert.match(source, /className="invoice-chip /);
    assert.match(source, /className="invoice-title /);
    assert.match(source, /className="invoice-number /);
    assert.match(source, /className="invoice-pills /);
    assert.match(source, /className="invoice-tabs /);
    assert.match(source, /className="invoice-actions"/);
    assert.match(source, /className="invoice-collect /);
    const css = invoiceCss();
    assert.match(css, /\.invoice-tabs\s*\{[^}]*overflow-x:\s*auto/s);
    assert.match(css, /\.invoice-title[\s\S]*overflow-wrap:\s*anywhere/);
    assert.match(css, /\.invoice-pills\s*\{[^}]*flex-wrap:\s*wrap/s);
    assert.match(css, /\.invoice-actions\s*>\s*\.invoice-collect[\s\S]*width:\s*100%/);
  });

  it("keeps the invoice shell inside a 360px viewport", async (t) => {
    if (!chrome) {
      t.skip("chrome is not installed");
      return;
    }
    const htmlPath = path.join(os.tmpdir(), "lumera-invoice-360.html");
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html, body { margin: 0; padding: 0; }
      .invoice-fit { width: 360px !important; max-width: 360px !important; }
      ${invoiceCss()}
    </style></head><body>
      <div class="invoice-fit" data-testid="invoice-detail">
        <p class="invoice-chip">Multi-Specialty Billing · Consult + pharmacy · WHO-EML / pharmacy</p>
        <h1 class="invoice-title">Multi-Specialty Billing, Therapy Packages &amp; Batch Inventory</h1>
        <span class="invoice-number">INV-2026-658446</span>
        <div class="invoice-pills">
          <span>Paid 0</span>
          <span>Collected ₹0.00</span>
          <span>Due 1 · ₹600.00</span>
        </div>
        <div class="invoice-actions">
          <div class="invoice-tabs">
            <button type="button">Tax Invoice</button>
            <button type="button">Pharmacy Batches</button>
            <button type="button">Rehab Packages</button>
          </div>
          <button class="invoice-collect" type="button">Collect Payment</button>
          <button class="invoice-print" type="button">Print</button>
        </div>
      </div>
      <script>
        const fit = document.querySelector(".invoice-fit");
        const box = fit.getBoundingClientRect();
        const tabs = fit.querySelector(".invoice-tabs");
        const offenders = [...fit.querySelectorAll("*")].filter((el) => {
          if (tabs && tabs.contains(el) && el !== tabs) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.right > box.right + 1;
        }).map((el) => el.className || el.tagName);
        document.documentElement.dataset.scroll = String(fit.scrollWidth);
        document.documentElement.dataset.inner = String(fit.clientWidth);
        document.documentElement.dataset.offenders = offenders.join("|");
      </script>
    </body></html>`;
    fs.writeFileSync(htmlPath, html);
    const dumped = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        chrome,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-sandbox",
          "--window-size=360,800",
          "--virtual-time-budget=2000",
          "--dump-dom",
          `file://${htmlPath}`,
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk) => {
        out += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        err += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) reject(new Error(err || `chrome exited ${code}`));
        else resolve(out);
      });
    });
    const scroll = Number(dumped.match(/data-scroll="(\d+)"/)?.[1]);
    const inner = Number(dumped.match(/data-inner="(\d+)"/)?.[1]);
    const offenders = dumped.match(/data-offenders="([^"]*)"/)?.[1] || "";
    assert.ok(inner > 0 && inner <= 360, `viewport width ${inner}`);
    assert.ok(scroll <= inner, `scrollWidth ${scroll} > innerWidth ${inner}`);
    assert.equal(offenders, "");
  });
});

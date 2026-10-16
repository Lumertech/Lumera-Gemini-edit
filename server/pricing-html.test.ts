import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { startTestServer } from "./test-http.ts";
import { publicPlansResponse } from "./pricing-catalog.ts";
import {
  attachPublicPricingHtml,
  pricingCssOverflowProblems,
  renderPricingDocumentHtml,
  renderRefundPolicyHtml,
} from "./pricing-html.ts";
import { isDedicatedPublicHtmlPath, isSpaHistoryFallbackPath } from "./spa-fallback.ts";
import { WHATSAPP_BILLED_BY_META } from "../src/lib/pricingCopy.ts";

const BANNED = /wallet|top-up|top up|messaging credit|launch offer|pilot|free WhatsApp|HIPAA|DPDP compliant|Meta certified|Meta partner|auto-debited/i;

function chromeBin(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/local/bin/google-chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function measureViewport(
  url: string,
  width: number,
  height: number
): Promise<{ scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number }> {
  const bin = chromeBin();
  if (!bin) throw new Error("chrome missing");
  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lumera-pricing-chrome-"));
  const proc: ChildProcess = spawn(
    bin,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--user-data-dir=${profile}`,
      "--remote-allow-origins=*",
      `--remote-debugging-port=${port}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    let browserWs = "";
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) {
          const body = (await res.json()) as { webSocketDebuggerUrl: string };
          browserWs = body.webSocketDebuggerUrl;
          break;
        }
      } catch {
        /* chrome still booting */
      }
      await sleep(100);
    }
    if (!browserWs) throw new Error("chrome debugging port did not open");

    const browser = new WebSocket(browserWs);
    await new Promise<void>((resolve, reject) => {
      browser.addEventListener("open", () => resolve());
      browser.addEventListener("error", () => reject(new Error("browser websocket failed")));
    });
    let nextId = 0;
    const pending = new Map<number, (value: unknown) => void>();
    browser.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)!(message.result);
        pending.delete(message.id);
      }
    });
    const send = (method: string, params?: object) =>
      new Promise<unknown>((resolve) => {
        const id = ++nextId;
        pending.set(id, resolve);
        browser.send(JSON.stringify({ id, method, params }));
      });
    const created = (await send("Target.createTarget", { url: "about:blank" })) as { targetId: string };
    let pageWs = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
        id: string;
        webSocketDebuggerUrl: string;
      }>;
      pageWs = list.find((target) => target.id === created.targetId)?.webSocketDebuggerUrl || "";
      if (pageWs) break;
      await sleep(50);
    }
    if (!pageWs) throw new Error("page target missing");
    const page = new WebSocket(pageWs);
    await new Promise<void>((resolve, reject) => {
      page.addEventListener("open", () => resolve());
      page.addEventListener("error", () => reject(new Error("page websocket failed")));
    });
    let pageId = 0;
    const pagePending = new Map<number, (value: unknown) => void>();
    const pageEvents: string[] = [];
    page.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; method?: string };
      if (message.method) pageEvents.push(message.method);
      if (message.id && pagePending.has(message.id)) {
        pagePending.get(message.id)!(message.result);
        pagePending.delete(message.id);
      }
    });
    const call = (method: string, params?: object) =>
      new Promise<unknown>((resolve) => {
        const id = ++pageId;
        pagePending.set(id, resolve);
        page.send(JSON.stringify({ id, method, params }));
      });
    await call("Page.enable");
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await call("Page.navigate", { url });
    for (let attempt = 0; attempt < 40 && !pageEvents.includes("Page.loadEventFired"); attempt += 1) {
      await sleep(100);
    }
    const evaluated = (await call("Runtime.evaluate", {
      expression:
        "({scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight})",
      returnByValue: true,
    })) as { result?: { value?: { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number } } };
    page.close();
    browser.close();
    const value = evaluated.result?.value;
    if (!value) throw new Error("viewport measurement missing");
    return value;
  } finally {
    proc.kill();
    await sleep(200);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await sleep(100);
      }
    }
  }
}

describe("public /pricing HTML", () => {
  it("is dedicated server HTML, not the SPA shell", () => {
    assert.equal(isSpaHistoryFallbackPath("/pricing"), false);
    assert.equal(isSpaHistoryFallbackPath("/refund-policy"), false);
    assert.equal(isDedicatedPublicHtmlPath("/pricing"), true);
    assert.equal(isDedicatedPublicHtmlPath("/refund-policy"), true);
  });

  it("serves crawler-readable prices, trial terms, and WhatsApp copy without JavaScript", async () => {
    const server = await startTestServer((mounted) => {
      mounted.get("/api/public/plans", (_req, res) => {
        res.json(publicPlansResponse());
      });
      attachPublicPricingHtml(mounted);
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/pricing`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") || "", /text\/html/);
      const html = await res.text();
      assert.match(html, /<title>Pricing · Lumera<\/title>/);
      assert.match(html, /data-testid="pricing-page"/);
      assert.match(html, /₹17,999/);
      assert.match(html, /₹1,999/);
      assert.match(html, /₹59,999/);
      assert.match(html, /₹6,699/);
      assert.match(html, /₹21,238\.82/);
      assert.match(html, /₹2,358\.82/);
      assert.match(html, /₹70,798\.82/);
      assert.match(html, /₹7,904\.82/);
      assert.match(html, /Save ₹5,989\/yr/);
      assert.match(html, /Save ₹20,389\/yr/);
      assert.match(html, /₹9,999\/yr/);
      assert.match(html, /₹1,099\/mo/);
      assert.match(html, /15 doctors/);
      assert.match(html, /All prices are exclusive of GST/);
      assert.match(html, /7-day refund window/);
      assert.match(html, /15 business days/);
      assert.match(html, /days 20, 25, 28 and 30/);
      assert.match(html, /read-only on day 31/);
      assert.match(html, /nothing is charged/);
      const whatsappHtml = WHATSAPP_BILLED_BY_META.replace(/&/g, "&amp;").replace(/'/g, "&#39;");
      assert.ok(html.includes(whatsappHtml), "exact WhatsApp copy missing");
      assert.match(html, /INR payment method/);
      assert.match(html, /trademarks of their respective owners/);
      assert.match(html, /href="\/signup\?plan=individual&amp;cycle=annual"/);
      assert.match(html, /href="\/signup\?plan=polyclinic&amp;cycle=monthly"/);
      assert.match(html, /Doctor and receptionist/);
      assert.match(html, /up to 5 doctors/);
      assert.match(html, /ravee@lumer\.me/);
      assert.doesNotMatch(html, BANNED);
      assert.doesNotMatch(html, /<script/i);
      const api = await fetch(`http://127.0.0.1:${server.port}/api/public/plans`);
      const json = (await api.json()) as { plans: Array<{ annualPaise: number }> };
      assert.equal(json.plans[0].annualPaise, 1799900);
      const refund = await fetch(`http://127.0.0.1:${server.port}/refund-policy`);
      assert.equal(refund.status, 200);
      assert.match(await refund.text(), /7-day refund window/);
    } finally {
      await server.close();
    }
  });

  it("omits the Polyclinic monthly price when the flag is off", () => {
    const html = renderPricingDocumentHtml(
      publicPlansResponse({ PRICING_POLYCLINIC_MONTHLY_ENABLED: "0" } as NodeJS.ProcessEnv)
    );
    assert.doesNotMatch(html, /₹6,699/);
    assert.match(html, /Monthly billing: contact us \(ravee@lumer\.me\)/);
    assert.match(html, /₹59,999/);
    assert.match(renderRefundPolicyHtml(), /GST credit note/);
  });

  it("keeps the pricing stylesheet from forcing a horizontal scroll", () => {
    const html = renderPricingDocumentHtml();
    const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || "";
    assert.deepEqual(pricingCssOverflowProblems(css), []);
    assert.match(css, /overflow-x:\s*hidden/);
    assert.match(css, /grid-template-columns:\s*1fr;/);
  });

  it("has no horizontal overflow at 360px", async (t) => {
    if (!chromeBin()) {
      t.skip("chrome is not installed");
      return;
    }
    const server = await startTestServer((mounted) => {
      attachPublicPricingHtml(mounted);
    });
    try {
      const box = await measureViewport(`http://127.0.0.1:${server.port}/pricing`, 360, 800);
      assert.ok(box.scrollWidth <= box.clientWidth + 1, `horizontal overflow ${box.scrollWidth} > ${box.clientWidth}`);
      assert.ok(box.scrollHeight > box.clientHeight, "page should scroll vertically on a phone");
    } finally {
      await server.close();
    }
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("usage wallet is not a clinic product", () => {
  it("does not read or enforce wallet balance for AI Scribe or WhatsApp", () => {
    const usage = read("server/usage-billing.ts");
    const graph = read("server/graph-whatsapp.ts");
    const meter = read("server/gemini-scribe-meter.ts");
    assert.equal(/publicWalletStatus\(/.test(usage), false);
    assert.equal(/applyWalletTransaction\(/.test(usage), false);
    assert.equal(/getMarkupPercent\(/.test(usage), false);
    assert.match(usage, /return \{ ok: true \}/);
    assert.doesNotMatch(graph, /assertWalletAllowsDebit|getMarkupPercent|publicWalletStatus/);
    assert.doesNotMatch(meter, /WALLET_INSUFFICIENT|publicWalletStatus|Top up now/);
    assert.match(meter, /blockedAiScribeResponse/);
    assert.match(meter, /return null/);
  });

  it("does not mount the clinic banner or top-up, and those components do not fetch the wallet", () => {
    const app = read("src/App.tsx");
    const banner = read("src/components/WalletStatusBanner.tsx");
    const topup = read("src/components/WalletTopupPanel.tsx");
    assert.doesNotMatch(app, /WalletStatusBanner|WalletTopupPanel/);
    assert.doesNotMatch(banner, /\/api\/wallet|topUpPrompt|Usage wallet is empty/);
    assert.doesNotMatch(topup, /\/api\/wallet|sandbox-topup|Top up/);
  });

  it("leaves subscription trial setup in place", () => {
    const api = read("server/api.ts");
    assert.match(api, /trialEndsAt/);
    assert.match(api, /status: "trial"/);
  });
});

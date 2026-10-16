import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { annualApprovalCopy, monthlyAutopayCopy, quoteFor, trialIntro } from "../lib/pricingModel.ts";
import { publicPlansResponse } from "../../server/pricing-catalog.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const login = fs.readFileSync(path.join(here, "LoginPage.tsx"), "utf8");
const panel = fs.readFileSync(path.join(here, "../components/TrialTermsPanel.tsx"), "utf8");

describe("try-for-free trial terms before AutoPay", () => {
  it("states the locked trial copy and keeps the mandate step behind an explicit click", () => {
    const plans = publicPlansResponse();
    const annual = quoteFor(plans, "individual", "annual");
    const monthly = quoteFor(plans, "individual", "monthly");
    const intro = trialIntro("Individual", "annual", "13 November 2026");
    assert.match(intro, /30 days free\. No card needed for Lumera\./);
    assert.match(intro, /days 20, 25, 28 and 30/);
    assert.match(intro, /read-only on day 31/);
    assert.match(intro, /nothing is charged/);
    assert.match(intro, /Read-only clinics can still reply to patients on WhatsApp manually within Meta's 24-hour window/);
    assert.match(monthlyAutopayCopy("Individual", monthly, "14 November 2026"), /Set up AutoPay now \(₹0 today\)/);
    assert.match(monthlyAutopayCopy("Individual", monthly, "14 November 2026"), /₹2,358\.82/);
    assert.doesNotMatch(monthlyAutopayCopy("Individual", monthly, "14 November 2026"), /auto-debited/);
    assert.match(annualApprovalCopy(annual, "14 November 2026"), /renews with your approval/);
    assert.match(annualApprovalCopy(annual, "14 November 2026"), /UPI PIN or card OTP/);
    assert.match(annualApprovalCopy(annual, "14 November 2026"), /7-day refund window/);
    assert.match(panel, /data-testid="trial-terms"/);
    assert.match(panel, /data-testid="autopay-step"/);
    assert.ok(panel.indexOf('data-testid="trial-terms"') < panel.indexOf('data-testid="autopay-step"'));
    assert.match(panel, /showMandateStep && quote/);
    assert.match(login, /const \[showMandateStep, setShowMandateStep\] = useState\(false\)/);
    assert.match(login, /<TrialTermsPanel/);
    assert.ok(login.indexOf("<TrialTermsPanel") < login.indexOf('data-testid="add-payment-method"'));
    assert.match(login, /Start free trial/);
    assert.match(login, /Add payment method now/);
    assert.match(login, /Skip for now/);
    assert.doesNotMatch(login, /auto-debited/);
    assert.doesNotMatch(panel, /card number|cvv|wallet|messaging credit/i);
  });
});
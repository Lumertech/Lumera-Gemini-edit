import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { publicPlansResponse } from "../../server/pricing-catalog.ts";
import {
  annualSavingPaise,
  billingSelectionFromSearch,
  buildPricingPageModel,
  exclusiveGstLine,
  formatInrPaise,
  gstOnPaise,
  quoteFor,
  trialIntro,
  trialSchedule,
} from "./pricingModel.ts";
import { WHATSAPP_BILLED_BY_META } from "./pricingCopy.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("pricing money format", () => {
  it("formats locked plan prices with en-IN grouping and GST totals", () => {
    const plans = publicPlansResponse();
    assert.equal(formatInrPaise(1799900), "₹17,999");
    assert.equal(formatInrPaise(199900), "₹1,999");
    assert.equal(formatInrPaise(5999900), "₹59,999");
    assert.equal(formatInrPaise(669900), "₹6,699");
    assert.equal(formatInrPaise(999900), "₹9,999");
    assert.equal(formatInrPaise(109900), "₹1,099");
    assert.equal(exclusiveGstLine(1799900, plans.gstRateBps, "yr"), "₹17,999 + 18% GST = ₹21,238.82/yr");
    assert.equal(exclusiveGstLine(199900, plans.gstRateBps, "mo"), "₹1,999 + 18% GST = ₹2,358.82/mo");
    assert.equal(exclusiveGstLine(5999900, plans.gstRateBps, "yr"), "₹59,999 + 18% GST = ₹70,798.82/yr");
    assert.equal(exclusiveGstLine(669900, plans.gstRateBps, "mo"), "₹6,699 + 18% GST = ₹7,904.82/mo");
    assert.equal(annualSavingPaise(199900, 1799900), 598900);
    assert.equal(formatInrPaise(annualSavingPaise(199900, 1799900)), "₹5,989");
    assert.equal(formatInrPaise(annualSavingPaise(669900, 5999900)), "₹20,389");
    assert.equal(gstOnPaise(1799900, 1800).totalPaise, 2123882);
  });

  it("builds the public page from the catalog, including the extra-doctor cap", () => {
    const model = buildPricingPageModel(publicPlansResponse());
    assert.match(model.cards[0].annualDetail, /₹17,999 \+ 18% GST = ₹21,238\.82\/yr/);
    assert.match(model.cards[1].monthlyDetail || "", /₹6,699 \+ 18% GST = ₹7,904\.82\/mo/);
    assert.match(model.cards[0].saving, /₹5,989/);
    assert.match(model.cards[1].saving, /₹20,389/);
    assert.match(model.extraDoctor, /₹9,999\/yr/);
    assert.match(model.extraDoctor, /₹1,099\/mo/);
    assert.match(model.extraDoctor, /15 doctors/);
    assert.match(model.extraDoctor, /16th/);
    assert.match(model.extraDoctor, /ravee@lumer\.me/);
    assert.equal(model.whatsapp, WHATSAPP_BILLED_BY_META);
    assert.match(model.whatsappInr, /INR payment method/);
    assert.match(model.trial, /days 20, 25, 28 and 30/);
    assert.match(model.trial, /read-only on day 31/);
    assert.match(model.refund, /7-day refund window/);
    assert.match(model.refund, /15 business days/);
    assert.doesNotMatch(JSON.stringify(model), /wallet|top-up|messaging credit|launch offer|pilot funding|HIPAA/i);
  });

  it("hides the Polyclinic monthly price when the flag is off", () => {
    const plans = publicPlansResponse({ PRICING_POLYCLINIC_MONTHLY_ENABLED: "0" } as NodeJS.ProcessEnv);
    const model = buildPricingPageModel(plans);
    const poly = model.cards.find((card) => card.code === "polyclinic");
    assert.equal(poly?.monthlyDetail, null);
    assert.match(poly?.monthlyFallback || "", /Monthly billing: contact us \(ravee@lumer\.me\)/);
    assert.match(quoteFor(plans, "polyclinic", "monthly").line, /₹59,999/);
  });

  it("reads plan and cycle from the signup query and ignores other practice keys", () => {
    assert.deepEqual(billingSelectionFromSearch("?plan=polyclinic&cycle=monthly"), {
      plan: "polyclinic",
      cycle: "monthly",
    });
    assert.deepEqual(billingSelectionFromSearch("?practice=polyclinic&practiceType=multispecialty"), {
      plan: "individual",
      cycle: "annual",
    });
    assert.equal(trialSchedule(new Date(Date.UTC(2026, 9, 15, 6, 30))).trialEndLabel, "13 November 2026");
    assert.equal(trialSchedule(new Date(Date.UTC(2026, 9, 15, 6, 30))).day31Label, "14 November 2026");
    assert.match(trialIntro("Individual", "annual", "13 November 2026"), /11:59 pm IST on 13 November 2026/);
    assert.match(trialIntro("Individual", "annual", "13 November 2026"), /days 20, 25, 28 and 30/);
  });

  it("keeps rupee amounts out of the client pricing sources", () => {
    const files = [
      "src/lib/pricingModel.ts",
      "src/lib/pricingCopy.ts",
      "src/pages/PricingPage.tsx",
      "src/components/TrialTermsPanel.tsx",
      "src/pages/LoginPage.tsx",
      "src/components/LandingPage.tsx",
    ];
    const banned = ["17999", "17,999", "59999", "59,999", "6,699", "9,999", "1,099", "21,238", "70,798"];
    for (const file of files) {
      const text = fs.readFileSync(path.join(root, file), "utf8");
      for (const token of banned) {
        assert.equal(text.includes(token), false, `${file} must not hardcode ${token}`);
      }
    }
  });
});

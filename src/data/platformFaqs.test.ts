import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../auth/AuthContext.tsx";
import { NavigationProvider } from "../nav/NavigationContext.tsx";
import { LandingPage } from "../components/LandingPage.tsx";
import {
  FAQ_CATEGORIES,
  PLATFORM_FAQS,
  WHATSAPP_LINKING_JOURNEY_STEPS,
  WHATSAPP_NUMBER_OPTIONS,
  WHATSAPP_SETUP_FAQS,
  buildFaqPageJsonLd,
} from "./platformFaqs.ts";

describe("Platform & WhatsApp Linking FAQ section", () => {
  it("covers all 6 use-case categories and populates WhatsApp setup FAQs", () => {
    assert.equal(FAQ_CATEGORIES.length, 6);
    for (const cat of FAQ_CATEGORIES) {
      const matches = PLATFORM_FAQS.filter((item) => item.category === cat.id);
      assert.ok(matches.length >= 1, `Expected >= 1 FAQ in category ${cat.id}`);
    }
    assert.ok(WHATSAPP_SETUP_FAQS.length >= 5, "Expected >= 5 contextual WhatsApp setup FAQs");
    assert.equal(WHATSAPP_NUMBER_OPTIONS.length, 3);
  });

  it("explains existing WhatsApp number rules, Meta virtual numbers, landlines, and 2FA PINs", () => {
    const existingNumberFaq = PLATFORM_FAQS.find((f) => f.id === "wa-existing-number");
    assert.ok(existingNumberFaq);
    const fullExistingText = [existingNumberFaq.answer, ...(existingNumberFaq.bullets || [])].join(" ");
    assert.match(fullExistingText, /personal WhatsApp Messenger/i);
    assert.match(fullExistingText, /new mobile\/landline|New SIM/i);
    assert.match(fullExistingText, /virtual/i);
    assert.match(fullExistingText, /Coexistence/i);

    const virtualFaq = PLATFORM_FAQS.find((f) => f.id === "wa-virtual-number");
    assert.ok(virtualFaq);
    const fullVirtualText = [virtualFaq.answer, ...(virtualFaq.bullets || [])].join(" ");
    assert.match(fullVirtualText, /Meta Business Portfolio/i);
    assert.match(fullVirtualText, /verified|verification/i);

    const landlineFaq = PLATFORM_FAQS.find((f) => f.id === "wa-landline-number");
    assert.ok(landlineFaq);
    assert.match([landlineFaq.answer, ...(landlineFaq.bullets || [])].join(" "), /Phone Call/i);

    const sharedMobileFaq = PLATFORM_FAQS.find((f) => f.id === "shared-mobile-multi-pet-child-family");
    assert.ok(sharedMobileFaq);
    assert.match(sharedMobileFaq.question, /multiple pets.*multiple children.*family member/i);
  });

  it("generates Schema.org FAQPage JSON-LD and renders on LandingPage", () => {
    const jsonLd = buildFaqPageJsonLd();
    assert.equal(jsonLd["@context"], "https://schema.org");
    assert.equal(jsonLd["@type"], "FAQPage");
    assert.equal(jsonLd.mainEntity.length, PLATFORM_FAQS.length);

    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/"] },
        React.createElement(
          AuthProvider,
          null,
          React.createElement(NavigationProvider, null, React.createElement(LandingPage))
        )
      )
    );
    assert.match(html, /data-testid="landing-faq"/);
    assert.match(html, /data-testid="landing-footer-faq"/);
    assert.match(html, /data-testid="platform-faq-section"/);
    assert.match(html, /data-testid="whatsapp-number-options-matrix"/);
    assert.match(html, /data-testid="whatsapp-linking-journey-steps"/);
    assert.equal(WHATSAPP_LINKING_JOURNEY_STEPS.length, 6);
    for (let step = 1; step <= 6; step++) {
      assert.match(html, new RegExp(`data-testid="wa-journey-step-${step}"`));
    }
    assert.match(html, /application\/ld\+json/);
  });
});


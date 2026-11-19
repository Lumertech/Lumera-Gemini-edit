import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { GoogleGenAI } from "@google/genai";
import { getDb, initDatabase } from "./db.ts";
import { dispatchInboundBotReply, recordInboundWhatsAppMessage } from "./meta.ts";
import { setVertexClientForTests } from "./vertex-gemini.ts";
import { processBotActionOrQuery } from "./whatsapp.ts";
import {
  detectExplicitWhatsAppLanguageRequest,
  hasSubstantialEnglishLeakage,
  LOCALIZED_BUTTONS,
} from "./whatsapp-localization.ts";

function stripAllowedCodesAndUrls(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\/api\/\S+/gi, "")
    .replace(/\b(?:RX|LUM|UHID)[-\w]*/gi, "");
}

describe("Maya WhatsApp full Hindi & Marathi textual localization", () => {
  const tenantId = "tenant-lumera-main";
  const hiPhone = "+919877711101";
  const mrPhone = "+919877711102";

  const savedTokens: Record<string, string | undefined> = {};
  const origFetch = globalThis.fetch;

  before(() => {
    for (const k of ["META_ACCESS_TOKEN", "WHATSAPP_ACCESS_TOKEN"]) {
      savedTokens[k] = process.env[k];
      delete process.env[k];
    }
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("graph.facebook.com")) {
        return new Response(JSON.stringify({ messages: [{ id: "wamid.mock.local.1" }] }), { status: 200 });
      }
      return origFetch(input, init);
    }) as typeof fetch;
    try {
      getDb();
    } catch {
      initDatabase();
    }
  });

  after(() => {
    globalThis.fetch = origFetch;
    for (const [k, v] of Object.entries(savedTokens)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    setVertexClientForTests(undefined);
    try {
      const db = getDb();
      db.prepare("DELETE FROM whatsapp_messages WHERE patient_phone IN (?, ?)").run(hiPhone, mrPhone);
      db.prepare("DELETE FROM whatsapp_conversations WHERE patient_phone IN (?, ?)").run(hiPhone, mrPhone);
      db.prepare("DELETE FROM appointments WHERE patient_phone IN (?, ?)").run(hiPhone, mrPhone);
    } catch {
      /* ignore */
    }
  });

  it("keeps all localized Hindi and Marathi quick-reply button labels <= 20 UTF-16 chars for Meta Cloud API", () => {
    for (const [key, label] of Object.entries(LOCALIZED_BUTTONS.hi)) {
      assert.ok(label.length <= 20, `Hindi button ${key} ("${label}") exceeds 20 chars (${label.length})`);
      assert.equal(/[A-Za-z]/.test(label), false, `Hindi button ${key} ("${label}") must not contain English letters`);
    }
    for (const [key, label] of Object.entries(LOCALIZED_BUTTONS.mr)) {
      assert.ok(label.length <= 20, `Marathi button ${key} ("${label}") exceeds 20 chars (${label.length})`);
      assert.equal(/[A-Za-z]/.test(label), false, `Marathi button ${key} ("${label}") must not contain English letters`);
    }
  });

  it("detects explicit Hindi, Marathi, and English language requests in Roman and Devanagari", () => {
    assert.equal(detectExplicitWhatsAppLanguageRequest("talk in hindi"), "hi");
    assert.equal(detectExplicitWhatsAppLanguageRequest("Hindi mein baat karo"), "hi");
    assert.equal(detectExplicitWhatsAppLanguageRequest("हिंदी में बात करो"), "hi");
    assert.equal(detectExplicitWhatsAppLanguageRequest("Hindi"), "hi");

    assert.equal(detectExplicitWhatsAppLanguageRequest("speak in Marathi"), "mr");
    assert.equal(detectExplicitWhatsAppLanguageRequest("Marathi madhe bola"), "mr");
    assert.equal(detectExplicitWhatsAppLanguageRequest("मराठीत बोला"), "mr");
    assert.equal(detectExplicitWhatsAppLanguageRequest("मराठी"), "mr");

    assert.equal(detectExplicitWhatsAppLanguageRequest("talk in English"), "en");
    assert.equal(detectExplicitWhatsAppLanguageRequest("इंग्रजीत बोला"), "en");
  });

  it("responds 100% in Hindi across multi-turn WhatsApp flow when user asks for Hindi", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const rec = recordInboundWhatsAppMessage(db, {
      fromPhone: hiPhone,
      textBody: "Hindi mein baat karo",
      tenantId,
      phoneNumberId: "1294483843748285",
      wabaId: "waba_main",
      now,
    });
    assert.ok(rec?.convId);

    const conv = db.prepare("SELECT * FROM whatsapp_conversations WHERE id = ?").get(rec.convId) as Record<string, unknown>;
    assert.equal(conv.preferred_language, "hi");

    // Turn 1: Language switch greeting
    const r1 = await processBotActionOrQuery("Hindi mein baat karo", hiPhone, "Patient", conv, db, { tenantId });
    assert.ok(r1);
    assert.match(r1.content, /हिन्दी/);
    assert.equal(/[A-Za-z]/.test(stripAllowedCodesAndUrls(r1.content)), false, `Unexpected English in Hindi greeting:\n${r1.content}`);
    assert.ok(r1.buttons && r1.buttons.every((b) => !/[A-Za-z]/.test(b)));

    // Turn 2: Tap Hindi schedule button -> 100% Hindi doctor roster & buttons
    const r2 = await processBotActionOrQuery("⏰ डॉक्टर समय", hiPhone, "Patient", conv, db, { tenantId });
    assert.ok(r2);
    assert.match(r2.content, /ओपीडी डॉक्टर समय सारणी/);
    assert.equal(/[A-Za-z]/.test(stripAllowedCodesAndUrls(r2.content)), false, `Unexpected English in Hindi roster:\n${r2.content}`);
    assert.doesNotMatch(r2.content, /\b(Room|Fee|Timings|Emergency care)\b/i);
    assert.ok(r2.buttons && r2.buttons.length > 0);
    assert.ok(r2.buttons.every((b) => b.startsWith("बुक:") && b.length <= 20));

    // Turn 3: Tap Hindi book button -> 100% Hindi booking confirmation
    const r3 = await processBotActionOrQuery(r2.buttons[0], hiPhone, "रवि", conv, db, { tenantId });
    assert.ok(r3);
    assert.match(r3.content, /अपॉइंटमेंट की पुष्टि हो गई|पूर्व-सक्रिय बुकिंग/);
    assert.match(r3.content, /टोकन संख्या/);
    assert.equal(/[A-Za-z]/.test(stripAllowedCodesAndUrls(r3.content)), false, `Unexpected English in Hindi booking:\n${r3.content}`);
    assert.ok(r3.buttons && r3.buttons.every((b) => !/[A-Za-z]/.test(b)));

    // Turn 4: Tap Hindi queue button -> 100% Hindi queue status
    const r4 = await processBotActionOrQuery("🎫 कतार स्थिति", hiPhone, "रवि", conv, db, { tenantId });
    assert.ok(r4);
    assert.match(r4.content, /टोकन एवं कतार स्थिति/);
    assert.equal(/[A-Za-z]/.test(stripAllowedCodesAndUrls(r4.content)), false, `Unexpected English in Hindi queue:\n${r4.content}`);

    // Turn 5: Tap Hindi cancel button -> 100% Hindi cancellation
    const r5 = await processBotActionOrQuery("❌ बुकिंग रद्द करें", hiPhone, "रवि", conv, db, { tenantId });
    assert.ok(r5);
    assert.match(r5.content, /रद्द/);
    assert.equal(/[A-Za-z]/.test(stripAllowedCodesAndUrls(r5.content)), false);
  });

  it("responds 100% in idiomatic Marathi across multi-turn WhatsApp flow when user asks for Marathi", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const rec = recordInboundWhatsAppMessage(db, {
      fromPhone: mrPhone,
      textBody: "Please talk in Marathi",
      tenantId,
      phoneNumberId: "1294483843748285",
      wabaId: "waba_main",
      now,
    });
    assert.ok(rec?.convId);

    const conv = db.prepare("SELECT * FROM whatsapp_conversations WHERE id = ?").get(rec.convId) as Record<string, unknown>;
    assert.equal(conv.preferred_language, "mr");

    // Turn 1: Marathi switch confirmation
    const r1 = await processBotActionOrQuery("Please talk in Marathi", mrPhone, "Patient", conv, db, { tenantId });
    assert.ok(r1);
    assert.match(r1.content, /मराठीत/);
    assert.match(r1.content, /नमस्कार/);
    assert.equal(/[A-Za-z]/.test(stripAllowedCodesAndUrls(r1.content)), false, `Unexpected English in Marathi greeting:\n${r1.content}`);
    assert.ok(r1.buttons && r1.buttons.every((b) => !/[A-Za-z]/.test(b)));

    // Turn 2: Combined English query while locked to Marathi (or explicit "in Marathi") -> 100% Marathi location
    const r2 = await processBotActionOrQuery("Tell me clinic address in Marathi", mrPhone, "Patient", conv, db, { tenantId });
    assert.ok(r2);
    assert.match(r2.content, /पत्ता आणि दिशा/);
    assert.equal(/[A-Za-z]/.test(stripAllowedCodesAndUrls(r2.content)), false, `Unexpected English in Marathi location:\n${r2.content}`);
    assert.ok(r2.buttons && r2.buttons.every((b) => !/[A-Za-z]/.test(b)));

    // Turn 3: Marathi intake & booking flow
    const r3 = await processBotActionOrQuery("📅 अपॉइंटमेंट बुक", mrPhone, "Patient", conv, db, { tenantId });
    assert.ok(r3);
    assert.match(r3.content, /तपासणीपूर्वी प्राथमिक माहिती/);
    assert.equal(/[A-Za-z]/.test(stripAllowedCodesAndUrls(r3.content)), false);

    // Turn 4: Patient gives Marathi intake details -> specialist recommended in Marathi
    const reloadedConv = db.prepare("SELECT * FROM whatsapp_conversations WHERE id = ?").get(rec.convId) as Record<string, unknown>;
    const r4 = await processBotActionOrQuery("माझे नाव रोहन कुलकर्णी, वय ३८, कंबरदुखी आहे", mrPhone, "रोहन", reloadedConv, db, { tenantId });
    assert.ok(r4);
    assert.match(r4.content, /उपलब्ध ओपीडी स्लॉट्स/);
    assert.match(r4.content, /दालन क्र\./);
    assert.equal(/[A-Za-z]/.test(stripAllowedCodesAndUrls(r4.content)), false, `Unexpected English in Marathi intake slots:\n${r4.content}`);

    // Turn 5: Confirm with short "हो" -> stays locked in Marathi and books!
    const reloadedConv2 = db.prepare("SELECT * FROM whatsapp_conversations WHERE id = ?").get(rec.convId) as Record<string, unknown>;
    const r5 = await processBotActionOrQuery("हो", mrPhone, "रोहन कुलकर्णी", reloadedConv2, db, { tenantId });
    assert.ok(r5);
    assert.match(r5.content, /अपॉइंटमेंट निश्चित झाली आहे|सक्रिय बुकिंग आढळली/);
    assert.equal(/[A-Za-z]/.test(stripAllowedCodesAndUrls(r5.content)), false, `Unexpected English in Marathi booking:\n${r5.content}`);
  });

  it("rewrites mixed English+Indic Gemini triage replies into 100% pure Marathi and localizes buttons", async () => {
    const db = getDb();
    let calls = 0;
    setVertexClientForTests({
      models: {
        generateContent: async () => {
          calls += 1;
          if (calls === 1) {
            // Simulate partial English leakage from first-pass LLM output
            return {
              text: "*Dietary Advice for Diabetes*:\nमधुमेहासाठी साखर टाळा आणि Please walk 30 minutes daily after meals.",
            };
          }
          return {
            text: "*मधुमेहासाठी आहारविषयक सल्ला*:\nमधुमेह नियंत्रणासाठी साखर पूर्णपणे टाळा आणि दररोज जेवणानंतर ३० मिनिटे चालण्याचा व्यायाम करा.",
          };
        },
      },
    } as unknown as GoogleGenAI);

    const conv = { preferred_language: "mr" };
    const reply = await processBotActionOrQuery(
      "माझी शुगर जास्त आली आहे, आहारात काय काळजी घ्यावी?",
      mrPhone,
      "रोहन",
      conv,
      db,
      { tenantId }
    );

    assert.ok(reply);
    assert.equal(calls, 2, "Should trigger strict Marathi rewrite when first pass leaks English");
    assert.equal(/[A-Za-z]/.test(reply.content), false, `Expected 0 English letters, got:\n${reply.content}`);
    assert.ok(reply.buttons && reply.buttons.every((b) => !/[A-Za-z]/.test(b)));

    // Also verify dispatchInboundBotReply stores Marathi reply on webhook pipeline
    const rec = recordInboundWhatsAppMessage(db, {
      fromPhone: mrPhone,
      textBody: "मराठीत सांगा",
      tenantId,
      phoneNumberId: "1294483843748285",
      wabaId: "waba_main",
      now: new Date().toISOString(),
    });
    assert.ok(rec?.convId);
    await dispatchInboundBotReply(db, {
      convId: rec.convId,
      fromPhone: mrPhone,
      textBody: "फीस किती आहे?",
      tenantId,
    });
    const lastBot = db
      .prepare(
        "SELECT content FROM whatsapp_messages WHERE conversation_id = ? AND sender = 'bot' ORDER BY created_at DESC LIMIT 1"
      )
      .get(rec.convId) as { content?: string } | undefined;
    assert.ok(lastBot?.content);
    assert.match(String(lastBot.content), /तपासणी फी/);
    assert.equal(/[A-Za-z]/.test(stripAllowedCodesAndUrls(String(lastBot.content))), false);
  });
});


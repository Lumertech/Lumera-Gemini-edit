import express from "express";
import path from "path";
import { attachUser, requireAuth } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { createWhatsAppNumbersRouter, practitionerLinkMiddleware } from "./whatsapp-numbers-routes.ts";
import { wrapAbdmRegistryJson } from "./abdm-registry-public.ts";
import { createWhatsAppRouter } from "./whatsapp.ts";
import { createUsageBillingRouter } from "./usage-billing-api.ts";
import { createMetaRouter } from "./meta.ts";
import { createAbdmRouter } from "./abdm.ts";
import { attachHttpSecurity } from "./http-security.ts";
import { attachPublicPolicyHtml } from "./policy-html.ts";
import { attachPublicPricingHtml } from "./pricing-html.ts";
import { mountGeminiClinicalRoutes } from "./gemini-clinical.ts";
import { protectWhatsAppDashboard } from "./whatsapp-dashboard-guard.ts";
import { createLiveRegistrationRouter } from "./live-registration-routes.ts";
import { metaWebhookRawBody } from "./meta-security.ts";
import { attachUnknownApiJsonNotFound } from "./spa-fallback.ts";
import { globalJsonParser } from "./json-body.ts";

/**
 * Production Express app without listen() or database boot.
 * Meta webhook raw bytes are captured before the global JSON parser so HMAC is not
 * computed over JSON.stringify(req.body).
 */
export function createLumeraApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  attachHttpSecurity(app);

  // Before the global JSON parser. A later parser sets req._body and would
  // otherwise re-parse (or skip) the stream the signature must cover.
  app.use(metaWebhookRawBody);
  app.use(globalJsonParser());
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.get("/healthz", (_req, res) => {
    res.type("text/plain").send("ok");
  });
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
  app.use(attachUser);
  app.use("/api/gemini", requireAuth);
  app.use("/api/v3", createAbdmRouter());
  app.use("/v3", createAbdmRouter());
  app.use("/api", practitionerLinkMiddleware);
  app.use("/api", createWhatsAppNumbersRouter());
  // Wallet intercepts /whatsapp/send and /whatsapp/send-rx before the inbox router.
  app.use("/api", createUsageBillingRouter());
  // Mount protected inbox before createApiRouter so GitHub's unpatched whatsapp.ts
  // (MCP cannot rewrite the 70KB file) still gets auth + tenant filters.
  app.use("/api/whatsapp", protectWhatsAppDashboard(createWhatsAppRouter()));
  // Own live signup before createApiRouter so api.ts demo-seed fallbacks are dead
  // in dist/server.cjs (esbuild stacks are server.cjs, not api.ts:LINE:COL).
  app.use("/api", createLiveRegistrationRouter());
  app.use("/api", wrapAbdmRegistryJson(createApiRouter()));
  app.use("/meta", createMetaRouter());
  app.post("/data-deletion-callback", (req, res, next) => {
    req.url = "/data-deletion";
    createMetaRouter()(req, res, next);
  });
  attachPublicPolicyHtml(app);
  attachPublicPricingHtml(app);
  mountGeminiClinicalRoutes(app);
  // Unknown /api JSON 404 stays after every API mount. SPA fallback is last, in startServer.
  attachUnknownApiJsonNotFound(app);
  return app;
}

import express, { Request } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { getDb, initDatabase } from "./server/db.ts";
import { startAppointmentReminderScheduler } from "./server/whatsapp-calendar.ts";
import { attachUser, requireAuth } from "./server/auth.ts";
import { createApiRouter } from "./server/api.ts";
import { createWhatsAppNumbersRouter, practitionerLinkMiddleware, bootWhatsAppOwnershipSchema } from "./server/whatsapp-numbers-routes.ts";
import { wrapAbdmRegistryJson } from "./server/abdm-registry-public.ts";
import { createWhatsAppRouter } from "./server/whatsapp.ts";
import { createUsageBillingRouter } from "./server/usage-billing-api.ts";
import { createMetaRouter } from "./server/meta.ts";
import { createAbdmRouter } from "./server/abdm.ts";
import { attachHttpSecurity } from "./server/http-security.ts";
import { applyBundledServerNodeEnv, failFastRequiredProductionEnv, resolveListenPort } from "./server/runtime.ts";
import {
  expressErrorHandler,
  failFastErrorTrackerConfig,
  initErrorTracker,
  installProcessErrorHandlers,
  reportError,
} from "./server/error-tracker.ts";
import { attachProductionSpaFallback } from "./server/spa-fallback.ts";
import { attachPublicPolicyHtml, isPublicPolicyHtmlPath } from "./server/policy-html.ts";
import { mountGeminiClinicalRoutes } from "./server/gemini-clinical.ts";
import { installWhatsAppRouterPatch, protectWhatsAppDashboard } from "./server/whatsapp-dashboard-guard.ts";
import { createLiveRegistrationRouter } from "./server/live-registration-routes.ts";
import { ensureUsageWalletSchema, seedDemoUsageWallet } from "./server/usage-billing.ts";
import { ensureDoctorScheduleSchema } from "./server/doctor-schedule-schema.ts";

dotenv.config();
applyBundledServerNodeEnv();
// Fail-closed on JWT_SECRET before any listen. Missing secret exits here — not a PORT bug.
failFastRequiredProductionEnv();
failFastErrorTrackerConfig();
initErrorTracker();
installProcessErrorHandlers();

installWhatsAppRouterPatch();

const app = express();
const PORT = resolveListenPort();
app.set("trust proxy", 1);
attachHttpSecurity(app);

app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      (req as Request).rawBody = buf;
    },
  })
);
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
mountGeminiClinicalRoutes(app);


// ----------------------------------------------------
// Start Server with Vite Middleware
// ----------------------------------------------------
async function startServer() {
  applyBundledServerNodeEnv();
  failFastRequiredProductionEnv();
  failFastErrorTrackerConfig();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: true,
        allowedHosts: true as const,
      },
      appType: "spa",
    });
    app.use((req, _res, next) => {
      const p = req.path;
      const isAsset =
        p === "/healthz" ||
        p.startsWith("/api") ||
        p.startsWith("/uploads") ||
        p.startsWith("/meta") ||
        p.startsWith("/v3") ||
        p.startsWith("/@") ||
        p.startsWith("/src") ||
        p.startsWith("/node_modules") ||
        p.includes(".");
      if ((req.method === "GET" || req.method === "HEAD") && !isAsset && !isPublicPolicyHtmlPath(p)) {
        req.url = "/index.html";
      }
      next();
    });
    app.use(vite.middlewares);
  } else {
    attachProductionSpaFallback(app);
  }

  app.use(expressErrorHandler);

  const envPort = String(process.env.PORT || "").trim();
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `[Lumera] listening on 0.0.0.0:${PORT} (env PORT=${envPort || "(unset → default 3000)"})`
      );
      resolve();
    });
    server.once("error", reject);
  });

  // Heavy work after the Cloud Run socket is open. /healthz is already registered.
  initDatabase();
  ensureDoctorScheduleSchema(getDb());
  ensureUsageWalletSchema(getDb());
  seedDemoUsageWallet(getDb());
  bootWhatsAppOwnershipSchema();
  startAppointmentReminderScheduler();
}

startServer().catch((err) => {
  reportError(err, { kind: "startup" });
  console.error("[Lumera] Server failed to start:", err);
  process.exit(1);
});
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { getDb, initDatabase } from "./server/db.ts";
import { startAppointmentReminderScheduler } from "./server/whatsapp-calendar.ts";
import { bootWhatsAppOwnershipSchema } from "./server/whatsapp-numbers-routes.ts";
import { applyBundledServerNodeEnv, failFastRequiredProductionEnv, resolveListenPort } from "./server/runtime.ts";
import {
  expressErrorHandler,
  failFastErrorTrackerConfig,
  initErrorTracker,
  installProcessErrorHandlers,
  reportError,
} from "./server/error-tracker.ts";
import { attachProductionSpaFallback, isDedicatedPublicHtmlPath } from "./server/spa-fallback.ts";
import { installWhatsAppRouterPatch } from "./server/whatsapp-dashboard-guard.ts";
import { ensureUsageWalletSchema, seedDemoUsageWallet } from "./server/usage-billing.ts";
import { createLumeraApp } from "./server/create-app.ts";

dotenv.config();
applyBundledServerNodeEnv();
// Fail-closed on JWT_SECRET before any listen. Missing secret exits here — not a PORT bug.
failFastRequiredProductionEnv();
failFastErrorTrackerConfig();
initErrorTracker();
installProcessErrorHandlers();

installWhatsAppRouterPatch();

const app = createLumeraApp();
const PORT = resolveListenPort();

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
      if ((req.method === "GET" || req.method === "HEAD") && !isAsset && !isDedicatedPublicHtmlPath(p)) {
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

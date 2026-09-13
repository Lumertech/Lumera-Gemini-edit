import express, { Request } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { initDatabase } from "./server/db.ts";
import { startAppointmentReminderScheduler } from "./server/whatsapp-calendar.ts";
import { attachUser, requireAuth } from "./server/auth.ts";
import { createApiRouter } from "./server/api.ts";
import { createWhatsAppNumbersRouter, practitionerLinkMiddleware, bootWhatsAppOwnershipSchema } from "./server/whatsapp-numbers-routes.ts";
import { createMetaRouter } from "./server/meta.ts";
import { createAbdmRouter } from "./server/abdm.ts";
import { applyBundledServerNodeEnv, failFastRequiredProductionEnv, resolveListenPort } from "./server/runtime.ts";
import { attachProductionSpaFallback } from "./server/spa-fallback.ts";
import { attachPublicPolicyHtml, isPublicPolicyHtmlPath } from "./server/policy-html.ts";
import { attachGeminiSoapAndCopilot } from "./server/gemini-soap-copilot.ts";
import { attachGeminiSafetyVoiceAndTranslate } from "./server/gemini-safety-voice.ts";

dotenv.config();
applyBundledServerNodeEnv();
// Fail-closed on JWT_SECRET before any listen. Missing secret exits here — not a PORT bug.
failFastRequiredProductionEnv();

const app = express();
const PORT = resolveListenPort();
app.set("trust proxy", 1);

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
app.use("/api", createApiRouter());
app.use("/meta", createMetaRouter());
app.post("/data-deletion-callback", (req, res, next) => {
  req.url = "/data-deletion";
  createMetaRouter()(req, res, next);
});
attachPublicPolicyHtml(app);

// Lazy Google GenAI initialization
let genAIClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (!genAIClient && process.env.GEMINI_API_KEY) {
    genAIClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return genAIClient;
}

attachGeminiSoapAndCopilot(app, getGenAI);
attachGeminiSafetyVoiceAndTranslate(app, getGenAI);

// ----------------------------------------------------
// Start Server with Vite Middleware
// ----------------------------------------------------
async function startServer() {
  applyBundledServerNodeEnv();
  failFastRequiredProductionEnv();

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
  bootWhatsAppOwnershipSchema();
  startAppointmentReminderScheduler();
}

startServer().catch((err) => {
  console.error("[Lumera] Server failed to start:", err);
  process.exit(1);
});

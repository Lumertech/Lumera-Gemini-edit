import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth.ts";
import { reportCaughtError } from "./error-tracker.ts";
import {
  buildImmunizationChart,
  catalogPayload,
  getImmunizationSettings,
  recordImmunizationDose,
  saveImmunizationSettings,
  type ChartAudience,
} from "./immunization.ts";
import { denyUnlessPatientRecordRole, denyUnlessPrescriber } from "./patient-access.ts";
import { requestIsPatient, sessionPatientId } from "./patient-tenant.ts";

function tenantIdOf(req: Request): string {
  return String(req.user?.tenantId || "").trim();
}

function sendErr(res: Response, err: unknown, where: string) {
  const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 500;
  const message = err instanceof Error ? err.message : "Request failed";
  if (!status || status >= 500) reportCaughtError(err, where);
  res.status(status || 500).json({ error: message });
}

function actorOf(req: Request) {
  return { id: req.user?.id || "", name: req.user?.name || "", role: req.user?.role || "" };
}

function patientMayRead(req: Request, patientId: string): boolean {
  if (!requestIsPatient(req)) return true;
  const own = sessionPatientId(req);
  return Boolean(own) && own === patientId;
}

function audienceOf(value: unknown): ChartAudience {
  const raw = String(value || "auto");
  if (raw === "pediatric" || raw === "veterinary") return raw;
  return "auto";
}

export function createImmunizationRouter(): Router {
  const api = Router();

  api.get("/immunization/catalog", requireAuth, (req, res) => {
    if (!denyUnlessPatientRecordRole(req, res)) return;
    if (!tenantIdOf(req)) return res.status(400).json({ error: "No tenant associated with this account." });
    res.json(catalogPayload());
  });

  api.get("/immunization/settings", requireAuth, (req, res) => {
    if (!denyUnlessPatientRecordRole(req, res)) return;
    const tenantId = tenantIdOf(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant associated with this account." });
    try {
      res.json({
        settings: getImmunizationSettings(tenantId),
        catalog: catalogPayload(),
      });
    } catch (err) {
      sendErr(res, err, "immunization.settings");
    }
  });

  api.put("/immunization/settings", requireAuth, (req, res) => {
    if (!denyUnlessPrescriber(req, res)) return;
    const tenantId = tenantIdOf(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant associated with this account." });
    try {
      res.json({ settings: saveImmunizationSettings(tenantId, req.body || {}, actorOf(req)) });
    } catch (err) {
      sendErr(res, err, "immunization.settings.save");
    }
  });

  api.get("/patients/:id/immunization-chart", requireAuth, (req, res) => {
    if (!requestIsPatient(req) && !denyUnlessPatientRecordRole(req, res)) return;
    const tenantId = tenantIdOf(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant associated with this account." });
    if (!patientMayRead(req, req.params.id)) return res.status(404).json({ error: "Patient not found" });
    try {
      res.json({
        chart: buildImmunizationChart(tenantId, req.params.id, {
          audience: audienceOf(req.query.audience),
          scheduleId: String(req.query.scheduleId || req.query.schedule || ""),
          today: String(req.query.today || ""),
        }),
      });
    } catch (err) {
      sendErr(res, err, "immunization.chart");
    }
  });

  api.post("/patients/:id/immunization-doses", requireAuth, (req, res) => {
    if (!denyUnlessPrescriber(req, res)) return;
    const tenantId = tenantIdOf(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant associated with this account." });
    try {
      const dose = recordImmunizationDose(tenantId, req.params.id, req.body || {}, actorOf(req));
      res.status(201).json({ dose });
    } catch (err) {
      sendErr(res, err, "immunization.dose");
    }
  });

  return api;
}

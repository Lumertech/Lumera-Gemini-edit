import { Router, type NextFunction, type Request, type Response } from "express";
import { isPlatformAdminRole, requireAuth } from "./auth.ts";
import { getDb, normalizePracticeType, writeAudit } from "./db.ts";
import { isClinicBranchRole } from "../src/lib/clinicBranches.ts";

const BRANCH_STATUSES = new Set(["Operating", "Paused", "Closed", "Disabled", "Archived"]);

type BranchRow = {
  id: string;
  tenant_id: string;
  name: string;
  address: string;
  phone: string;
  opd_hours: string;
  active_doctors: number;
  status: string;
};

function tenantIdOf(req: Request): string {
  return String(req.user?.tenantId || "").trim();
}

function isPolyclinicClinicAdmin(req: Request): boolean {
  if (!req.user) return false;
  if (!isClinicBranchRole(req.user.role)) return false;
  return normalizePracticeType(req.user.practiceType) === "polyclinic";
}

function requireBranchReader(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  if (isPlatformAdminRole(req.user.role)) return next();
  if (isPolyclinicClinicAdmin(req)) return next();
  return res.status(403).json({ error: "Branches belong to polyclinic clinic admin" });
}

function requireBranchWriter(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  if (isPlatformAdminRole(req.user.role)) {
    return res.status(403).json({ error: "Super Admin has no Branches" });
  }
  if (!isPolyclinicClinicAdmin(req) || !tenantIdOf(req)) {
    return res.status(403).json({ error: "Branches belong to polyclinic clinic admin" });
  }
  next();
}

function loadOwnedBranch(req: Request, id: string): { row: BranchRow } | { status: number; error: string } {
  const row = getDb().prepare("SELECT * FROM branches WHERE id = ?").get(id) as BranchRow | undefined;
  if (!row) return { status: 404, error: "Branch not found" };
  if (String(row.tenant_id || "") !== tenantIdOf(req)) {
    return { status: 403, error: "Branch belongs to another clinic" };
  }
  return { row };
}

function cleanStatus(value: unknown, fallback: string): string | null {
  if (value === undefined || value === null || value === "") return fallback;
  const status = String(value);
  if (!BRANCH_STATUSES.has(status)) return null;
  return status;
}

function audit(req: Request, action: string, details: string) {
  writeAudit(getDb(), req.user?.id || null, req.user?.name || "Anonymous", action, details);
}

export function createClinicBranchesRouter(): Router {
  const api = Router();

  api.get("/branches", requireAuth, requireBranchReader, (req, res) => {
    // Super Admin may call the endpoint (support shell) but does not receive the clinic tree.
    if (isPlatformAdminRole(req.user?.role)) {
      return res.json({ branches: [] });
    }
    const tenantId = tenantIdOf(req);
    const branches = tenantId
      ? getDb().prepare("SELECT * FROM branches WHERE tenant_id = ? ORDER BY name").all(tenantId)
      : [];
    res.json({ branches });
  });

  api.post("/branches", requireAuth, requireBranchWriter, (req, res) => {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });
    const status = cleanStatus(b.status, "Operating");
    if (!status) return res.status(400).json({ error: "status is not recognized" });
    const id = `b-${crypto.randomUUID().slice(0, 8)}`;
    const tenantId = tenantIdOf(req);
    getDb()
      .prepare(
        `INSERT INTO branches (id, tenant_id, name, address, phone, opd_hours, active_doctors, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        tenantId,
        name,
        String(b.address || ""),
        String(b.phone || ""),
        String(b.opdHours || b.opd_hours || ""),
        Number(b.activeDoctors || b.active_doctors || 0),
        status
      );
    audit(req, "Branch created", name);
    res.status(201).json({ branch: getDb().prepare("SELECT * FROM branches WHERE id = ?").get(id) });
  });

  api.patch("/branches/:id", requireAuth, requireBranchWriter, (req, res) => {
    const loaded = loadOwnedBranch(req, req.params.id);
    if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
    const existing = loaded.row;
    const name = String(req.body?.name ?? existing.name).trim();
    if (!name) return res.status(400).json({ error: "name is required" });
    const status = cleanStatus(req.body?.status, existing.status);
    if (!status) return res.status(400).json({ error: "status is not recognized" });
    const next = {
      name,
      address: req.body?.address ?? existing.address,
      phone: req.body?.phone ?? existing.phone,
      opd_hours: req.body?.opdHours ?? req.body?.opd_hours ?? existing.opd_hours,
      active_doctors: req.body?.activeDoctors ?? req.body?.active_doctors ?? existing.active_doctors,
      status,
    };
    getDb()
      .prepare(
        `UPDATE branches SET name = ?, address = ?, phone = ?, opd_hours = ?, active_doctors = ?, status = ? WHERE id = ? AND tenant_id = ?`
      )
      .run(
        next.name,
        next.address,
        next.phone,
        next.opd_hours,
        Number(next.active_doctors),
        next.status,
        existing.id,
        tenantIdOf(req)
      );
    audit(req, "Branch updated", next.name);
    res.json({ branch: getDb().prepare("SELECT * FROM branches WHERE id = ?").get(existing.id) });
  });

  api.post("/branches/:id/archive", requireAuth, requireBranchWriter, (req, res) => {
    const loaded = loadOwnedBranch(req, req.params.id);
    if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
    const status = req.body?.status === "Disabled" ? "Disabled" : "Archived";
    getDb()
      .prepare("UPDATE branches SET status = ? WHERE id = ? AND tenant_id = ?")
      .run(status, loaded.row.id, tenantIdOf(req));
    audit(req, status === "Disabled" ? "Branch disabled" : "Branch archived", loaded.row.name);
    res.json({ branch: getDb().prepare("SELECT * FROM branches WHERE id = ?").get(loaded.row.id) });
  });

  /** Soft-archive. The row stays so a reload still shows the archived branch. */
  api.delete("/branches/:id", requireAuth, requireBranchWriter, (req, res) => {
    const loaded = loadOwnedBranch(req, req.params.id);
    if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
    getDb()
      .prepare("UPDATE branches SET status = 'Archived' WHERE id = ? AND tenant_id = ?")
      .run(loaded.row.id, tenantIdOf(req));
    audit(req, "Branch archived", loaded.row.name);
    res.json({ ok: true, branch: getDb().prepare("SELECT * FROM branches WHERE id = ?").get(loaded.row.id) });
  });

  return api;
}

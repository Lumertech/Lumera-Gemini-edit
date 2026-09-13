import { Router, type Request, type Response, type NextFunction } from "express";
import { getDb } from "./db.ts";
import { CLINIC_MANAGER_ROLES, isPlatformAdminRole, requireAuth, requirePlatformAdmin, requireRole } from "./auth.ts";
import { isProduction } from "./runtime.ts";
import { rejectProductionSimulator } from "./meta-security.ts";
import {
  clinicActor,
  doctorActor,
  ensureDoctorPractitionerLink,
  ensureWhatsAppOwnershipSchema,
  getDoctorWabaNumber,
  ensurePractitionerForUser,
  getPractitionerIdForUser,
  getTenantWabaNumber,
  listAdminWhatsAppDirectory,
  migrateTenantWabasToWhatsAppNumbers,
  platformAdminActor,
  publicWhatsAppNumber,
  simulateEmbeddedSignupForOwner,
  upsertWhatsAppNumber,
  WhatsAppNumberError,
  type WhatsAppOwnerType,
} from "./whatsapp-numbers.ts";
import { attachDeprecatedMetaWabaAliases } from "./whatsapp-numbers-meta-alias.ts";

export function bootWhatsAppOwnershipSchema() {
  const database = getDb();
  ensureWhatsAppOwnershipSchema(database);
  migrateTenantWabasToWhatsAppNumbers(database);
}

function handleWabaError(res: Response, err: unknown, fallback: string) {
  if (err instanceof WhatsAppNumberError) {
    return res.status(err.status).json({ error: err.message, code: err.code, ...(err.extra || {}) });
  }
  console.error("[WhatsApp numbers]", err);
  return res.status(500).json({ error: fallback });
}

function linkPractitionerAfterDoctorWrite(body: Record<string, unknown>) {
  const user = body.user as { id?: string; role?: string; name?: string; phone?: string } | undefined;
  if (!user?.id || user.role !== "doctor") return;
  const doc = getDb()
    .prepare("SELECT id, name, phone FROM doctors WHERE user_id = ?")
    .get(user.id) as { id: string; name?: string; phone?: string } | undefined;
  if (!doc) return;
  ensureDoctorPractitionerLink({
    doctorId: doc.id,
    name: doc.name || user.name || "",
    phone: doc.phone || user.phone || "",
  });
  body.practitionerId = getPractitionerIdForUser(user.id);
}

/** Patches res.json so POST /users and complete-onboarding link practitioner_id without editing api.ts. */
export function practitionerLinkMiddleware(req: Request, res: Response, next: NextFunction) {
  const path = req.path || "";
  if (req.method === "POST" && (path === "/users" || path === "/auth/complete-onboarding" || path === "/clinic/members")) {
    const original = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (body && typeof body === "object") {
        try {
          bootWhatsAppOwnershipSchema();
          linkPractitionerAfterDoctorWrite(body as Record<string, unknown>);
        } catch (err) {
          console.error("[practitioner link]", err);
        }
      }
      return original(body);
    }) as Response["json"];
  }
  next();
}

export function createWhatsAppNumbersRouter(): Router {
  const router = Router();

  router.get("/admin/whatsapp-numbers", requireAuth, requirePlatformAdmin, (_req, res) => {
    try {
      bootWhatsAppOwnershipSchema();
      const directory = listAdminWhatsAppDirectory();
      res.json({
        tenantNumbers: directory.tenantNumbers,
        practitionerNumbers: directory.practitionerNumbers,
      });
    } catch (err) {
      handleWabaError(res, err, "Failed to list WhatsApp numbers");
    }
  });

  function adminUpsertFields(body: Record<string, unknown>) {
    return {
      wabaId: body.wabaId != null ? String(body.wabaId) : undefined,
      phoneNumberId: body.phoneNumberId != null ? String(body.phoneNumberId) : undefined,
      metaWabaName: body.metaWabaName != null ? String(body.metaWabaName) : undefined,
      metaAccessToken: body.metaAccessToken != null ? String(body.metaAccessToken) : undefined,
      status: body.status as "pending" | "connected" | "disconnected" | undefined,
      connectedVia: "master_admin" as const,
    };
  }

  function patchAdminWhatsAppNumber(id: string, body: Record<string, unknown>) {
    const existing = getDb()
      .prepare("SELECT * FROM whatsapp_numbers WHERE id = ?")
      .get(id) as { owner_type?: WhatsAppOwnerType; owner_id?: string } | undefined;
    if (!existing?.owner_type || !existing.owner_id) {
      throw new WhatsAppNumberError(404, "WhatsApp number not found", "NOT_FOUND");
    }
    return upsertWhatsAppNumber(platformAdminActor(), {
      id,
      ownerType: existing.owner_type,
      ownerId: existing.owner_id,
      ...adminUpsertFields(body),
      allowCreate: false,
    });
  }

  router.post("/admin/whatsapp-numbers", requireAuth, requirePlatformAdmin, (req, res) => {
    try {
      bootWhatsAppOwnershipSchema();
      const body = (req.body || {}) as Record<string, unknown>;
      const ownerType = String(body.ownerType || body.owner_type || "") as WhatsAppOwnerType;
      const ownerId = String(body.ownerId || body.owner_id || body.tenantId || "").trim();
      if (ownerType !== "tenant" && ownerType !== "doctor") {
        return res.status(400).json({ error: "ownerType must be tenant or doctor" });
      }
      if (!ownerId) return res.status(400).json({ error: "ownerId is required" });
      const row = upsertWhatsAppNumber(platformAdminActor(), {
        ownerType,
        ownerId,
        ...adminUpsertFields(body),
      });
      res.status(201).json({ whatsappNumber: publicWhatsAppNumber(row) });
    } catch (err) {
      handleWabaError(res, err, "Failed to save WhatsApp number");
    }
  });

  router.patch("/admin/whatsapp-numbers", requireAuth, requirePlatformAdmin, (req, res) => {
    try {
      bootWhatsAppOwnershipSchema();
      const body = (req.body || {}) as Record<string, unknown>;
      const id = String(body.id || "").trim();
      if (id) {
        const row = patchAdminWhatsAppNumber(id, body);
        return res.json({ whatsappNumber: publicWhatsAppNumber(row) });
      }
      const ownerType = String(body.ownerType || body.owner_type || "") as WhatsAppOwnerType;
      const ownerId = String(body.ownerId || body.owner_id || body.tenantId || "").trim();
      if (ownerType !== "tenant" && ownerType !== "doctor") {
        return res.status(400).json({ error: "id or ownerType + ownerId is required" });
      }
      if (!ownerId) return res.status(400).json({ error: "id or ownerType + ownerId is required" });
      const row = upsertWhatsAppNumber(platformAdminActor(), {
        ownerType,
        ownerId,
        ...adminUpsertFields(body),
        allowCreate: false,
      });
      res.json({ whatsappNumber: publicWhatsAppNumber(row) });
    } catch (err) {
      handleWabaError(res, err, "Failed to update WhatsApp number");
    }
  });

  router.patch("/admin/whatsapp-numbers/:id", requireAuth, requirePlatformAdmin, (req, res) => {
    try {
      bootWhatsAppOwnershipSchema();
      const row = patchAdminWhatsAppNumber(req.params.id, (req.body || {}) as Record<string, unknown>);
      res.json({ whatsappNumber: publicWhatsAppNumber(row) });
    } catch (err) {
      handleWabaError(res, err, "Failed to update WhatsApp number");
    }
  });

  router.get("/whatsapp-numbers/mine", requireAuth, (req, res) => {
    bootWhatsAppOwnershipSchema();
    const tenantId = String(req.user?.tenantId || "").trim();
    const practitionerId =
      req.user?.role === "doctor" ? ensurePractitionerForUser(req.user!.id) : getPractitionerIdForUser(req.user!.id);
    const tenantNumber = tenantId ? getTenantWabaNumber(tenantId) : undefined;
    const doctorNumber = practitionerId ? getDoctorWabaNumber(practitionerId) : undefined;
    res.json({
      tenantId: tenantId || undefined,
      practitionerId: practitionerId || undefined,
      tenantNumber: tenantNumber ? publicWhatsAppNumber(tenantNumber) : null,
      doctorNumber: doctorNumber ? publicWhatsAppNumber(doctorNumber) : null,
      sandbox: !isProduction(),
      embeddedSignupLive: false,
      notice: "SANDBOX / DEV-ONLY: Embedded Signup is not live. Lumera is not a certified Meta Tech Provider.",
    });
  });

  router.post("/whatsapp-numbers/connect-clinic", requireAuth, requireRole(...CLINIC_MANAGER_ROLES), (req, res) => {
    try {
      bootWhatsAppOwnershipSchema();
      const tenantId = String(req.user?.tenantId || "").trim();
      if (!tenantId) return res.status(403).json({ error: "No clinic tenant is linked to this account." });
      const body = (req.body || {}) as Record<string, unknown>;
      const requestedOwner = String(body.ownerId || body.owner_id || body.tenantId || tenantId).trim();
      if (requestedOwner !== tenantId) {
        return res.status(403).json({ error: "Clinic users can only connect the WhatsApp number for their own tenant." });
      }
      if (body.ownerType && body.ownerType !== "tenant") {
        return res.status(403).json({ error: "Clinic connect can only create a tenant-owned WhatsApp number." });
      }
      const row = upsertWhatsAppNumber(clinicActor(tenantId), {
        id: String(body.id || "").trim() || undefined,
        ownerType: "tenant",
        ownerId: tenantId,
        wabaId: body.wabaId != null ? String(body.wabaId) : undefined,
        phoneNumberId: body.phoneNumberId != null ? String(body.phoneNumberId) : undefined,
        metaWabaName: body.metaWabaName != null ? String(body.metaWabaName) : undefined,
        metaAccessToken: body.metaAccessToken != null ? String(body.metaAccessToken) : undefined,
        status: "connected",
        connectedVia: "embedded_signup",
      });
      res.json({ whatsappNumber: publicWhatsAppNumber(row), sandbox: !isProduction() });
    } catch (err) {
      handleWabaError(res, err, "Failed to connect clinic WhatsApp number");
    }
  });

  router.post("/whatsapp-numbers/connect-doctor", requireAuth, requireRole("doctor"), (req, res) => {
    try {
      bootWhatsAppOwnershipSchema();
      const practitionerId = ensurePractitionerForUser(req.user!.id);
      if (!practitionerId) {
        return res.status(400).json({ error: "No practitioner identity is linked to this doctor account." });
      }
      const body = (req.body || {}) as Record<string, unknown>;
      const requestedOwner = String(body.ownerId || body.owner_id || practitionerId).trim();
      if (requestedOwner !== practitionerId) {
        return res.status(403).json({
          error: "Doctors can only connect the personal WhatsApp number linked to their own practitioner identity.",
        });
      }
      if (body.ownerType && body.ownerType !== "doctor") {
        return res.status(403).json({ error: "Doctor connect can only create a doctor-owned WhatsApp number." });
      }
      const row = upsertWhatsAppNumber(doctorActor(practitionerId), {
        ownerType: "doctor",
        ownerId: practitionerId,
        wabaId: body.wabaId != null ? String(body.wabaId) : undefined,
        phoneNumberId: body.phoneNumberId != null ? String(body.phoneNumberId) : undefined,
        metaWabaName: body.metaWabaName != null ? String(body.metaWabaName) : undefined,
        metaAccessToken: body.metaAccessToken != null ? String(body.metaAccessToken) : undefined,
        status: "connected",
        connectedVia: "embedded_signup",
      });
      res.json({
        whatsappNumber: publicWhatsAppNumber(row),
        sandbox: !isProduction(),
        notice: "SANDBOX / DEV-ONLY: Embedded Signup is not live. Lumera is not a certified Meta Tech Provider.",
      });
    } catch (err) {
      handleWabaError(res, err, "Failed to connect personal WhatsApp number");
    }
  });

  router.post("/whatsapp-numbers/simulate-embedded-signup", requireAuth, rejectProductionSimulator, (req, res) => {
    try {
      bootWhatsAppOwnershipSchema();
      const body = (req.body || {}) as Record<string, unknown>;
      const intended: WhatsAppOwnerType = body.ownerType === "doctor" ? "doctor" : "tenant";
      if (intended === "doctor") {
        if (req.user?.role !== "doctor" && !isPlatformAdminRole(req.user?.role)) {
          return res.status(403).json({ error: "Only the linked doctor (or Master Admin) can simulate a personal WABA." });
        }
        const practitionerId = isPlatformAdminRole(req.user?.role)
          ? String(body.ownerId || "").trim()
          : ensurePractitionerForUser(req.user!.id);
        if (!practitionerId) {
          return res.status(400).json({ error: "No practitioner identity is linked to this account." });
        }
        const actor = isPlatformAdminRole(req.user?.role) ? platformAdminActor() : doctorActor(practitionerId);
        const simulated = simulateEmbeddedSignupForOwner({
          actor,
          ownerType: "doctor",
          ownerId: practitionerId,
          displayName: String(body.displayName || req.user?.name || ""),
        });
        return res.json({
          success: true,
          sandbox: true,
          notice: "SANDBOX / DEV-ONLY simulator — not live Meta Embedded Signup.",
          message:
            "SANDBOX / DEV-ONLY: fake WABA ids stored locally. This is not Meta Embedded Signup and Lumera is not a certified Tech Provider.",
          whatsappNumber: publicWhatsAppNumber(simulated.row),
          wabaId: simulated.wabaId,
          phoneNumberId: simulated.phoneNumberId,
        });
      }
      const tenantId = isPlatformAdminRole(req.user?.role)
        ? String(body.ownerId || body.tenantId || req.user?.tenantId || "").trim()
        : String(req.user?.tenantId || "").trim();
      if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
      if (!isPlatformAdminRole(req.user?.role) && tenantId !== req.user?.tenantId) {
        return res.status(403).json({ error: "Clinic users can only connect the WhatsApp number for their own tenant." });
      }
      const actor = isPlatformAdminRole(req.user?.role) ? platformAdminActor() : clinicActor(tenantId);
      const simulated = simulateEmbeddedSignupForOwner({
        actor,
        ownerType: "tenant",
        ownerId: tenantId,
        displayName: String(body.displayName || body.clinicName || ""),
      });
      return res.json({
        success: true,
        sandbox: true,
        notice: "SANDBOX / DEV-ONLY simulator — not live Meta Embedded Signup.",
        message:
          "SANDBOX / DEV-ONLY: fake WABA ids stored locally. This is not Meta Embedded Signup and Lumera is not a certified Tech Provider.",
        whatsappNumber: publicWhatsAppNumber(simulated.row),
        wabaId: simulated.wabaId,
        phoneNumberId: simulated.phoneNumberId,
      });
    } catch (err) {
      handleWabaError(res, err, "Failed to simulate embedded signup");
    }
  });

  attachDeprecatedMetaWabaAliases(router);
  return router;
}

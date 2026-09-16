import type { Router, Request, Response } from "express";
import { getDb } from "./db.ts";
import { isPlatformAdminRole, requireAuth } from "./auth.ts";
import {
  clinicActor,
  disconnectWhatsAppNumber,
  ensureWhatsAppOwnershipSchema,
  migrateTenantWabasToWhatsAppNumbers,
  platformAdminActor,
  publicWhatsAppNumber,
  upsertWhatsAppNumber,
  WhatsAppNumberError,
  type WabaActor,
} from "./whatsapp-numbers.ts";

function bootSchema() {
  const database = getDb();
  ensureWhatsAppOwnershipSchema(database);
  migrateTenantWabasToWhatsAppNumbers(database);
}

function tenantWriteActor(req: Request): WabaActor | null {
  if (!req.user) return null;
  if (isPlatformAdminRole(req.user.role)) return platformAdminActor();
  const tenantId = String(req.user.tenantId || "").trim();
  if (!tenantId) return null;
  return clinicActor(tenantId);
}

function handleAliasError(res: Response, err: unknown, fallback: string) {
  if (err instanceof WhatsAppNumberError) {
    return res.status(err.status).json({ error: err.message, code: err.code, ...(err.extra || {}) });
  }
  console.error("[WhatsApp numbers alias]", err);
  return res.status(500).json({ error: fallback });
}

/**
 * Deprecated aliases for POST /api/meta/waba-connect|disconnect.
 * Registered on the WhatsApp-numbers router (mounted at /api before createApiRouter)
 * so they write through whatsapp_numbers instead of the old tenants-column handler.
 */
export function attachDeprecatedMetaWabaAliases(router: Router) {
  router.post("/meta/waba-connect", requireAuth, (req, res) => {
    try {
      bootSchema();
      const requestedTenantId = String(req.body?.tenantId || "").trim();
      const actor = tenantWriteActor(req);
      if (!actor) return res.status(401).json({ error: "Authentication required" });
      const ownerId = actor.kind === "platform_admin" ? requestedTenantId : actor.kind === "clinic" ? actor.tenantId : "";
      if (!ownerId) return res.status(400).json({ error: "Tenant ID, WABA ID, and Phone Number ID are required" });
      if (actor.kind !== "platform_admin" && requestedTenantId && requestedTenantId !== ownerId) {
        return res.status(403).json({ error: "Clinic users can only connect the WhatsApp number for their own tenant." });
      }
      const { wabaId, phoneNumberId, metaAccessToken, metaWabaName } = req.body || {};
      if (!wabaId || !phoneNumberId) {
        return res.status(400).json({ error: "Tenant ID, WABA ID, and Phone Number ID are required" });
      }
      const row = upsertWhatsAppNumber(actor, {
        ownerType: "tenant",
        ownerId,
        wabaId,
        phoneNumberId,
        metaWabaName,
        metaAccessToken,
        status: "connected",
        connectedVia: actor.kind === "platform_admin" ? "master_admin" : "embedded_signup",
      });
      return res.json({
        success: true,
        deprecated: true,
        aliasOf: "POST /api/admin/whatsapp-numbers",
        message: "Deprecated alias. Prefer POST /api/admin/whatsapp-numbers or POST /api/whatsapp-numbers/connect-clinic.",
        waba: { tenantId: ownerId, ...publicWhatsAppNumber(row), status: row.status, qualityRating: "UNKNOWN" },
      });
    } catch (err) {
      handleAliasError(res, err, "Failed to connect WABA credentials");
    }
  });

  router.post("/meta/waba-disconnect", requireAuth, (req, res) => {
    try {
      bootSchema();
      const requestedTenantId = String(req.body?.tenantId || "").trim();
      const actor = tenantWriteActor(req);
      if (!actor) return res.status(401).json({ error: "Authentication required" });
      const ownerId = actor.kind === "platform_admin" ? requestedTenantId : actor.kind === "clinic" ? actor.tenantId : "";
      if (!ownerId) return res.status(400).json({ error: "Tenant ID is required" });
      if (actor.kind !== "platform_admin" && requestedTenantId && requestedTenantId !== ownerId) {
        return res.status(403).json({ error: "Clinic users can only disconnect their own tenant WhatsApp number." });
      }
      disconnectWhatsAppNumber(actor, "tenant", ownerId);
      return res.json({ success: true, deprecated: true, message: "WABA disconnected successfully." });
    } catch (err) {
      handleAliasError(res, err, "Failed to disconnect WABA");
    }
  });
}

import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db.ts";
import { isProduction } from "./runtime.ts";
export * from "./whatsapp-numbers-store.ts";
import {
  assertCanWriteWhatsAppNumber,
  ensureWhatsAppOwnershipSchema,
  getWhatsAppNumberSecret,
  listPractitionerAffiliations,
  sandboxExpiryPlaceholder,
  sandboxTokenPlaceholder,
  storeToken,
  syncTenantWabaColumns,
  type PractitionerRow,
  type UpsertWhatsAppNumberInput,
  type WabaActor,
  type WhatsAppConnectedVia,
  type WhatsAppNumberRow,
  type WhatsAppNumberStatus,
  type WhatsAppOwnerType,
  WhatsAppNumberError,
} from "./whatsapp-numbers-store.ts";

export function upsertWhatsAppNumber(actor: WabaActor, input: UpsertWhatsAppNumberInput): WhatsAppNumberRow {
  const database = getDb();
  ensureWhatsAppOwnershipSchema(database);
  const ownerType = input.ownerType;
  const ownerId = String(input.ownerId || "").trim();
  if (ownerType !== "tenant" && ownerType !== "doctor") {
    throw new WhatsAppNumberError(400, "ownerType must be tenant or doctor", "INVALID_OWNER");
  }
  if (!ownerId) {
    throw new WhatsAppNumberError(400, "ownerId is required", "INVALID_OWNER");
  }
  assertCanWriteWhatsAppNumber(actor, ownerType, ownerId);

  const existing = database
    .prepare("SELECT * FROM whatsapp_numbers WHERE owner_type = ? AND owner_id = ?")
    .get(ownerType, ownerId) as WhatsAppNumberRow | undefined;

  if (!existing && input.allowCreate === false) {
    throw new WhatsAppNumberError(404, "WhatsApp number not found for this owner", "NOT_FOUND");
  }

  if (existing && actor.kind === "clinic" && input.allowCreate === true && input.id && input.id !== existing.id) {
    throw new WhatsAppNumberError(
      409,
      "This clinic already has a tenant-owned WhatsApp number. A clinic gets exactly one.",
      "TENANT_WABA_EXISTS"
    );
  }

  const wabaId = String(input.wabaId ?? existing?.waba_id ?? "").trim();
  const phoneNumberId = String(input.phoneNumberId ?? existing?.phone_number_id ?? "").trim();
  const metaWabaName = String(input.metaWabaName ?? existing?.meta_waba_name ?? "").trim();
  const status = (input.status || (wabaId && phoneNumberId ? "connected" : existing?.status) || "pending") as WhatsAppNumberStatus;
  const connectedVia = (input.connectedVia || existing?.connected_via || (actor.kind === "platform_admin" ? "master_admin" : "embedded_signup")) as WhatsAppConnectedVia;
  const now = new Date().toISOString();
  const numberId = existing?.id || input.id || `wan-${crypto.randomUUID()}`;
  const tokenRef = existing?.meta_token_ref || `wsec-${numberId}`;

  if (phoneNumberId) {
    const clash = database
      .prepare("SELECT id, owner_type, owner_id FROM whatsapp_numbers WHERE phone_number_id = ? AND id != ?")
      .get(phoneNumberId, numberId) as { id?: string; owner_type?: string; owner_id?: string } | undefined;
    if (clash?.id) {
      throw new WhatsAppNumberError(
        409,
        "This Meta phone_number_id is already linked to another owner.",
        "PHONE_NUMBER_TAKEN"
      );
    }
  }

  const providedToken = String(input.metaAccessToken || "").trim();
  if (isProduction() && !providedToken && !existing && status === "connected") {
    throw new WhatsAppNumberError(400, "metaAccessToken is required in production. Demo tokens are not invented.", "TOKEN_REQUIRED");
  }
  const tokenToStore =
    providedToken ||
    (existing ? getWhatsAppNumberSecret(existing.meta_token_ref, database) : sandboxTokenPlaceholder());
  const expiresAt = String(input.metaTokenExpiresAt || existing?.meta_token_expires_at || sandboxExpiryPlaceholder());

  if (existing) {
    database
      .prepare(
        `UPDATE whatsapp_numbers
         SET waba_id = ?, phone_number_id = ?, meta_waba_name = ?, status = ?, connected_via = ?, meta_token_ref = ?, meta_token_expires_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(wabaId, phoneNumberId, metaWabaName, status, connectedVia, tokenRef, expiresAt, now, existing.id);
  } else {
    database
      .prepare(
        `INSERT INTO whatsapp_numbers
          (id, owner_type, owner_id, waba_id, phone_number_id, meta_waba_name, status, connected_via, meta_token_ref, meta_token_expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(numberId, ownerType, ownerId, wabaId, phoneNumberId, metaWabaName, status, connectedVia, tokenRef, expiresAt, now, now);
  }

  storeToken(database, numberId, tokenRef, tokenToStore);
  if (ownerType === "tenant") syncTenantWabaColumns(database, ownerId);

  return database.prepare("SELECT * FROM whatsapp_numbers WHERE id = ?").get(numberId) as WhatsAppNumberRow;
}

export function disconnectWhatsAppNumber(actor: WabaActor, ownerType: WhatsAppOwnerType, ownerId: string): WhatsAppNumberRow {
  assertCanWriteWhatsAppNumber(actor, ownerType, ownerId);
  const database = getDb();
  const existing = database
    .prepare("SELECT * FROM whatsapp_numbers WHERE owner_type = ? AND owner_id = ?")
    .get(ownerType, ownerId) as WhatsAppNumberRow | undefined;
  if (!existing) {
    throw new WhatsAppNumberError(404, "WhatsApp number not found for this owner", "NOT_FOUND");
  }
  const now = new Date().toISOString();
  database
    .prepare(
      `UPDATE whatsapp_numbers
       SET status = 'disconnected', waba_id = '', phone_number_id = '', updated_at = ?
       WHERE id = ?`
    )
    .run(now, existing.id);
  if (existing.meta_token_ref) {
    database
      .prepare("UPDATE whatsapp_number_secrets SET meta_access_token = '', updated_at = ? WHERE id = ?")
      .run(now, existing.meta_token_ref);
  }
  if (ownerType === "tenant") syncTenantWabaColumns(database, ownerId);
  return database.prepare("SELECT * FROM whatsapp_numbers WHERE id = ?").get(existing.id) as WhatsAppNumberRow;
}

export function publicWhatsAppNumber(row: WhatsAppNumberRow) {
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    wabaId: row.waba_id,
    phoneNumberId: row.phone_number_id,
    metaWabaName: row.meta_waba_name,
    status: row.status,
    connectedVia: row.connected_via,
    metaTokenRef: row.meta_token_ref,
    metaTokenExpiresAt: row.meta_token_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasToken: Boolean(row.meta_token_ref),
  };
}

export function listAdminWhatsAppDirectory(database: DatabaseSync = getDb()) {
  ensureWhatsAppOwnershipSchema(database);
  const numbers = database.prepare("SELECT * FROM whatsapp_numbers ORDER BY updated_at DESC").all() as WhatsAppNumberRow[];
  const tenants = database.prepare("SELECT id, name, specialty, country, phone FROM tenants").all() as Array<{
    id: string;
    name: string;
    specialty: string;
    country: string;
    phone: string;
  }>;
  const tenantById = new Map(tenants.map((t) => [t.id, t]));
  const practitioners = database.prepare("SELECT * FROM practitioners").all() as PractitionerRow[];
  const practitionerById = new Map(practitioners.map((p) => [p.id, p]));

  const tenantNumbers = numbers
    .filter((row) => row.owner_type === "tenant")
    .map((row) => {
      const tenant = tenantById.get(row.owner_id);
      return {
        ...publicWhatsAppNumber(row),
        tenantId: row.owner_id,
        tenantName: tenant?.name || row.owner_id,
        specialty: tenant?.specialty || "",
        country: tenant?.country || "",
        clinicPhone: tenant?.phone || "",
      };
    });

  const practitionerNumbers = practitioners.map((practitioner) => {
    const number = numbers.find((row) => row.owner_type === "doctor" && row.owner_id === practitioner.id);
    const affiliations = listPractitionerAffiliations(practitioner.id, database);
    return {
      practitionerId: practitioner.id,
      name: practitioner.name,
      phone: practitioner.phone,
      affiliations,
      whatsappNumber: number ? publicWhatsAppNumber(number) : null,
      status: number?.status || "none",
    };
  });

  return { tenantNumbers, practitionerNumbers, tenantById, practitionerById };
}

export function simulateEmbeddedSignupForOwner(opts: {
  actor: WabaActor;
  ownerType: WhatsAppOwnerType;
  ownerId: string;
  displayName?: string;
}): { row: WhatsAppNumberRow; wabaId: string; phoneNumberId: string } {
  const wabaId = `waba_${Date.now().toString().slice(-9)}${Math.floor(1000 + Math.random() * 9000)}`;
  const phoneNumberId = `phone_${Date.now().toString().slice(-8)}${Math.floor(100 + Math.random() * 900)}`;
  const row = upsertWhatsAppNumber(opts.actor, {
    ownerType: opts.ownerType,
    ownerId: opts.ownerId,
    wabaId,
    phoneNumberId,
    metaWabaName: opts.displayName
      ? `${opts.displayName} (SANDBOX / DEV-ONLY)`
      : "Lumera SANDBOX practice",
    metaAccessToken: "EAAJ...SANDBOX_DEV_ONLY_embedded_signup_not_live",
    metaTokenExpiresAt: "SANDBOX / DEV-ONLY — not a Graph token",
    status: "connected",
    connectedVia: "embedded_signup",
  });
  return { row, wabaId, phoneNumberId };
}

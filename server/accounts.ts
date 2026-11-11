import { getDb, writeAudit } from "./db.ts";
import {
  assertAllowedPatientDocument,
  readStoredPatientDocument,
  removeStoredPatientDocument,
  storePatientDocumentBytes,
} from "./patient-documents.ts";
import { tenantTimezone } from "./clinical.ts";
import { collectedClinicDate, isCollectedInvoiceStatus } from "./collected-revenue.ts";
import { clinicCalendarDate } from "../src/lib/clinicDay.ts";
import {
  allocateStock,
  collectionMode,
  dayCloseTotals,
  daysUntil,
  emptyCounted,
  gstBreakdown,
  paiseToRupees,
  priceFlag,
  rupeesToPaise,
  type CollectionMode,
  type CountedModes,
  type GstLine,
  type PriceFlag,
} from "../src/lib/accountsMath.ts";
import { buildXlsx, type XlsxSheet } from "./xlsx-store.ts";

export function accountsError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function nid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayFor(tenantId: string): string {
  return clinicCalendarDate(new Date(), tenantTimezone(tenantId));
}

function rupee(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function changesOf(result: { changes?: number | bigint }): number {
  return Number(result.changes || 0);
}

const ITEM_KINDS = new Set(["consumable", "medicine", "vaccine"]);

function assertKind(kind: string): "consumable" | "medicine" | "vaccine" {
  if (!ITEM_KINDS.has(kind)) throw accountsError(400, "Item kind must be consumable, medicine, or vaccine");
  return kind as "consumable" | "medicine" | "vaccine";
}

function assertIsoDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw accountsError(400, `${label} must be YYYY-MM-DD`);
  return value;
}

function assertGstRate(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 28) throw accountsError(400, "GST rate must be between 0 and 28");
  return Math.round(n * 100) / 100;
}

function assertPositiveInt(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 100000) throw accountsError(400, `${label} must be a whole number from 1 to 100000`);
  return n;
}

function assertNonNegativeInt(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 10000000) throw accountsError(400, `${label} must be a whole number of rupees`);
  return n;
}

type ItemRow = {
  id: string;
  tenant_id: string;
  kind: string;
  name: string;
  unit: string;
  hsn: string;
  gst_percent: number;
  reorder_level: number;
  sell_price: number;
  deleted_at?: string | null;
};

type BatchRow = {
  id: string;
  tenant_id: string;
  item_id: string;
  vendor_id: string;
  batch_no: string;
  expiry_date: string;
  qty_on_hand: number;
  unit_cost_paise: number;
  price_flag: string;
  received_at: string;
};

function mapItem(row: ItemRow) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    unit: row.unit,
    hsn: row.hsn,
    gstPercent: Number(row.gst_percent || 0),
    reorderLevel: Number(row.reorder_level || 0),
    sellPrice: Number(row.sell_price || 0),
  };
}

function getItem(tenantId: string, id: string): ItemRow | undefined {
  return getDb()
    .prepare("SELECT * FROM inventory_items WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL")
    .get(id, tenantId) as ItemRow | undefined;
}

function getVendor(tenantId: string, id: string): { id: string; name: string } | undefined {
  return getDb()
    .prepare("SELECT id, name FROM clinic_vendors WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL")
    .get(id, tenantId) as { id: string; name: string } | undefined;
}

function activeLock(tenantId: string, vendorId: string, itemId: string): { id: string; agreed_paise: number } | undefined {
  return getDb()
    .prepare(
      `SELECT id, agreed_paise FROM vendor_price_locks
       WHERE tenant_id = ? AND vendor_id = ? AND item_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(tenantId, vendorId, itemId) as { id: string; agreed_paise: number } | undefined;
}

export function getAccountsSettings(tenantId: string): { nearExpiryDays: number } {
  const row = getDb()
    .prepare("SELECT near_expiry_days FROM accounts_settings WHERE tenant_id = ?")
    .get(tenantId) as { near_expiry_days?: number } | undefined;
  const days = Number(row?.near_expiry_days);
  return { nearExpiryDays: Number.isInteger(days) && days > 0 ? days : 30 };
}

export function saveAccountsSettings(tenantId: string, nearExpiryDays: number) {
  const days = Number(nearExpiryDays);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw accountsError(400, "Near-expiry window must be 1 to 365 days");
  }
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO accounts_settings (tenant_id, near_expiry_days, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(tenant_id) DO UPDATE SET near_expiry_days = excluded.near_expiry_days, updated_at = excluded.updated_at`
    )
    .run(tenantId, days, now);
  return getAccountsSettings(tenantId);
}

export function listVendors(tenantId: string) {
  const rows = getDb()
    .prepare(
      "SELECT id, name, phone, gstin FROM clinic_vendors WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY name"
    )
    .all(tenantId) as { id: string; name: string; phone: string; gstin: string }[];
  return rows.map((row) => ({ id: row.id, name: row.name, phone: row.phone, gstin: row.gstin }));
}

export function createVendor(tenantId: string, body: Record<string, unknown>) {
  const name = String(body.name || "").trim();
  if (!name) throw accountsError(400, "Vendor name is required");
  const id = nid("ven");
  getDb()
    .prepare(
      `INSERT INTO clinic_vendors (id, tenant_id, name, phone, gstin, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, tenantId, name.slice(0, 120), String(body.phone || "").slice(0, 40), String(body.gstin || "").slice(0, 20), nowIso());
  return listVendors(tenantId).find((row) => row.id === id);
}

export function deleteVendor(tenantId: string, id: string) {
  const result = getDb()
    .prepare("UPDATE clinic_vendors SET deleted_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL")
    .run(nowIso(), id, tenantId);
  if (changesOf(result) !== 1) throw accountsError(404, "Vendor not found");
}

export function listItems(tenantId: string) {
  const rows = getDb()
    .prepare("SELECT * FROM inventory_items WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY name")
    .all(tenantId) as ItemRow[];
  return rows.map(mapItem);
}

export function createItem(tenantId: string, body: Record<string, unknown>) {
  const name = String(body.name || "").trim();
  if (!name) throw accountsError(400, "Item name is required");
  const kind = assertKind(String(body.kind || "").trim());
  const id = nid("item");
  getDb()
    .prepare(
      `INSERT INTO inventory_items (
        id, tenant_id, kind, name, unit, hsn, gst_percent, reorder_level, sell_price, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      tenantId,
      kind,
      name.slice(0, 160),
      String(body.unit || "unit").slice(0, 24) || "unit",
      String(body.hsn || "").slice(0, 12),
      assertGstRate(body.gstPercent ?? body.gst_percent ?? 0),
      assertNonNegativeInt(body.reorderLevel ?? body.reorder_level ?? 0, "Reorder level"),
      assertNonNegativeInt(body.sellPrice ?? body.sell_price ?? 0, "Sell price"),
      nowIso()
    );
  return listItems(tenantId).find((row) => row.id === id);
}

export function deleteItem(tenantId: string, id: string) {
  const result = getDb()
    .prepare("UPDATE inventory_items SET deleted_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL")
    .run(nowIso(), id, tenantId);
  if (changesOf(result) !== 1) throw accountsError(404, "Item not found");
}

export function listPriceLocks(tenantId: string) {
  const rows = getDb()
    .prepare(
      `SELECT l.id, l.vendor_id, l.item_id, l.agreed_paise, v.name AS vendor_name, i.name AS item_name
       FROM vendor_price_locks l
       INNER JOIN clinic_vendors v ON v.id = l.vendor_id AND v.tenant_id = l.tenant_id
       INNER JOIN inventory_items i ON i.id = l.item_id AND i.tenant_id = l.tenant_id
       WHERE l.tenant_id = ? AND l.deleted_at IS NULL
       ORDER BY v.name, i.name`
    )
    .all(tenantId) as {
    id: string;
    vendor_id: string;
    item_id: string;
    agreed_paise: number;
    vendor_name: string;
    item_name: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    vendorId: row.vendor_id,
    itemId: row.item_id,
    vendorName: row.vendor_name,
    itemName: row.item_name,
    agreedRate: paiseToRupees(row.agreed_paise),
  }));
}

export function upsertPriceLock(tenantId: string, body: Record<string, unknown>) {
  const vendorId = String(body.vendorId || body.vendor_id || "").trim();
  const itemId = String(body.itemId || body.item_id || "").trim();
  if (!getVendor(tenantId, vendorId)) throw accountsError(404, "Vendor not found");
  if (!getItem(tenantId, itemId)) throw accountsError(404, "Item not found");
  const agreed = rupeesToPaise(Number(body.agreedRate ?? body.agreed_rate));
  if (agreed < 0) throw accountsError(400, "Agreed rate must be zero or more");
  const existing = activeLock(tenantId, vendorId, itemId);
  if (existing) {
    getDb()
      .prepare("UPDATE vendor_price_locks SET agreed_paise = ? WHERE id = ? AND tenant_id = ?")
      .run(agreed, existing.id, tenantId);
  } else {
    getDb()
      .prepare(
        `INSERT INTO vendor_price_locks (id, tenant_id, vendor_id, item_id, agreed_paise, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(nid("lock"), tenantId, vendorId, itemId, agreed, nowIso());
  }
  return listPriceLocks(tenantId).find((row) => row.vendorId === vendorId && row.itemId === itemId);
}

export function deletePriceLock(tenantId: string, id: string) {
  const result = getDb()
    .prepare("UPDATE vendor_price_locks SET deleted_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL")
    .run(nowIso(), id, tenantId);
  if (changesOf(result) !== 1) throw accountsError(404, "Price lock not found");
}

function batchesFor(tenantId: string, itemId?: string): BatchRow[] {
  const sql = itemId
    ? "SELECT * FROM stock_batches WHERE tenant_id = ? AND item_id = ? ORDER BY expiry_date, id"
    : "SELECT * FROM stock_batches WHERE tenant_id = ? ORDER BY expiry_date, id";
  const stmt = getDb().prepare(sql);
  return (itemId ? stmt.all(tenantId, itemId) : stmt.all(tenantId)) as BatchRow[];
}

export function stockSnapshot(tenantId: string) {
  const today = todayFor(tenantId);
  const settings = getAccountsSettings(tenantId);
  const items = listItems(tenantId);
  const batches = batchesFor(tenantId);
  const itemName = new Map(items.map((item) => [item.id, item]));
  const onHand = new Map<string, number>();
  const mapped = batches
    .filter((batch) => itemName.has(batch.item_id))
    .map((batch) => {
      const item = itemName.get(batch.item_id)!;
      const qty = Number(batch.qty_on_hand || 0);
      const days = daysUntil(batch.expiry_date, today);
      const expired = days != null && days < 0;
      if (!expired) onHand.set(batch.item_id, (onHand.get(batch.item_id) || 0) + qty);
      return {
        id: batch.id,
        itemId: batch.item_id,
        itemName: item.name,
        kind: item.kind,
        unit: item.unit,
        hsn: item.hsn,
        gstPercent: item.gstPercent,
        sellPrice: item.sellPrice,
        vendorId: batch.vendor_id,
        batchNo: batch.batch_no,
        expiryDate: batch.expiry_date,
        qty,
        unitCost: paiseToRupees(batch.unit_cost_paise),
        priceFlag: batch.price_flag as PriceFlag,
        daysToExpiry: days,
        expired,
      };
    });
  const lowStock = items
    .filter((item) => item.reorderLevel > 0 && (onHand.get(item.id) || 0) < item.reorderLevel)
    .map((item) => ({
      itemId: item.id,
      name: item.name,
      onHand: onHand.get(item.id) || 0,
      reorderLevel: item.reorderLevel,
    }));
  const nearExpiry = mapped.filter(
    (batch) =>
      batch.qty > 0 &&
      batch.daysToExpiry != null &&
      batch.daysToExpiry >= 0 &&
      batch.daysToExpiry <= settings.nearExpiryDays
  );
  const expired = mapped.filter((batch) => batch.qty > 0 && batch.expired);
  const priceDeviations = mapped.filter((batch) => batch.qty > 0 && batch.priceFlag === "deviation");
  return {
    today,
    settings,
    vendors: listVendors(tenantId),
    items,
    locks: listPriceLocks(tenantId),
    batches: mapped,
    alerts: { lowStock, nearExpiry, expired, priceDeviations },
  };
}

export function stockIn(
  tenantId: string,
  body: Record<string, unknown>,
  actor: { id: string; name: string }
) {
  const item = getItem(tenantId, String(body.itemId || body.item_id || "").trim());
  if (!item) throw accountsError(404, "Item not found");
  const vendor = getVendor(tenantId, String(body.vendorId || body.vendor_id || "").trim());
  if (!vendor) throw accountsError(404, "Vendor not found");
  const batchNo = String(body.batchNo || body.batch_no || "").trim();
  if (!batchNo) throw accountsError(400, "Batch number is required");
  const expiry = assertIsoDate(String(body.expiryDate || body.expiry_date || "").trim(), "Expiry");
  const qty = assertPositiveInt(body.qty ?? body.quantity, "Quantity");
  const unitCostPaise = rupeesToPaise(Number(body.unitCost ?? body.unit_cost ?? 0));
  const lock = activeLock(tenantId, vendor.id, item.id);
  const flag = priceFlag(lock ? Number(lock.agreed_paise) : null, unitCostPaise);
  const id = nid("bat");
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO stock_batches (
        id, tenant_id, item_id, vendor_id, batch_no, expiry_date, qty_on_hand, unit_cost_paise, price_flag, received_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, tenantId, item.id, vendor.id, batchNo.slice(0, 40), expiry, qty, unitCostPaise, flag, now, now);
  getDb()
    .prepare(
      `INSERT INTO stock_movements (
        id, tenant_id, batch_id, item_id, qty, reason, ref_type, ref_id, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, 'stock_in', 'vendor', ?, ?, ?)`
    )
    .run(nid("mov"), tenantId, id, item.id, qty, vendor.id, actor.id, now);
  writeAudit(getDb(), actor.id, actor.name, "Stock in", `${item.name} batch ${batchNo} × ${qty}`, {
    tenantId,
    actorRole: "",
    entityType: "stock_batch",
    entityId: id,
  });
  const snap = stockSnapshot(tenantId);
  return { batch: snap.batches.find((row) => row.id === id), priceFlag: flag, agreedRate: lock ? paiseToRupees(lock.agreed_paise) : null };
}

type ConsumeRequest = { itemId: string; batchId: string; qty: number; refType: string; refId: string; reason: string };

function decrementBatch(tenantId: string, batchId: string, qty: number): BatchRow {
  const result = getDb()
    .prepare(
      `UPDATE stock_batches SET qty_on_hand = qty_on_hand - ?
       WHERE id = ? AND tenant_id = ? AND qty_on_hand >= ?`
    )
    .run(qty, batchId, tenantId, qty);
  if (changesOf(result) !== 1) throw accountsError(409, "Not enough stock in that batch");
  return getDb().prepare("SELECT * FROM stock_batches WHERE id = ? AND tenant_id = ?").get(batchId, tenantId) as BatchRow;
}

function restoreBatch(tenantId: string, batchId: string, qty: number) {
  getDb()
    .prepare("UPDATE stock_batches SET qty_on_hand = qty_on_hand + ? WHERE id = ? AND tenant_id = ?")
    .run(qty, batchId, tenantId);
}

export function consumeStock(
  tenantId: string,
  lines: ConsumeRequest[],
  actor: { id: string; name: string }
): { batchId: string; qty: number; itemId: string }[] {
  const today = todayFor(tenantId);
  const applied: { batchId: string; qty: number; itemId: string; movementId: string }[] = [];
  try {
    for (const line of lines) {
      const item = getItem(tenantId, line.itemId);
      if (!item) throw accountsError(404, "Item not found");
      const qty = assertPositiveInt(line.qty, "Quantity");
      let picks: { id: string; qty: number }[];
      if (line.batchId) {
        const batch = getDb()
          .prepare("SELECT * FROM stock_batches WHERE id = ? AND tenant_id = ? AND item_id = ?")
          .get(line.batchId, tenantId, item.id) as BatchRow | undefined;
        if (!batch) throw accountsError(404, "Batch not found");
        const days = daysUntil(batch.expiry_date, today);
        if (days != null && days < 0) throw accountsError(409, "That batch is expired");
        if (Number(batch.qty_on_hand) < qty) throw accountsError(409, "Not enough stock in that batch");
        picks = [{ id: batch.id, qty }];
      } else {
        const lots = batchesFor(tenantId, item.id).map((batch) => ({
          id: batch.id,
          qty: Number(batch.qty_on_hand || 0),
          expiry: batch.expiry_date,
        }));
        const plan = allocateStock(lots, qty, today);
        if (!plan.ok) throw accountsError(409, `Not enough ${item.name} in stock`);
        picks = plan.picks;
      }
      for (const pick of picks) {
        decrementBatch(tenantId, pick.id, pick.qty);
        const movementId = nid("mov");
        applied.push({ batchId: pick.id, qty: pick.qty, itemId: item.id, movementId });
        getDb()
          .prepare(
            `INSERT INTO stock_movements (
              id, tenant_id, batch_id, item_id, qty, reason, ref_type, ref_id, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(movementId, tenantId, pick.id, item.id, pick.qty, line.reason, line.refType, line.refId, actor.id, nowIso());
      }
    }
  } catch (err) {
    for (const pick of applied) {
      restoreBatch(tenantId, pick.batchId, pick.qty);
      getDb().prepare("DELETE FROM stock_movements WHERE id = ? AND tenant_id = ?").run(pick.movementId, tenantId);
    }
    throw err;
  }
  return applied.map(({ movementId: _movementId, ...pick }) => pick);
}

export type BillStockLine = { itemId: string; batchId: string; qty: number; administrationId: string };

export function readBillStockLines(items: unknown): BillStockLine[] {
  if (!Array.isArray(items)) return [];
  const lines: BillStockLine[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const itemId = String(row.inventoryItemId || row.inventory_item_id || "").trim();
    if (!itemId) continue;
    const administrationId = String(row.administrationId || row.administration_id || "").trim();
    if (administrationId) continue;
    const qty = Math.round(Number(row.quantity || 1));
    lines.push({
      itemId,
      batchId: String(row.inventoryBatchId || row.inventory_batch_id || "").trim(),
      qty,
      administrationId: "",
    });
  }
  return lines;
}

/** Drops an invoice whose stock decrement failed, before the client is told it exists. */
export function discardUnbilledInvoice(tenantId: string, invoiceId: string) {
  getDb().prepare("DELETE FROM invoices WHERE id = ? AND tenant_id = ?").run(invoiceId, tenantId);
}

export function consumeBilledLines(
  tenantId: string,
  invoiceId: string,
  items: unknown,
  actor: { id: string; name: string }
) {
  const lines = readBillStockLines(items).map((line) => ({
    itemId: line.itemId,
    batchId: line.batchId,
    qty: line.qty,
    refType: "invoice",
    refId: invoiceId,
    reason: "billed",
  }));
  if (!lines.length) return [];
  return consumeStock(tenantId, lines, actor);
}

export function billGst(items: unknown): ReturnType<typeof gstBreakdown> {
  const lines: GstLine[] = [];
  if (Array.isArray(items)) {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const quantity = Number(row.quantity || 1);
      const unit = Number(row.unitPrice ?? row.unit_price ?? 0);
      const total = row.total != null || row.line_total != null ? Number(row.total ?? row.line_total) : unit * quantity;
      lines.push({
        taxable: Number.isFinite(total) ? total : 0,
        gstPercent: Number(row.gstPercent ?? row.gst_percent ?? 0),
      });
    }
  }
  return gstBreakdown(lines);
}

function patientInTenant(tenantId: string, patientId: string): boolean {
  const row = getDb().prepare("SELECT id FROM patients WHERE id = ? AND tenant_id = ?").get(patientId, tenantId);
  return Boolean(row);
}

function appointmentInTenant(tenantId: string, appointmentId: string, patientId: string) {
  if (!appointmentId) return;
  const row = getDb()
    .prepare("SELECT patient_id FROM appointments WHERE id = ? AND tenant_id = ?")
    .get(appointmentId, tenantId) as { patient_id?: string } | undefined;
  if (!row) throw accountsError(404, "Appointment not found");
  if (patientId && String(row.patient_id || "") !== patientId) {
    throw accountsError(400, "Appointment does not belong to this patient");
  }
}

export function giveVaccine(
  tenantId: string,
  body: Record<string, unknown>,
  actor: { id: string; name: string }
) {
  const patientId = String(body.patientId || body.patient_id || "").trim();
  if (!patientInTenant(tenantId, patientId)) throw accountsError(404, "Patient not found");
  const appointmentId = String(body.appointmentId || body.appointment_id || "").trim();
  appointmentInTenant(tenantId, appointmentId, patientId);
  const item = getItem(tenantId, String(body.itemId || body.item_id || "").trim());
  if (!item) throw accountsError(404, "Item not found");
  if (item.kind !== "vaccine") throw accountsError(400, "That item is not a vaccine");
  const batchId = String(body.batchId || body.batch_id || "").trim();
  const qty = assertPositiveInt(body.qty ?? 1, "Quantity");
  const id = nid("vx");
  const applied = consumeStock(
    tenantId,
    [{ itemId: item.id, batchId, qty, refType: "vaccine", refId: id, reason: "vaccine" }],
    actor
  );
  const used = applied[0];
  const batch = getDb()
    .prepare("SELECT * FROM stock_batches WHERE id = ? AND tenant_id = ?")
    .get(used.batchId, tenantId) as BatchRow;
  const dose = String(body.dose || "1").trim().slice(0, 40) || "1";
  getDb()
    .prepare(
      `INSERT INTO vaccine_administrations (
        id, tenant_id, patient_id, appointment_id, item_id, batch_id, vaccine_name, batch_no, expiry_date,
        dose, given_by_id, given_by_name, given_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      tenantId,
      patientId,
      appointmentId,
      item.id,
      batch.id,
      item.name,
      batch.batch_no,
      batch.expiry_date,
      dose,
      actor.id,
      actor.name,
      nowIso()
    );
  writeAudit(getDb(), actor.id, actor.name, "Vaccine given", `${item.name} batch ${batch.batch_no}`, {
    tenantId,
    patientId,
    entityType: "vaccine_administration",
    entityId: id,
  });
  return {
    id,
    patientId,
    appointmentId,
    itemId: item.id,
    batchId: batch.id,
    vaccineName: item.name,
    batchNo: batch.batch_no,
    expiryDate: batch.expiry_date,
    dose,
    qty,
    givenAt: nowIso(),
    givenByName: actor.name,
  };
}

export function useConsumable(
  tenantId: string,
  body: Record<string, unknown>,
  actor: { id: string; name: string }
) {
  const patientId = String(body.patientId || body.patient_id || "").trim();
  if (patientId && !patientInTenant(tenantId, patientId)) throw accountsError(404, "Patient not found");
  const appointmentId = String(body.appointmentId || body.appointment_id || "").trim();
  if (appointmentId) appointmentInTenant(tenantId, appointmentId, patientId);
  const item = getItem(tenantId, String(body.itemId || body.item_id || "").trim());
  if (!item) throw accountsError(404, "Item not found");
  if (item.kind === "vaccine") throw accountsError(400, "Give a vaccine from the vaccine record so the batch stays on the patient");
  const qty = assertPositiveInt(body.qty ?? 1, "Quantity");
  const refId = appointmentId || patientId || nid("use");
  consumeStock(
    tenantId,
    [
      {
        itemId: item.id,
        batchId: String(body.batchId || body.batch_id || "").trim(),
        qty,
        refType: "consult",
        refId,
        reason: "consult_use",
      },
    ],
    actor
  );
  return { itemId: item.id, name: item.name, qty };
}

export function listVaccines(tenantId: string, patientId: string) {
  if (patientId && !patientInTenant(tenantId, patientId)) throw accountsError(404, "Patient not found");
  const rows = patientId
    ? getDb()
        .prepare(
          `SELECT * FROM vaccine_administrations WHERE tenant_id = ? AND patient_id = ? ORDER BY given_at DESC`
        )
        .all(tenantId, patientId)
    : getDb()
        .prepare(`SELECT * FROM vaccine_administrations WHERE tenant_id = ? ORDER BY given_at DESC LIMIT 50`)
        .all(tenantId);
  return (rows as Record<string, unknown>[]).map(mapVaccine);
}

function mapVaccine(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    patientId: String(row.patient_id || ""),
    appointmentId: String(row.appointment_id || ""),
    itemId: String(row.item_id || ""),
    batchId: String(row.batch_id || ""),
    vaccineName: String(row.vaccine_name || ""),
    batchNo: String(row.batch_no || ""),
    expiryDate: String(row.expiry_date || ""),
    dose: String(row.dose || ""),
    givenByName: String(row.given_by_name || ""),
    givenAt: String(row.given_at || ""),
  };
}

/** Middle segment of the patient-document storage key. Not a patient id. */
const EXPENSE_RECEIPT_SEGMENT = "clinic-expenses";

export async function createExpense(
  tenantId: string,
  body: Record<string, unknown>,
  actor: { id: string; name: string },
  file?: { originalname: string; mimetype: string; buffer: Buffer } | null
) {
  const billDate = assertIsoDate(String(body.billDate || body.bill_date || todayFor(tenantId)).trim(), "Bill date");
  const taxable = assertNonNegativeInt(body.taxableAmount ?? body.taxable_amount ?? body.amount, "Taxable amount");
  const gstPercent = assertGstRate(body.gstPercent ?? body.gst_percent ?? 0);
  const gst = gstBreakdown([{ taxable, gstPercent }]);
  const total = taxable + gst.tax;
  const id = nid("exp");
  let receiptName = "";
  let receiptMime = "";
  let storageKey = "";
  let storageBackend = "";
  if (file && file.buffer?.length) {
    const mime = await assertAllowedPatientDocument(file.buffer, file.mimetype);
    const stored = await storePatientDocumentBytes(tenantId, EXPENSE_RECEIPT_SEGMENT, file.buffer, mime);
    receiptName = pathBasename(String(file.originalname || "receipt")).slice(0, 120);
    receiptMime = mime;
    storageKey = stored.storageKey;
    storageBackend = stored.storageBackend;
  }
  try {
    getDb()
      .prepare(
        `INSERT INTO clinic_expenses (
          id, tenant_id, vendor_name, bill_number, bill_date, category, taxable_amount, gst_percent, tax_amount,
          total_amount, notes, receipt_filename, receipt_mime, receipt_path, storage_key, storage_backend, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)`
      )
      .run(
        id,
        tenantId,
        String(body.vendorName || body.vendor_name || "").trim().slice(0, 120),
        String(body.billNumber || body.bill_number || "").trim().slice(0, 40),
        billDate,
        String(body.category || "general").trim().slice(0, 40) || "general",
        taxable,
        gstPercent,
        gst.tax,
        total,
        String(body.notes || "").slice(0, 400),
        receiptName,
        receiptMime,
        storageKey,
        storageBackend,
        actor.id,
        nowIso()
      );
  } catch (err) {
    if (storageKey) {
      await removeStoredPatientDocument(tenantId, storageKey, storageBackend).catch(() => undefined);
    }
    throw err;
  }
  return listExpenses(tenantId).find((row) => row.id === id);
}

function pathBasename(value: string): string {
  const parts = value.split(/[/\\]/);
  return parts[parts.length - 1] || "receipt";
}

export function listExpenses(tenantId: string, month?: string) {
  const rows = getDb()
    .prepare(
      `SELECT * FROM clinic_expenses WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY bill_date DESC, created_at DESC`
    )
    .all(tenantId) as Record<string, unknown>[];
  return rows
    .filter((row) => !month || String(row.bill_date || "").startsWith(month))
    .map((row) => {
      const gst = gstBreakdown([{ taxable: Number(row.taxable_amount || 0), gstPercent: Number(row.gst_percent || 0) }]);
      return {
        id: String(row.id),
        vendorName: String(row.vendor_name || ""),
        billNumber: String(row.bill_number || ""),
        billDate: String(row.bill_date || ""),
        category: String(row.category || ""),
        taxableAmount: Number(row.taxable_amount || 0),
        gstPercent: Number(row.gst_percent || 0),
        taxAmount: gst.tax,
        cgst: gst.cgst,
        sgst: gst.sgst,
        totalAmount: Number(row.total_amount || 0),
        notes: String(row.notes || ""),
        hasReceipt: Boolean(String(row.storage_key || "").trim()),
        receiptFilename: String(row.receipt_filename || ""),
      };
    });
}

export async function deleteExpense(tenantId: string, id: string) {
  const row = getDb()
    .prepare(
      "SELECT storage_key, storage_backend FROM clinic_expenses WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL"
    )
    .get(id, tenantId) as { storage_key?: string; storage_backend?: string } | undefined;
  if (!row) throw accountsError(404, "Expense not found");
  const storageKey = String(row.storage_key || "");
  if (storageKey) {
    await removeStoredPatientDocument(tenantId, storageKey, String(row.storage_backend || ""));
  }
  const result = getDb()
    .prepare("UPDATE clinic_expenses SET deleted_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL")
    .run(nowIso(), id, tenantId);
  if (changesOf(result) !== 1) throw accountsError(404, "Expense not found");
}

export async function expenseReceipt(
  tenantId: string,
  id: string
): Promise<{ bytes: Buffer; filename: string; mime: string }> {
  const row = getDb()
    .prepare(
      `SELECT storage_key, storage_backend, receipt_filename, receipt_mime
       FROM clinic_expenses WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
    )
    .get(id, tenantId) as
    | { storage_key?: string; storage_backend?: string; receipt_filename?: string; receipt_mime?: string }
    | undefined;
  const storageKey = String(row?.storage_key || "");
  if (!row || !storageKey) throw accountsError(404, "Receipt not found");
  const bytes = await readStoredPatientDocument(tenantId, storageKey, String(row.storage_backend || ""));
  return {
    bytes,
    filename: row.receipt_filename || "receipt",
    mime: row.receipt_mime || "application/octet-stream",
  };
}

type InvoiceRow = Record<string, unknown>;

function invoicesTouching(tenantId: string, date: string): InvoiceRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM invoices WHERE tenant_id = ? AND (date = ? OR paid_at IS NOT NULL) ORDER BY created_at")
    .all(tenantId, date) as InvoiceRow[];
  return rows;
}

function mapBill(row: InvoiceRow, tz: string) {
  const collectedOn = isCollectedInvoiceStatus(row.status) ? collectedClinicDate(row, tz) : "";
  return {
    id: String(row.id || ""),
    invoiceNumber: String(row.invoice_number || ""),
    patientName: String(row.patient_name || ""),
    date: String(row.date || ""),
    status: String(row.status || ""),
    mode: collectionMode(row.payment_mode),
    paymentMode: String(row.payment_mode || ""),
    amount: isCollectedInvoiceStatus(row.status)
      ? rupee(Number(row.paid_amount) > 0 ? row.paid_amount : row.total_amount)
      : rupee(row.total_amount),
    collectedOn,
    items: row.items,
  };
}

export function refundsOn(tenantId: string, date: string) {
  const tz = tenantTimezone(tenantId);
  const rows = getDb()
    .prepare("SELECT * FROM invoice_refunds WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY created_at")
    .all(tenantId) as Record<string, unknown>[];
  return rows
    .filter((row) => collectedClinicDate({ paid_at: row.created_at }, tz) === date)
    .map((row) => ({
      id: String(row.id),
      invoiceId: String(row.invoice_id),
      amount: rupee(row.amount),
      mode: collectionMode(row.mode),
      reason: String(row.reason || ""),
      createdAt: String(row.created_at || ""),
    }));
}

export function dayCloseReport(tenantId: string, date: string) {
  const tz = tenantTimezone(tenantId);
  const day = assertIsoDate(date || todayFor(tenantId), "Date");
  const bills = invoicesTouching(tenantId, day)
    .map((row) => mapBill(row, tz))
    .filter((bill) => bill.date === day || bill.collectedOn === day);
  const due = bills.filter((bill) => bill.date === day && !isCollectedInvoiceStatus(bill.status) && bill.status.toLowerCase() !== "cancelled");
  const refunds = refundsOn(tenantId, day);
  const saved = getDb()
    .prepare("SELECT * FROM day_closes WHERE tenant_id = ? AND close_date = ?")
    .get(tenantId, day) as Record<string, unknown> | undefined;
  const counted: CountedModes = saved
    ? {
        cash: rupee(saved.counted_cash),
        upi: rupee(saved.counted_upi),
        card: rupee(saved.counted_card),
        razorpay: rupee(saved.counted_razorpay),
      }
    : emptyCounted();
  const totals = dayCloseTotals({
    bills: bills.map((bill) => ({ status: bill.status, amount: bill.amount, mode: bill.mode, collectedOn: bill.collectedOn })),
    refunds,
    counted,
    date: day,
  });
  return {
    date: day,
    ...totals,
    dueCount: due.length,
    dueAmount: due.reduce((sum, bill) => sum + bill.amount, 0),
    bills: bills.map(({ items: _items, ...bill }) => bill),
    refunds,
    closed: Boolean(saved),
    note: saved ? String(saved.note || "") : "",
    closedByName: saved ? String(saved.closed_by_name || "") : "",
    closedAt: saved ? String(saved.closed_at || "") : "",
  };
}

export function saveDayClose(
  tenantId: string,
  body: Record<string, unknown>,
  actor: { id: string; name: string }
) {
  const date = assertIsoDate(String(body.date || todayFor(tenantId)).trim(), "Date");
  const existing = getDb()
    .prepare("SELECT id FROM day_closes WHERE tenant_id = ? AND close_date = ?")
    .get(tenantId, date);
  if (existing) throw accountsError(409, "This day is already closed. An admin can delete the close to redo it.");
  const countedRaw = (body.counted && typeof body.counted === "object" ? body.counted : body) as Record<string, unknown>;
  const counted: CountedModes = {
    cash: assertNonNegativeInt(countedRaw.cash ?? 0, "Counted cash"),
    upi: assertNonNegativeInt(countedRaw.upi ?? 0, "Counted UPI"),
    card: assertNonNegativeInt(countedRaw.card ?? 0, "Counted card"),
    razorpay: assertNonNegativeInt(countedRaw.razorpay ?? 0, "Counted Razorpay"),
  };
  const note = String(body.note || "").slice(0, 500);
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO day_closes (
        id, tenant_id, close_date, counted_cash, counted_upi, counted_card, counted_razorpay,
        note, closed_by_id, closed_by_name, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(nid("close"), tenantId, date, counted.cash, counted.upi, counted.card, counted.razorpay, note, actor.id, actor.name, now);
  writeAudit(getDb(), actor.id, actor.name, "Day closed", date, { tenantId, entityType: "day_close", entityId: date });
  return dayCloseReport(tenantId, date);
}

export function deleteDayClose(tenantId: string, date: string) {
  const day = assertIsoDate(date, "Date");
  const result = getDb().prepare("DELETE FROM day_closes WHERE tenant_id = ? AND close_date = ?").run(tenantId, day);
  if (changesOf(result) !== 1) throw accountsError(404, "Day close not found");
}

export function createRefund(
  tenantId: string,
  body: Record<string, unknown>,
  actor: { id: string; name: string }
) {
  const invoiceId = String(body.invoiceId || body.invoice_id || "").trim();
  const invoice = getDb()
    .prepare("SELECT * FROM invoices WHERE id = ? AND tenant_id = ?")
    .get(invoiceId, tenantId) as InvoiceRow | undefined;
  if (!invoice) throw accountsError(404, "Invoice not found");
  if (!isCollectedInvoiceStatus(invoice.status)) throw accountsError(400, "Refunds apply to a collected bill");
  const amount = assertPositiveInt(body.amount, "Refund amount");
  const paid = rupee(Number(invoice.paid_amount) > 0 ? invoice.paid_amount : invoice.total_amount);
  const already = (
    getDb()
      .prepare(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM invoice_refunds WHERE tenant_id = ? AND invoice_id = ? AND deleted_at IS NULL"
      )
      .get(tenantId, invoiceId) as { total?: number }
  ).total;
  if (rupee(already) + amount > paid) throw accountsError(400, "Refund is more than the amount still collected on this bill");
  const requested = String(body.mode || "").trim();
  const mode = collectionMode(requested || invoice.payment_mode);
  if (mode === "other") throw accountsError(400, "Refund mode must be cash, UPI, card, or Razorpay");
  const id = nid("ref");
  getDb()
    .prepare(
      `INSERT INTO invoice_refunds (id, tenant_id, invoice_id, amount, mode, reason, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, tenantId, invoiceId, amount, mode, String(body.reason || "").slice(0, 240), actor.id, nowIso());
  return { id, invoiceId, amount, mode };
}

export function deleteRefund(tenantId: string, id: string) {
  const result = getDb()
    .prepare("UPDATE invoice_refunds SET deleted_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL")
    .run(nowIso(), id, tenantId);
  if (changesOf(result) !== 1) throw accountsError(404, "Refund not found");
}

function invoiceHasRazorpayCollect(invoice: InvoiceRow): boolean {
  const mode = String(invoice.payment_mode || "").trim().toLowerCase();
  if (mode === "razorpay" || mode === "upi / qr") return true;
  return [invoice.pay_link, invoice.razorpay_order_id, invoice.razorpay_payment_link_id].some(
    (value) => String(value || "").trim() !== ""
  );
}

/** Records the clinic's own UPI. Does not mark a Razorpay pay link paid. */
export function recordClinicUpi(
  tenantId: string,
  invoiceId: string,
  actor: { id: string; name: string }
) {
  const invoice = getDb()
    .prepare("SELECT * FROM invoices WHERE id = ? AND tenant_id = ?")
    .get(invoiceId, tenantId) as InvoiceRow | undefined;
  if (!invoice) throw accountsError(404, "Invoice not found");
  if (isCollectedInvoiceStatus(invoice.status)) throw accountsError(409, "This bill is already collected");
  if (invoiceHasRazorpayCollect(invoice)) {
    throw accountsError(
      400,
      "This bill has a Razorpay pay link. It stays unpaid until a verified webhook."
    );
  }
  const now = nowIso();
  const total = rupee(invoice.total_amount);
  getDb()
    .prepare(
      `UPDATE invoices SET status = 'Paid', paid_amount = ?, payment_mode = 'UPI', payment_ref = ?, paid_at = ?
       WHERE id = ? AND tenant_id = ? AND lower(status) != 'paid'`
    )
    .run(total, `clinic_upi_${invoiceId}`, now, invoiceId, tenantId);
  const appointmentId = String(invoice.appointment_id || "").trim();
  if (appointmentId) {
    getDb().prepare("UPDATE appointments SET is_paid = 1 WHERE id = ? AND tenant_id = ?").run(appointmentId, tenantId);
  }
  writeAudit(getDb(), actor.id, actor.name, "Clinic UPI recorded", String(invoice.invoice_number || invoiceId), {
    tenantId,
    entityType: "invoice",
    entityId: invoiceId,
  });
  return getDb().prepare("SELECT * FROM invoices WHERE id = ? AND tenant_id = ?").get(invoiceId, tenantId) as InvoiceRow;
}

function monthInvoices(tenantId: string, month: string) {
  const tz = tenantTimezone(tenantId);
  const rows = getDb()
    .prepare("SELECT * FROM invoices WHERE tenant_id = ? AND (date LIKE ? OR paid_at IS NOT NULL)")
    .all(tenantId, `${month}%`) as InvoiceRow[];
  return rows
    .map((row) => ({ row, bill: mapBill(row, tz) }))
    .filter(({ bill }) => bill.date.startsWith(month) || bill.collectedOn.startsWith(month));
}

function csvCell(value: string | number): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function monthExport(tenantId: string, month: string, format: "csv" | "xlsx"): { body: Buffer; filename: string; mime: string } {
  if (!/^\d{4}-\d{2}$/.test(month)) throw accountsError(400, "Month must be YYYY-MM");
  const tz = tenantTimezone(tenantId);
  const packed = monthInvoices(tenantId, month);
  const issued = packed.filter(({ bill }) => bill.date.startsWith(month) && bill.status.toLowerCase() !== "cancelled");
  const billRows: (string | number)[][] = [
    ["Date", "Invoice", "Patient", "Status", "Mode", "Taxable", "GST rate", "CGST", "SGST", "Tax", "Total"],
  ];
  const gstOut = new Map<string, { taxable: number; cgst: number; sgst: number; tax: number }>();
  for (const { row, bill } of issued) {
    const gst = billGst(row.items);
    const rateLabel = gst.slices.length === 1 ? String(gst.slices[0].rate) : gst.slices.map((slice) => slice.rate).join("+");
    billRows.push([
      bill.date,
      bill.invoiceNumber,
      bill.patientName,
      bill.status,
      bill.paymentMode || bill.mode,
      gst.exempt + gst.taxable,
      rateLabel || "0",
      gst.cgst,
      gst.sgst,
      gst.tax,
      bill.amount,
    ]);
    if (gst.tax === 0) {
      const bucket = gstOut.get("0") || { taxable: 0, cgst: 0, sgst: 0, tax: 0 };
      bucket.taxable += gst.exempt;
      gstOut.set("0", bucket);
    }
    for (const slice of gst.slices) {
      const key = String(slice.rate);
      const bucket = gstOut.get(key) || { taxable: 0, cgst: 0, sgst: 0, tax: 0 };
      bucket.taxable += slice.taxable;
      bucket.cgst += slice.cgst;
      bucket.sgst += slice.sgst;
      bucket.tax += slice.tax;
      gstOut.set(key, bucket);
    }
  }
  const collectionRows: (string | number)[][] = [["Date", "Invoice", "Patient", "Mode", "Collected"]];
  for (const { bill } of packed) {
    if (!bill.collectedOn.startsWith(month) || !isCollectedInvoiceStatus(bill.status)) continue;
    collectionRows.push([bill.collectedOn, bill.invoiceNumber, bill.patientName, bill.mode, bill.amount]);
  }
  const refundRows = getDb()
    .prepare("SELECT * FROM invoice_refunds WHERE tenant_id = ? AND deleted_at IS NULL")
    .all(tenantId) as Record<string, unknown>[];
  for (const refund of refundRows) {
    const day = collectedClinicDate({ paid_at: refund.created_at }, tz);
    if (!day.startsWith(month)) continue;
    collectionRows.push([day, String(refund.invoice_id), "", `refund ${collectionMode(refund.mode)}`, -rupee(refund.amount)]);
  }
  const expenses = listExpenses(tenantId, month);
  const expenseRows: (string | number)[][] = [
    ["Date", "Vendor", "Bill", "Category", "Taxable", "GST rate", "CGST", "SGST", "Total"],
  ];
  const gstIn = new Map<string, { taxable: number; cgst: number; sgst: number; tax: number }>();
  for (const expense of expenses) {
    expenseRows.push([
      expense.billDate,
      expense.vendorName,
      expense.billNumber,
      expense.category,
      expense.taxableAmount,
      expense.gstPercent,
      expense.cgst,
      expense.sgst,
      expense.totalAmount,
    ]);
    const key = String(expense.gstPercent);
    const bucket = gstIn.get(key) || { taxable: 0, cgst: 0, sgst: 0, tax: 0 };
    bucket.taxable += expense.taxableAmount;
    bucket.cgst += expense.cgst;
    bucket.sgst += expense.sgst;
    bucket.tax += expense.taxAmount;
    gstIn.set(key, bucket);
  }
  const gstRows: (string | number)[][] = [["Side", "Rate", "Taxable", "CGST", "SGST", "Tax"]];
  let outputTax = 0;
  let inputTax = 0;
  for (const [rate, bucket] of [...gstOut.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    gstRows.push(["Output (bills)", rate, bucket.taxable, bucket.cgst, bucket.sgst, bucket.tax]);
    outputTax += bucket.tax;
  }
  for (const [rate, bucket] of [...gstIn.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    gstRows.push(["Input (expenses)", rate, bucket.taxable, bucket.cgst, bucket.sgst, bucket.tax]);
    inputTax += bucket.tax;
  }
  gstRows.push(["Net GST payable", "", "", "", "", outputTax - inputTax]);
  const sheets: XlsxSheet[] = [
    { name: "Bills", rows: billRows },
    { name: "Collections", rows: collectionRows },
    { name: "Expenses", rows: expenseRows },
    { name: "GST", rows: gstRows },
  ];
  if (format === "xlsx") {
    return {
      body: buildXlsx(sheets),
      filename: `lumera-accounts-${month}.xlsx`,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }
  const lines = ["section,date,ref,party,mode,taxable,gst_rate,cgst,sgst,tax,total"];
  for (const row of billRows.slice(1)) {
    lines.push(["bill", row[0], row[1], row[2], row[3], row[5], row[6], row[7], row[8], row[9], row[10]].map(csvCell).join(","));
  }
  for (const row of collectionRows.slice(1)) {
    lines.push(["collection", row[0], row[1], row[2], row[3], "", "", "", "", "", row[4]].map(csvCell).join(","));
  }
  for (const row of expenseRows.slice(1)) {
    lines.push(["expense", row[0], row[2], row[1], row[3], row[4], row[5], row[6], row[7], "", row[8]].map(csvCell).join(","));
  }
  for (const row of gstRows.slice(1)) {
    lines.push(["gst", "", row[0], "", row[1], row[2], "", row[3], row[4], row[5], ""].map(csvCell).join(","));
  }
  return {
    body: Buffer.from(`\uFEFF${lines.join("\n")}\n`, "utf8"),
    filename: `lumera-accounts-${month}.csv`,
    mime: "text/csv; charset=utf-8",
  };
}

export const COLLECTION_MODE_LIST: CollectionMode[] = ["cash", "upi", "card", "razorpay"];

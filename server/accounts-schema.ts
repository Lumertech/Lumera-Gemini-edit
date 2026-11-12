import type { SqlDatabase } from "./sql-engine.ts";

/** Forward-only clinic accounts tables. CREATE IF NOT EXISTS is safe on a second boot. */
export const ACCOUNTS_DDL = `
CREATE TABLE IF NOT EXISTS clinic_vendors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  gstin TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'unit',
  hsn TEXT NOT NULL DEFAULT '',
  gst_percent REAL NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 0,
  sell_price INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS vendor_price_locks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  agreed_paise INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS stock_batches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL DEFAULT '',
  batch_no TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',
  qty_on_hand INTEGER NOT NULL DEFAULT 0,
  unit_cost_paise INTEGER NOT NULL DEFAULT 0,
  price_flag TEXT NOT NULL DEFAULT 'no_lock',
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  qty INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vaccine_administrations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  vaccine_name TEXT NOT NULL,
  batch_no TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',
  dose TEXT NOT NULL DEFAULT '1',
  given_by_id TEXT NOT NULL DEFAULT '',
  given_by_name TEXT NOT NULL DEFAULT '',
  given_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clinic_expenses (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  vendor_name TEXT NOT NULL DEFAULT '',
  bill_number TEXT NOT NULL DEFAULT '',
  bill_date TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  taxable_amount INTEGER NOT NULL DEFAULT 0,
  gst_percent REAL NOT NULL DEFAULT 0,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  receipt_filename TEXT NOT NULL DEFAULT '',
  receipt_mime TEXT NOT NULL DEFAULT '',
  receipt_path TEXT NOT NULL DEFAULT '',
  storage_key TEXT NOT NULL DEFAULT '',
  storage_backend TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS invoice_refunds (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS day_closes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  close_date TEXT NOT NULL,
  counted_cash INTEGER NOT NULL DEFAULT 0,
  counted_upi INTEGER NOT NULL DEFAULT 0,
  counted_card INTEGER NOT NULL DEFAULT 0,
  counted_razorpay INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  closed_by_id TEXT NOT NULL DEFAULT '',
  closed_by_name TEXT NOT NULL DEFAULT '',
  closed_at TEXT NOT NULL,
  UNIQUE (tenant_id, close_date)
);

CREATE TABLE IF NOT EXISTS accounts_settings (
  tenant_id TEXT PRIMARY KEY,
  near_expiry_days INTEGER NOT NULL DEFAULT 30,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clinic_vendors_tenant ON clinic_vendors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant ON inventory_items(tenant_id, kind);
CREATE INDEX IF NOT EXISTS idx_price_locks_tenant ON vendor_price_locks(tenant_id, vendor_id, item_id);
CREATE INDEX IF NOT EXISTS idx_stock_batches_tenant ON stock_batches(tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant ON stock_movements(tenant_id, ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_admin_tenant ON vaccine_administrations(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_clinic_expenses_tenant ON clinic_expenses(tenant_id, bill_date);
CREATE INDEX IF NOT EXISTS idx_invoice_refunds_tenant ON invoice_refunds(tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_day_closes_tenant ON day_closes(tenant_id, close_date);
`;

export function ensureAccountsSchema(database: SqlDatabase): void {
  database.exec(ACCOUNTS_DDL);
  // Databases created before receipt bytes moved onto the patient-document store.
  for (const column of [
    "storage_key TEXT NOT NULL DEFAULT ''",
    "storage_backend TEXT NOT NULL DEFAULT ''",
  ]) {
    try {
      database.exec(`ALTER TABLE clinic_expenses ADD COLUMN ${column}`);
    } catch {
      /* The column is already there. A second boot must keep going. */
    }
  }
}

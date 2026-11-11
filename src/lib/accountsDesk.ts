/** Who may change the day book. Mirrors the server role gates. */
export function accountsRole(role?: string | null): { admin: boolean; desk: boolean; clinical: boolean } {
  const value = String(role || "");
  const admin = value === "CLINIC_ADMIN" || value === "polyclinic_admin";
  const desk = admin || value === "receptionist" || value === "doctor";
  const clinical = admin || value === "doctor";
  return { admin, desk, clinical };
}

export type StockBatchCard = {
  id: string;
  itemId: string;
  itemName: string;
  kind: string;
  unit: string;
  hsn: string;
  gstPercent: number;
  sellPrice: number;
  batchNo: string;
  expiryDate: string;
  qty: number;
  unitCost: number;
  priceFlag: "no_lock" | "match" | "deviation";
  daysToExpiry: number | null;
  expired: boolean;
};

export type CatalogueItem = {
  id: string;
  kind: string;
  name: string;
  unit: string;
  hsn: string;
  gstPercent: number;
  reorderLevel: number;
  sellPrice: number;
};

export type VendorRow = { id: string; name: string; phone: string; gstin: string };

export type PriceLockRow = {
  id: string;
  vendorId: string;
  itemId: string;
  vendorName: string;
  itemName: string;
  agreedRate: number;
};

export type DayClosePayload = {
  date: string;
  expected: { cash: number; upi: number; card: number; razorpay: number; other: number };
  counted: { cash: number; upi: number; card: number; razorpay: number };
  discrepancy: { cash: number; upi: number; card: number; razorpay: number };
  discrepancyTotal: number;
  netExpected: number;
  countedTotal: number;
  refundTotal: number;
  dueCount: number;
  dueAmount: number;
  closed: boolean;
  note: string;
  closedByName: string;
  bills: {
    id: string;
    invoiceNumber: string;
    patientName: string;
    status: string;
    mode: string;
    amount: number;
    collectedOn: string;
  }[];
  refunds: { id: string; invoiceId: string; amount: number; mode: string; reason: string }[];
};

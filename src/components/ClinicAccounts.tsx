import React, { useEffect, useState } from "react";
import { apiFetch, apiFetchResponse } from "../api/http";
import { formatINR } from "../lib/currency";
import { ACCOUNTS_NOTICE, closingSummary, dayCloseTotals, emptyCounted } from "../lib/accountsMath";
import {
  accountsRole,
  type CatalogueItem,
  type DayClosePayload,
  type PriceLockRow,
  type StockBatchCard,
  type VendorRow,
} from "../lib/accountsDesk";
import { useAuth } from "../auth/AuthContext";

const MODES = [
  ["cash", "Cash"],
  ["upi", "UPI"],
  ["card", "Card"],
  ["razorpay", "Razorpay"],
] as const;

type ExpenseRow = {
  id: string;
  vendorName: string;
  billNumber: string;
  billDate: string;
  category: string;
  taxableAmount: number;
  gstPercent: number;
  cgst: number;
  sgst: number;
  totalAmount: number;
  hasReceipt: boolean;
};

/**
 * Day book on the billing screen: close the day, file vendor bills, receive stock.
 * It stays in the appointment → OPD → consult → billing line.
 */
export const ClinicAccounts: React.FC<{ refreshKey?: string }> = ({ refreshKey }) => {
  const { user } = useAuth();
  const role = accountsRole(user?.role);
  const [report, setReport] = useState<DayClosePayload | null>(null);
  const [counted, setCounted] = useState(emptyCounted());
  const [note, setNote] = useState("");
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [locks, setLocks] = useState<PriceLockRow[]>([]);
  const [batches, setBatches] = useState<StockBatchCard[]>([]);
  const [alerts, setAlerts] = useState<{ low: number; near: number; expired: number; deviation: number }>({
    low: 0,
    near: 0,
    expired: 0,
    deviation: 0,
  });
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [itemName, setItemName] = useState("");
  const [itemKind, setItemKind] = useState("consumable");
  const [itemGst, setItemGst] = useState(0);
  const [itemReorder, setItemReorder] = useState(5);
  const [itemSell, setItemSell] = useState(0);
  const [lockVendor, setLockVendor] = useState("");
  const [lockItem, setLockItem] = useState("");
  const [lockRate, setLockRate] = useState("");
  const [nearDays, setNearDays] = useState(30);
  const [stockItem, setStockItem] = useState("");
  const [stockVendor, setStockVendor] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [expiry, setExpiry] = useState("");
  const [qty, setQty] = useState(1);
  const [unitCost, setUnitCost] = useState("");
  const [expVendor, setExpVendor] = useState("");
  const [expBill, setExpBill] = useState("");
  const [expDate, setExpDate] = useState("");
  const [expTaxable, setExpTaxable] = useState("");
  const [expGst, setExpGst] = useState(0);
  const [expFile, setExpFile] = useState<File | null>(null);
  const [month, setMonth] = useState("");

  const load = () => {
    setError("");
    void apiFetch<DayClosePayload>("/api/accounts/day-close")
      .then((data) => {
        setReport(data);
        setMonth(String(data.date || "").slice(0, 7));
        if (!data.closed) {
          setCounted({
            cash: data.expected.cash,
            upi: data.expected.upi,
            card: data.expected.card,
            razorpay: data.expected.razorpay,
          });
        } else {
          setCounted(data.counted);
          setNote(data.note || "");
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Day book failed"));
    void apiFetch<{
      vendors: VendorRow[];
      items: CatalogueItem[];
      locks: PriceLockRow[];
      batches: StockBatchCard[];
      settings: { nearExpiryDays: number };
      alerts: { lowStock: unknown[]; nearExpiry: unknown[]; expired: unknown[]; priceDeviations: unknown[] };
    }>("/api/accounts/stock")
      .then((data) => {
        setVendors(data.vendors || []);
        setItems(data.items || []);
        setLocks(data.locks || []);
        setBatches(data.batches || []);
        setNearDays(data.settings?.nearExpiryDays || 30);
        setAlerts({
          low: data.alerts?.lowStock?.length || 0,
          near: data.alerts?.nearExpiry?.length || 0,
          expired: data.alerts?.expired?.length || 0,
          deviation: data.alerts?.priceDeviations?.length || 0,
        });
        if (!stockItem && data.items?.[0]) setStockItem(data.items[0].id);
        if (!stockVendor && data.vendors?.[0]) setStockVendor(data.vendors[0].id);
      })
      .catch(() => undefined);
    void apiFetch<{ expenses: ExpenseRow[] }>("/api/accounts/expenses")
      .then((data) => setExpenses(data.expenses || []))
      .catch(() => undefined);
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  const preview = report
    ? dayCloseTotals({
        bills: report.bills.map((bill) => ({
          status: bill.status,
          amount: bill.amount,
          mode: bill.mode,
          collectedOn: bill.collectedOn || "",
        })),
        refunds: report.refunds,
        counted,
        date: report.date,
      })
    : null;

  const closeDay = async () => {
    if (!report) return;
    setError("");
    setInfo("");
    try {
      await apiFetch("/api/accounts/day-close", {
        method: "POST",
        body: JSON.stringify({ date: report.date, counted, note }),
      });
      setInfo("Day closed.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not close the day");
    }
  };

  const recordUpi = async (invoiceId: string) => {
    setError("");
    try {
      await apiFetch("/api/accounts/collections/upi", {
        method: "POST",
        body: JSON.stringify({ invoiceId }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record UPI");
    }
  };

  const refund = async (invoiceId: string) => {
    const raw = window.prompt("Refund amount in rupees");
    if (!raw) return;
    const amount = Math.round(Number(raw));
    if (!Number.isInteger(amount) || amount <= 0) return;
    setError("");
    try {
      await apiFetch("/api/accounts/refunds", {
        method: "POST",
        body: JSON.stringify({ invoiceId, amount, reason: "Clinic refund" }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the refund");
    }
  };

  const saveExpense = async () => {
    setError("");
    try {
      if (expFile) {
        const form = new FormData();
        form.set("vendorName", expVendor);
        form.set("billNumber", expBill);
        form.set("billDate", expDate);
        form.set("taxableAmount", String(Math.round(Number(expTaxable) || 0)));
        form.set("gstPercent", String(expGst));
        form.set("category", "vendor");
        form.set("receipt", expFile);
        await apiFetch("/api/accounts/expenses", { method: "POST", body: form });
      } else {
        await apiFetch("/api/accounts/expenses", {
          method: "POST",
          body: JSON.stringify({
            vendorName: expVendor,
            billNumber: expBill,
            billDate: expDate,
            taxableAmount: Math.round(Number(expTaxable) || 0),
            gstPercent: expGst,
            category: "vendor",
          }),
        });
      }
      setExpVendor("");
      setExpBill("");
      setExpTaxable("");
      setExpFile(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the expense");
    }
  };

  const receiveStock = async () => {
    setError("");
    setInfo("");
    try {
      const res = await apiFetch<{ priceFlag: string; agreedRate: number | null }>("/api/accounts/stock-in", {
        method: "POST",
        body: JSON.stringify({
          itemId: stockItem,
          vendorId: stockVendor,
          batchNo,
          expiryDate: expiry,
          qty,
          unitCost: Number(unitCost || 0),
        }),
      });
      setInfo(
        res.priceFlag === "deviation"
          ? `Received. Price differs from the agreed ${formatINR(res.agreedRate || 0)}.`
          : "Stock received."
      );
      setBatchNo("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not receive stock");
    }
  };

  const download = async (format: "csv" | "xlsx") => {
    setError("");
    try {
      const res = await apiFetchResponse(`/api/accounts/export?month=${encodeURIComponent(month)}&format=${format}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `lumera-accounts-${month}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  };

  const summary = preview
    ? closingSummary(preview, { count: report?.dueCount || 0, amount: report?.dueAmount || 0 })
    : "";

  return (
    <section
      className="no-print flex flex-col gap-4 min-w-0 max-w-full overflow-x-hidden"
      data-testid="clinic-accounts"
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 min-w-0">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Day close</p>
          <p className="text-sm text-slate-700 mt-1" data-testid="accounts-notice">{ACCOUNTS_NOTICE}</p>
        </div>
        {report && (
          <p className="text-sm font-semibold text-slate-900" data-testid="day-close-date">
            {report.date}
            {report.closed ? ` · closed${report.closedByName ? ` by ${report.closedByName}` : ""}` : " · open"}
          </p>
        )}
        <div className="flex flex-col gap-2" data-testid="day-close-modes">
          {MODES.map(([key, label]) => {
            const expected = report?.expected[key] || 0;
            const diff = preview ? preview.discrepancy[key] : 0;
            return (
              <div key={key} className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-xl border border-slate-100 p-3 min-w-0">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase text-slate-500">{label}</p>
                  <p className="text-sm font-semibold text-slate-900">Bills {formatINR(expected)}</p>
                </div>
                <label className="text-[11px] text-slate-600 min-w-0">
                  Counted
                  <input
                    type="number"
                    min={0}
                    disabled={!role.desk || Boolean(report?.closed)}
                    data-testid={`counted-${key}`}
                    className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                    value={counted[key]}
                    onChange={(event) => setCounted({ ...counted, [key]: Math.max(0, Math.round(Number(event.target.value) || 0)) })}
                  />
                </label>
                <p className={`text-sm font-semibold self-end ${diff === 0 ? "text-emerald-800" : "text-rose-700"}`} data-testid={`diff-${key}`}>
                  {diff === 0 ? "Matches" : `Difference ${formatINR(diff)}`}
                </p>
              </div>
            );
          })}
        </div>
        {report && report.expected.other !== 0 && (
          <p className="text-xs text-slate-600">Other modes (insurance and the like): {formatINR(report.expected.other)}. They stay out of the four-mode count.</p>
        )}
        <p className="text-sm text-slate-800 break-words" data-testid="day-close-summary">{summary}</p>
        {role.desk && !report?.closed && (
          <div className="flex flex-col gap-2">
            <textarea
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs"
              placeholder="Note for the close"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <button
              type="button"
              data-testid="day-close-submit"
              onClick={() => void closeDay()}
              className="w-full sm:w-auto px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold"
            >
              Close day
            </button>
          </div>
        )}
        {role.admin && report?.closed && (
          <button
            type="button"
            className="text-xs font-semibold text-rose-700"
            onClick={() => {
              void apiFetch(`/api/accounts/day-close?date=${report.date}`, { method: "DELETE" }).then(() => load());
            }}
          >
            Delete this close
          </button>
        )}
        <div className="flex flex-col gap-2" data-testid="day-close-bills">
          {(report?.bills || []).map((bill) => (
            <div key={bill.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-slate-100 pt-2 min-w-0">
              <p className="text-xs text-slate-700 break-words min-w-0">
                {bill.invoiceNumber} · {bill.patientName} · {bill.mode} · {formatINR(bill.amount)} · {bill.status}
              </p>
              {role.desk && (
                <div className="flex flex-wrap gap-2">
                  {bill.status !== "Paid" && (
                    <button type="button" className="text-xs font-semibold text-teal-800" onClick={() => void recordUpi(bill.id)}>
                      Record clinic UPI
                    </button>
                  )}
                  {bill.status === "Paid" && (
                    <button type="button" className="text-xs font-semibold text-amber-800" onClick={() => void refund(bill.id)}>
                      Refund
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {(report?.refunds || []).length > 0 && (
          <ul className="text-xs text-slate-600 space-y-1">
            {report?.refunds.map((row) => (
              <li key={row.id}>Refund {formatINR(row.amount)} · {row.mode}{row.reason ? ` · ${row.reason}` : ""}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 min-w-0" data-testid="expense-panel">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Clinic bills and expenses</p>
        {role.desk && (
          <div className="flex flex-col gap-2">
            <input className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" placeholder="Vendor" value={expVendor} onChange={(e) => setExpVendor(e.target.value)} />
            <input className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" placeholder="Bill number" value={expBill} onChange={(e) => setExpBill(e.target.value)} />
            <input className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} />
            <input className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" type="number" placeholder="Taxable ₹" value={expTaxable} onChange={(e) => setExpTaxable(e.target.value)} />
            <input className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" type="number" placeholder="GST %" value={expGst} onChange={(e) => setExpGst(Number(e.target.value))} />
            <input className="w-full text-xs" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setExpFile(e.target.files?.[0] || null)} />
            <button type="button" data-testid="expense-save" onClick={() => void saveExpense()} className="w-full sm:w-auto px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold">
              Save expense
            </button>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {expenses.map((row) => (
            <div key={row.id} className="text-xs text-slate-700 break-words border-t border-slate-100 pt-2">
              {row.billDate} · {row.vendorName} · {row.billNumber} · taxable {formatINR(row.taxableAmount)} · CGST {formatINR(row.cgst)} · SGST {formatINR(row.sgst)} · {formatINR(row.totalAmount)}
              {row.hasReceipt && (
                <a className="ml-2 text-teal-800 font-semibold" href={`/api/accounts/expenses/${row.id}/receipt`}>Receipt</a>
              )}
              {role.admin && (
                <button
                  type="button"
                  className="ml-2 text-rose-700 font-semibold"
                  onClick={() => {
                    void apiFetch(`/api/accounts/expenses/${row.id}`, { method: "DELETE" }).then(() => load());
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 min-w-0 overflow-x-hidden" data-testid="stock-panel">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Stock</p>
        <p className="text-xs text-slate-600" data-testid="stock-alerts">
          Low stock {alerts.low} · Near expiry {alerts.near} · Expired {alerts.expired} · Price differs {alerts.deviation}
        </p>
        {role.admin && (
          <div className="flex flex-col gap-2 border border-slate-100 rounded-xl p-3" data-testid="accounts-catalogue">
            <p className="text-[11px] font-bold uppercase text-slate-500">Catalogue, price lock, near-expiry</p>
            <input className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" placeholder="Vendor name" value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
            <button
              type="button"
              className="text-xs font-semibold text-left text-teal-800"
              onClick={() => {
                void apiFetch("/api/accounts/vendors", { method: "POST", body: JSON.stringify({ name: vendorName }) }).then(() => {
                  setVendorName("");
                  load();
                });
              }}
            >
              Add vendor
            </button>
            <input className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" placeholder="Item name" value={itemName} onChange={(e) => setItemName(e.target.value)} />
            <select className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={itemKind} onChange={(e) => setItemKind(e.target.value)}>
              <option value="consumable">Consumable</option>
              <option value="medicine">Medicine</option>
              <option value="vaccine">Vaccine</option>
            </select>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="text-[11px] text-slate-600">GST %
                <input className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" type="number" value={itemGst} onChange={(e) => setItemGst(Number(e.target.value))} />
              </label>
              <label className="text-[11px] text-slate-600">Reorder at
                <input className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" type="number" value={itemReorder} onChange={(e) => setItemReorder(Number(e.target.value))} />
              </label>
              <label className="text-[11px] text-slate-600">Sell price ₹
                <input className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" type="number" value={itemSell} onChange={(e) => setItemSell(Number(e.target.value))} />
              </label>
            </div>
            <button
              type="button"
              data-testid="item-save"
              className="text-xs font-semibold text-left text-teal-800"
              onClick={() => {
                void apiFetch("/api/accounts/items", {
                  method: "POST",
                  body: JSON.stringify({ name: itemName, kind: itemKind, gstPercent: itemGst, reorderLevel: itemReorder, sellPrice: itemSell, unit: "unit" }),
                }).then(() => {
                  setItemName("");
                  load();
                }).catch((err) => setError(err instanceof Error ? err.message : "Could not add the item"));
              }}
            >
              Add item
            </button>
            <select className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={lockVendor} onChange={(e) => setLockVendor(e.target.value)}>
              <option value="">Vendor for price lock</option>
              {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
            </select>
            <select className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={lockItem} onChange={(e) => setLockItem(e.target.value)}>
              <option value="">Item for price lock</option>
              {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <input className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" placeholder="Agreed rate ₹" value={lockRate} onChange={(e) => setLockRate(e.target.value)} />
            <button
              type="button"
              data-testid="price-lock-save"
              className="text-xs font-semibold text-left text-teal-800"
              onClick={() => {
                void apiFetch("/api/accounts/price-locks", {
                  method: "POST",
                  body: JSON.stringify({ vendorId: lockVendor, itemId: lockItem, agreedRate: Number(lockRate) }),
                }).then(() => load()).catch((err) => setError(err instanceof Error ? err.message : "Could not save the price lock"));
              }}
            >
              Save price lock
            </button>
            <label className="text-[11px] text-slate-600">
              Near-expiry window (days)
              <input className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" type="number" value={nearDays} onChange={(e) => setNearDays(Number(e.target.value))} />
            </label>
            <button
              type="button"
              className="text-xs font-semibold text-left text-teal-800"
              onClick={() => {
                void apiFetch("/api/accounts/settings", { method: "PATCH", body: JSON.stringify({ nearExpiryDays: nearDays }) }).then(() => load());
              }}
            >
              Save near-expiry setting
            </button>
            <ul className="text-xs text-slate-600 space-y-1">
              {locks.map((lock) => (
                <li key={lock.id} className="break-words">
                  {lock.vendorName} · {lock.itemName} · {formatINR(lock.agreedRate)}
                  <button type="button" className="ml-2 text-rose-700" onClick={() => { void apiFetch(`/api/accounts/price-locks/${lock.id}`, { method: "DELETE" }).then(() => load()); }}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {role.desk && (
          <div className="flex flex-col gap-2" data-testid="stock-in-form">
            <select className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={stockItem} onChange={(e) => setStockItem(e.target.value)}>
              {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <select className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={stockVendor} onChange={(e) => setStockVendor(e.target.value)}>
              {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
            </select>
            <input className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" placeholder="Batch" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} data-testid="stock-batch" />
            <input className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} data-testid="stock-expiry" />
            <input className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
            <input className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" placeholder="Unit cost ₹" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} data-testid="stock-cost" />
            <button type="button" data-testid="stock-in-submit" onClick={() => void receiveStock()} className="w-full sm:w-auto px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold">
              Receive stock
            </button>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {batches.filter((batch) => batch.qty > 0).map((batch) => (
            <div key={batch.id} className="rounded-xl border border-slate-100 p-3 text-xs text-slate-700 break-words min-w-0" data-testid="stock-batch-card">
              <p className="font-semibold text-slate-900">{batch.itemName}</p>
              <p>Batch {batch.batchNo} · exp {batch.expiryDate} · {batch.qty} {batch.unit} · cost {formatINR(batch.unitCost)} · sell {formatINR(batch.sellPrice)}</p>
              <p>
                GST {batch.gstPercent}%
                {batch.priceFlag === "deviation" ? " · price differs from the agreed rate" : ""}
                {batch.expired ? " · expired" : ""}
                {batch.daysToExpiry != null && !batch.expired && batch.daysToExpiry <= nearDays ? " · near expiry" : ""}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 min-w-0" data-testid="accounts-export">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Hand off to the CA</p>
        <p className="text-xs text-slate-600">Bills, collections, expenses, and the GST summary for one month.</p>
        <input className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={month} onChange={(e) => setMonth(e.target.value)} placeholder="YYYY-MM" />
        <div className="flex flex-col sm:flex-row gap-2">
          <button type="button" data-testid="export-csv" onClick={() => void download("csv")} className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold">CSV</button>
          <button type="button" data-testid="export-xlsx" onClick={() => void download("xlsx")} className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold">XLSX</button>
        </div>
      </div>
      {info ? <p className="text-xs text-emerald-800" data-testid="accounts-info">{info}</p> : null}
      {error ? <p className="text-xs text-rose-700" data-testid="accounts-error">{error}</p> : null}
    </section>
  );
};

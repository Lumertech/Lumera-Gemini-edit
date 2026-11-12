import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatINR } from "./currency.ts";
import {
  allocateStock,
  closingSummary,
  collectionMode,
  dayCloseTotals,
  gstBreakdown,
  priceFlag,
  rupeesToPaise,
} from "./accountsMath.ts";

describe("clinic accounts math", () => {
  it("splits GST into CGST and SGST that add back to the tax, and leaves healthcare exempt", () => {
    const taxed = gstBreakdown([{ taxable: 100, gstPercent: 5 }]);
    assert.equal(taxed.tax, 5);
    assert.equal(taxed.cgst, 2.5);
    assert.equal(taxed.sgst, 2.5);
    assert.equal(taxed.cgst + taxed.sgst, taxed.tax);
    assert.equal(taxed.label, "CGST + SGST");

    const odd = gstBreakdown([{ taxable: 20, gstPercent: 5 }]);
    assert.equal(odd.tax, 1);
    assert.equal(odd.cgst + odd.sgst, 1);

    const mixed = gstBreakdown([
      { taxable: 600, gstPercent: 0 },
      { taxable: 200, gstPercent: 12 },
      { taxable: 100, gstPercent: 5 },
    ]);
    assert.equal(mixed.exempt, 600);
    assert.equal(mixed.slices.find((slice) => slice.rate === 12)?.tax, 24);
    assert.equal(mixed.slices.find((slice) => slice.rate === 5)?.tax, 5);
    assert.equal(mixed.tax, 29);
    assert.equal(mixed.cgst + mixed.sgst, mixed.tax);

    const exempt = gstBreakdown([{ taxable: 600, gstPercent: 0 }]);
    assert.equal(exempt.label, "Exempt");
    assert.equal(exempt.tax, 0);
    assert.equal(exempt.slices.length, 0);
  });

  it("matches day-close collections by mode, then subtracts refunds from the counted drawer", () => {
    const totals = dayCloseTotals({
      date: "2026-11-11",
      bills: [
        { status: "Paid", amount: 500, mode: "Cash", collectedOn: "2026-11-11" },
        { status: "Paid", amount: 200, mode: "UPI", collectedOn: "2026-11-11" },
        { status: "Paid", amount: 100, mode: "Card", collectedOn: "2026-11-11" },
        { status: "Paid", amount: 300, mode: "Razorpay", collectedOn: "2026-11-11" },
        { status: "Paid", amount: 80, mode: "Insurance", collectedOn: "2026-11-11" },
        { status: "Paid", amount: 999, mode: "Cash", collectedOn: "2026-11-10" },
        { status: "Unpaid", amount: 400, mode: "", collectedOn: "" },
        { status: "Cancelled", amount: 50, mode: "Cash", collectedOn: "2026-11-11" },
      ],
      refunds: [{ amount: 50, mode: "cash" }],
      counted: { cash: 440, upi: 200, card: 100, razorpay: 300 },
    });
    assert.equal(totals.expected.cash, 450);
    assert.equal(totals.expected.upi, 200);
    assert.equal(totals.expected.card, 100);
    assert.equal(totals.expected.razorpay, 300);
    assert.equal(totals.expected.other, 80);
    assert.equal(totals.fourExpected, 1050);
    assert.equal(totals.netExpected, 1130);
    assert.equal(totals.refundTotal, 50);
    assert.equal(totals.countedTotal, 1040);
    assert.equal(totals.discrepancy.cash, -10);
    assert.equal(totals.discrepancy.upi, 0);
    assert.equal(totals.discrepancyTotal, -10);
    assert.equal(collectionMode("UPI / QR"), "upi");
    assert.equal(collectionMode("Razorpay"), "razorpay");
    const summary = closingSummary(totals, { count: 1, amount: 400 });
    assert.match(summary, /1,130\.00/);
    assert.match(summary, /Discrepancy/);
    assert.match(formatINR(123456), /1,23,456/);
  });

  it("picks the earliest usable batch and refuses expired stock", () => {
    const today = "2026-11-11";
    const plan = allocateStock(
      [
        { id: "later", qty: 5, expiry: "2027-06-01" },
        { id: "soon", qty: 2, expiry: "2026-12-01" },
        { id: "old", qty: 9, expiry: "2020-01-01" },
        { id: "open", qty: 4, expiry: "" },
      ],
      3,
      today
    );
    assert.equal(plan.ok, true);
    if (plan.ok) {
      assert.deepEqual(plan.picks, [
        { id: "soon", qty: 2 },
        { id: "later", qty: 1 },
      ]);
    }
    const blocked = allocateStock([{ id: "old", qty: 9, expiry: "2020-01-01" }], 1, today);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.shortfall, 1);
    assert.equal(priceFlag(null, 9000), "no_lock");
    assert.equal(priceFlag(10000, 10000), "match");
    assert.equal(priceFlag(10000, rupeesToPaise(90)), "deviation");
  });
});

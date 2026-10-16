import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultTooltipProps } from "recharts/es6/component/Tooltip.js";
import { formatINR } from "../../app/applet/src/lib/currency.ts";
import { chartCurrencyFormatter } from "./chartCurrency.ts";

describe("recharts default currency format", () => {
  it("uses formatINR for money series and leaves clinical measures numeric", () => {
    assert.equal(chartCurrencyFormatter(123456.78, "OPD revenue"), formatINR(123456.78));
    assert.equal(chartCurrencyFormatter(9.1, "HbA1c (%)"), 9.1);
    assert.equal(chartCurrencyFormatter(80, "ROM Range (°)"), 80);
    assert.equal(defaultTooltipProps.formatter, chartCurrencyFormatter);
  });
});

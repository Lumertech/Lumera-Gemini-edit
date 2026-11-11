import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildXlsx, crc32 } from "./xlsx-store.ts";

describe("xlsx workbook", () => {
  it("uses the standard CRC and stores sheet text uncompressed", () => {
    assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
    const book = buildXlsx([
      { name: "GST", rows: [["Rate", "Tax"], ["5", 5]] },
      { name: "Bills", rows: [["INV-2026-STOCK"]] },
    ]);
    assert.equal(book.subarray(0, 2).toString(), "PK");
    const text = book.toString("utf8");
    assert.match(text, /GST/);
    assert.match(text, /INV-2026-STOCK/);
    assert.match(text, /sheet1\.xml/);
  });
});

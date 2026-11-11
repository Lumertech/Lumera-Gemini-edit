import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { classifyOutboundStatus, outboundCountLabel, outboundDeliveryCounts } from "./whatsappDelivery.ts";

describe("outbound delivery counts", () => {
  it("counts sent, failed, and pending separately", () => {
    assert.equal(classifyOutboundStatus("delivered"), "sent");
    assert.equal(classifyOutboundStatus("read"), "sent");
    assert.equal(classifyOutboundStatus("accepted"), "sent");
    assert.equal(classifyOutboundStatus("failed"), "failed");
    assert.equal(classifyOutboundStatus("undelivered"), "failed");
    assert.equal(classifyOutboundStatus("rejected"), "failed");
    assert.equal(classifyOutboundStatus("pending"), "pending");
    assert.equal(classifyOutboundStatus(""), "pending");
    const counts = outboundDeliveryCounts(["sent", "failed", "failed", "pending", "delivered"]);
    assert.deepEqual(counts, { sent: 2, failed: 2, pending: 1 });
    assert.equal(outboundCountLabel(counts), "2 sent · 2 failed · 1 pending");
  });

  it("does not call a disconnected clinic live or count every row as dispatched", () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const header = fs.readFileSync(path.join(root, "src/components/WhatsAppAssistant.tsx"), "utf8");
    const panel = fs.readFileSync(path.join(root, "src/components/ClinicWabaConnect.tsx"), "utf8");
    assert.equal(header.includes("WhatsApp Cloud API Live"), false);
    assert.equal(header.includes("dispatched events"), false);
    assert.match(header, /whatsAppPillFromStatus/);
    assert.match(header, /outboundCountLabel/);
    assert.match(panel, /Not connected/);
    assert.match(panel, /Connect WhatsApp/);
    assert.match(panel, /No templates/);
    assert.equal(panel.includes("clinic_appointment_reminder"), false);
  });
});

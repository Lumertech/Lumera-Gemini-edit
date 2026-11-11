import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { bookingNotifyMessage } from "./bookingNotify.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const calendar = fs.readFileSync(path.join(__dirname, "../components/AppointmentsCalendar.tsx"), "utf8");

describe("reception booking WhatsApp notice", () => {
  it("says WhatsApp was sent only when Graph returned a wamid", () => {
    assert.equal(bookingNotifyMessage({ sent: true, wamid: "wamid.BOOKED" }), "Booked, WhatsApp sent");
    assert.equal(bookingNotifyMessage({ sent: true }), "Booked, WhatsApp not sent: Graph error");
    assert.equal(bookingNotifyMessage({ sent: true, wamid: "   " }), "Booked, WhatsApp not sent: Graph error");
    assert.equal(bookingNotifyMessage({ sent: false, reason: "not connected" }), "Booked, WhatsApp not sent: not connected");
    assert.equal(bookingNotifyMessage({ sent: false, reason: "no template" }), "Booked, WhatsApp not sent: no template");
    assert.equal(bookingNotifyMessage({ sent: false, reason: "Graph error" }), "Booked, WhatsApp not sent: Graph error");
    assert.equal(bookingNotifyMessage({ sent: false, reason: "no phone" }), "Booked, WhatsApp not sent: no phone");
    assert.equal(bookingNotifyMessage(undefined), "Booked, WhatsApp not sent: Graph error");
  });

  it("the calendar renders that notice and does not hardcode a silent success", () => {
    assert.match(calendar, /bookingNotifyMessage\(/);
    assert.match(calendar, /data-testid="booking-notify"/);
    assert.equal(calendar.includes("Booked, WhatsApp sent"), false);
    assert.equal(calendar.includes("Lumera"), false);
  });
});

export type BookingNotify = {
  sent?: boolean;
  wamid?: string;
  reason?: string;
};

/** Shown after reception confirms a booking. Sent only when Graph returned a wamid. */
export function bookingNotifyMessage(notify?: BookingNotify | null): string {
  const wamid = String(notify?.wamid || "").trim();
  if (notify?.sent === true && wamid) return "Booked, WhatsApp sent";
  const reason = String(notify?.reason || "").trim() || "Graph error";
  return `Booked, WhatsApp not sent: ${reason}`;
}

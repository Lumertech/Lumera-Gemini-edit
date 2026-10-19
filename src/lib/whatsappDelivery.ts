export type DeliveryBucket = "sent" | "failed" | "pending";

export type DeliveryCounts = { sent: number; failed: number; pending: number };

/** Sent, failed, or still pending. Delivered and read count as sent. */
export function classifyOutboundStatus(status: string): DeliveryBucket {
  const value = String(status || "").trim().toLowerCase();
  if (value === "sent" || value === "delivered" || value === "accepted" || value === "read") return "sent";
  if (
    value.includes("fail") ||
    value.includes("error") ||
    value.includes("reject") ||
    value.includes("undeliver")
  ) {
    return "failed";
  }
  return "pending";
}

export function outboundDeliveryCounts(statuses: readonly string[]): DeliveryCounts {
  const counts: DeliveryCounts = { sent: 0, failed: 0, pending: 0 };
  for (const status of statuses) counts[classifyOutboundStatus(status)] += 1;
  return counts;
}

export function outboundCountLabel(counts: DeliveryCounts): string {
  return `${counts.sent} sent · ${counts.failed} failed · ${counts.pending} pending`;
}

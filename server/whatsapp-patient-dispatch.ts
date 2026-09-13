import { getDb } from "./db.ts";
import { dispatchWhatsAppCloudMessage } from "./graph-whatsapp.ts";
import { isProduction } from "./runtime.ts";

export function walletDispatchStatus(error: string): number {
  if (String(error || "").includes("Top up now")) return 402;
  return isProduction() ? 503 : 502;
}

/** Patient WhatsApp text sends (staff replies, bot replies, Rx, custom outbound). */
export async function dispatchPatientCloudText(opts: {
  tenantId?: string;
  to: string;
  textBody: string;
  previewUrl?: boolean;
}): Promise<
  | { ok: true; channel: "graph" | "sandbox"; messageId?: string }
  | { ok: false; error: string; channel: "none" | "graph" }
> {
  return dispatchWhatsAppCloudMessage({
    to: opts.to,
    kind: "text",
    textBody: opts.textBody,
    previewUrl: opts.previewUrl,
    db: getDb(),
    tenantId: opts.tenantId,
    inCustomerServiceWindow: true,
  });
}

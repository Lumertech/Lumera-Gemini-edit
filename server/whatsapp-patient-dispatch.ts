import { getDb } from "./db.ts";
import { cloudDispatchHttpStatus, dispatchWhatsAppCloudMessage } from "./graph-whatsapp.ts";

export function walletDispatchStatus(error: string, status?: number): number {
  return cloudDispatchHttpStatus(error, status);
}

/** Patient WhatsApp text sends (staff replies, bot replies, Rx, custom outbound). */
export async function dispatchPatientCloudText(opts: {
  tenantId?: string;
  to: string;
  textBody: string;
  previewUrl?: boolean;
  /** True only for a staff-typed reply. Bot, Rx, and outbound triggers are automated. */
  isManual?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<
  | { ok: true; channel: "graph" | "sandbox"; messageId?: string }
  | { ok: false; error: string; channel: "none" | "graph"; status?: number }
> {
  return dispatchWhatsAppCloudMessage({
    to: opts.to,
    kind: "text",
    textBody: opts.textBody,
    previewUrl: opts.previewUrl,
    db: getDb(),
    tenantId: opts.tenantId,
    isManual: opts.isManual,
    fetchImpl: opts.fetchImpl,
  });
}

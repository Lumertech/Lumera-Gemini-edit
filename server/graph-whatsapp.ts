import type { DatabaseSync } from "node:sqlite";
import { graphApiVersion, readSecret } from "./runtime.ts";
import { isUsableGraphToken, isUsablePhoneNumberId } from "./meta-security.ts";

export type GraphCredentials = {
  token: string;
  phoneNumberId: string;
  source: "env" | "tenant";
};

export function resolveGraphCredentials(db?: DatabaseSync | null): GraphCredentials | null {
  const envToken = readSecret("META_ACCESS_TOKEN", "WHATSAPP_ACCESS_TOKEN");
  const envPhone = readSecret("META_PHONE_NUMBER_ID", "WHATSAPP_PHONE_NUMBER_ID");
  if (isUsableGraphToken(envToken) && isUsablePhoneNumberId(envPhone)) {
    return { token: envToken, phoneNumberId: envPhone, source: "env" };
  }

  if (!db) return null;
  try {
    const rows = db
      .prepare(
        `SELECT meta_access_token, phone_number_id FROM tenants
         WHERE COALESCE(meta_access_token, '') != '' AND COALESCE(phone_number_id, '') != ''`
      )
      .all() as { meta_access_token: string; phone_number_id: string }[];
    for (const row of rows) {
      if (isUsableGraphToken(row.meta_access_token) && isUsablePhoneNumberId(row.phone_number_id)) {
        return { token: row.meta_access_token, phoneNumberId: row.phone_number_id, source: "tenant" };
      }
    }
  } catch {
    /* tenants table may be missing in isolated tests */
  }
  return null;
}

export function toWhatsAppRecipient(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

export type GraphMessageResult =
  | { ok: true; messageId: string; graphResponse: unknown }
  | { ok: false; error: string; graphResponse?: unknown };

export async function sendWhatsAppGraphMessage(opts: {
  credentials: GraphCredentials;
  to: string;
  otp: string;
  purpose: string;
  fetchImpl?: typeof fetch;
}): Promise<GraphMessageResult> {
  const recipient = toWhatsAppRecipient(opts.to);
  if (!recipient || recipient.length < 8) {
    return { ok: false, error: "Recipient phone number is not a valid E.164 / numeric WhatsApp id." };
  }

  const version = graphApiVersion();
  const url = `https://graph.facebook.com/${version}/${opts.credentials.phoneNumberId}/messages`;
  const templateName = String(process.env.META_OTP_TEMPLATE_NAME || "").trim();
  const language = String(process.env.META_OTP_TEMPLATE_LANGUAGE || "en").trim() || "en";

  const body = templateName
    ? {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "template",
        template: {
          name: templateName,
          language: { code: language },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: opts.otp }],
            },
            ...(process.env.META_OTP_TEMPLATE_BUTTON === "true"
              ? [
                  {
                    type: "button",
                    sub_type: "url",
                    index: "0",
                    parameters: [{ type: "text", text: opts.otp }],
                  },
                ]
              : []),
          ],
        },
      }
    : {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: {
          preview_url: false,
          body: `Lumera verification code: ${opts.otp}\nAction: ${opts.purpose}\nValid for 5 minutes. Do not share this code.`,
        },
      };

  const fetchImpl = opts.fetchImpl || fetch;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.credentials.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const graphResponse = await res.json().catch(() => ({}));
    const messageId = String(
      (graphResponse as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id || ""
    ).trim();

    if (!res.ok || !messageId) {
      const graphError =
        (graphResponse as { error?: { message?: string } })?.error?.message ||
        `Graph API rejected the OTP send (HTTP ${res.status}).`;
      return { ok: false, error: graphError, graphResponse };
    }

    return { ok: true, messageId, graphResponse };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Graph API request failed.",
    };
  }
}

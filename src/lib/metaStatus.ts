/**
 * Founder confirmed on 2026-10-15 that Lumera Solutions LLP is a Meta Tech
 * Provider for the WhatsApp Business Platform. The dashboard screenshot will
 * be cited once Lumera Meta sends it.
 *
 * META_TECH_PROVIDER_STATEMENT is the public status sentence. Do not add a
 * date or any approved, certified, or verified adjective to that sentence.
 */
export const META_TECH_PROVIDER_STATEMENT =
  "Lumera Solutions LLP is a Meta Tech Provider for the WhatsApp Business Platform.";

export const WHATSAPP_PERMISSIONS_STATUS_SENTENCE =
  "Meta has approved Lumera's WhatsApp permission requests in App Review.";

/** Rollout wording for the WhatsApp section. Not a live-for-clinics claim. */
export const WHATSAPP_FEATURES_ROLLOUT_SENTENCE =
  `${WHATSAPP_PERMISSIONS_STATUS_SENTENCE} WhatsApp features are being rolled out to clinics and may be labelled SANDBOX in the product until then.`;

/** Local simulator payload. Not a live Embedded Signup result. */
export const SANDBOX_FAKE_WABA_MESSAGE =
  `SANDBOX / DEV-ONLY: fake WABA ids stored locally. This is not Meta Embedded Signup. ${META_TECH_PROVIDER_STATEMENT} ${WHATSAPP_PERMISSIONS_STATUS_SENTENCE}`;

export const WHATSAPP_CLOUD_API_SECTION =
  `${META_TECH_PROVIDER_STATEMENT} Lumera provides clinic software that can send and receive WhatsApp messages through Meta's WhatsApp Cloud API after a clinic connects its own WhatsApp Business Account (WABA). Each clinic holds its own WhatsApp Business account and pays Meta directly for messaging; Lumera does not resell WhatsApp messaging. ${WHATSAPP_FEATURES_ROLLOUT_SENTENCE} This section describes processing that applies when the Cloud API or Facebook Login is configured.`;

/** Policy HTML chrome: the statement plus the clinic-owned account fact. */
export const POLICY_HTML_STATUS_LINE =
  `${META_TECH_PROVIDER_STATEMENT} Clinics connect their own WhatsApp Business accounts.`;

/** Clinic-facing status. Always both sentences, whether or not the admin flag is set. */
export const WHATSAPP_CLINIC_STATUS_LINE =
  `${META_TECH_PROVIDER_STATEMENT} ${WHATSAPP_PERMISSIONS_STATUS_SENTENCE}`;

/** Shown when Embedded Signup credentials are missing. No environment variable names. */
export const WHATSAPP_CONNECTION_UNAVAILABLE_SENTENCE =
  "WhatsApp connection isn't available on this environment yet. Contact ravee@lumer.me.";

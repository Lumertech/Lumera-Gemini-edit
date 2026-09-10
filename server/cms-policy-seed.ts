/**
 * Canonical cms_policies bodies for Meta App Review URL surfaces.
 * Source: https://github.com/Lumertech/Lumera-Gemini-edit/issues/26#issuecomment-5624794761
 *
 * Honesty (do not edit out): Lumera is NOT a certified Meta Tech Provider;
 * Meta App Review is NOT submitted. Keep DPDP / subprocessor honesty.
 *
 * These slugs are force-upserted on every boot so pre-#26 certification
 * overclaim rows cannot persist.
 */

export const PRODUCTION_POLICY_ORIGIN = "https://www.mylumera.in";

export type CmsPolicySeed = {
  slug: string;
  title: string;
  body: string;
};

export const PRIVACY_POLICY_BODY = `# Privacy Policy

**Last updated:** September 2026  
**Controller / product:** Lumera Solutions LLP (“Lumera”) — clinic software with optional WhatsApp Cloud API and Facebook Login  
**Contact:** dpo@lumera.me | compliance@lumera.health | privacy@lumera.health

---

### WhatsApp Cloud API & Meta data use (App Review)

Lumera Solutions LLP (“Lumera”) provides clinic software that can send and receive WhatsApp messages through Meta’s WhatsApp Cloud API after a clinic connects a WhatsApp Business Account (WABA). **Lumera is not a certified Meta Tech Provider. This section describes processing that applies when Cloud API / Facebook Login are configured. Meta App Review is not submitted.**

#### What we collect via WhatsApp / Meta
- Phone numbers used for WhatsApp (patient or clinic staff), and related Meta identifiers (e.g. phone_number_id, WABA id) when a clinic connects WhatsApp
- Message content and metadata needed to operate the clinic desk (inbound text, button replies, delivery/read receipts, timestamps, template names)
- Optional clinical artefacts sent at a clinician’s instruction (e.g. appointment reminders, OTP login codes, prescription/invoice PDF links)
- Facebook Login profile data only when a user signs in with Facebook: Facebook user id, name, email (and profile picture URL if provided)
- Opt-in / opt-out and consent records associated with messaging

We do **not** use WhatsApp or Facebook Login data to sell ads, build advertising audiences, or sell personal data to brokers.

#### Why we process it
- Deliver clinic-requested transactional messages (appointments, reminders, OTPs, receipts) consistent with Meta WhatsApp Business Messaging Policy
- Operate webhooks (delivery status, inbound patient messages) for the clinic that owns the WABA
- Authenticate clinic users who choose Facebook Login (server-side token exchange)
- Meet security, abuse-prevention, and India DPDP Act obligations

#### Sharing
- **Meta Platforms** receives message traffic and webhook events as the WhatsApp / Facebook platform operator
- **The clinic (tenant)** is the controller of patient clinical communications; Lumera processes data to provide the product to that clinic
- Infrastructure subprocessors (e.g. hosting, AI note assist) are listed in the Subprocessors section and only receive what is needed to run the feature

#### Opt-in, opt-out, and STOP
- Clinics must obtain valid patient consent before outbound WhatsApp notifications beyond what Meta policy allows
- Patients can opt out of further clinic WhatsApp messages by replying **STOP** (or the clinic’s documented opt-out phrase) on WhatsApp, or by asking the clinic front desk
- After opt-out, Lumera instructs the product path to suppress further non-essential outbound templates to that number for that clinic; transactional/security messages may still be limited to what law or Meta policy requires
- Users who signed in with Facebook can remove Lumera under Facebook **Settings → Apps and Websites**, which can trigger our data deletion callback

#### Retention
- WhatsApp operational logs and conversation copies are retained only as needed for clinic care continuity, security, and legal retention, then deleted or anonymised
- Meta access tokens are stored for the connected clinic WABA and revoked/deleted when the clinic disconnects WhatsApp or requests deletion
- See [Data Deletion Instructions](${PRODUCTION_POLICY_ORIGIN}/data-deletion-instructions) for how to request erasure

#### Contact
Data Protection / privacy requests: **dpo@lumera.me** | **compliance@lumera.health**

---

### India DPDP Act
Lumera processes personal data as a data processor for the clinic (tenant) that is the controller of patient clinical communications, and as a controller for clinic-staff account data. We honour access, correction, and erasure requests consistent with the Digital Personal Data Protection Act, 2023. Clinical records a clinic must keep under medical law may be **anonymised** rather than fully erased where retention is legally required.

### Subprocessors
- **Meta Platforms, Inc. / Meta Platforms Ireland Ltd:** WhatsApp Cloud API, webhooks, and Facebook Login as the platform operator
- **Google Cloud Platform:** Secure container hosting (Cloud Run) and related infrastructure
- **Google Gemini API:** Optional server-side clinical transcription and note assist (only the payload needed to run the feature; not used to sell ads)

Infrastructure subprocessors only receive what is needed to run the requested feature.
`;

export const TERMS_OF_SERVICE_BODY = `# Lumera Terms of Service

**Last updated:** September 2026  
**Jurisdiction:** India  
**Contact:** legal@lumera.health | dpo@lumera.me

**Lumera is not a certified Meta Tech Provider. Meta App Review is not submitted.** These Terms describe the clinic software product and the optional WhatsApp Cloud API / Facebook Login path. They are not a certification or App Review approval claim.

---

### 1. Agreement to Terms
These Terms of Service (“Terms”) constitute a binding legal agreement between Lumera Solutions LLP (“Lumera”) and the registered healthcare facility or medical practitioner (“Tenant”, “Clinic”, or “You”). By utilizing the Lumera Clinician Suite, Admin CMS, or WhatsApp Embedded Signup, you agree to be bound by these Terms.

### 2. WhatsApp Business Account (WABA) & Cloud API governance
- **Integration role:** Lumera may act as software that calls Meta Graph APIs on behalf of a clinic after the clinic connects a WABA. This is not Meta Tech Provider certification and does not mean App Review is submitted or approved.
- **Account Ownership:** The Clinic retains full ownership and control of its WhatsApp Business Account, verified phone numbers, and display names.
- **Acceptable Use & Anti-Spam:** Clinics must strictly adhere to the Meta WhatsApp Business Messaging Policy. Unsolicited promotional broadcasts, deceptive advertising, or non-consented bulk messages are strictly prohibited and constitute grounds for immediate service suspension.
- **Prior Patient Consent:** The Clinic warrants that it has collected valid, revocable patient consent prior to initiating outbound WhatsApp notifications. Patients may opt out by replying **STOP** (see the Privacy Policy).

### 3. Clinical Responsibility & AI Assistive Scope
- Lumera provides assistive decision-support tools, including ambient SOAP transcription, triage drafting, and prescription generation.
- **Licensed Practitioner Prerogative:** All AI-generated suggestions, diagnostic summaries, and prescription drafts are strictly advisory. The licensed treating clinician remains solely responsible for medical diagnosis, treatment plans, and clinical record accuracy.

### 4. India DPDP Act
The Clinic is the controller of patient clinical communications. Lumera processes personal data to provide the product and to meet India Digital Personal Data Protection (DPDP) Act obligations. See the Privacy Policy and Data Deletion Instructions.

### 5. Service Availability
Lumera targets high availability for core clinical and WhatsApp webhook processing. Scheduled maintenance windows are announced in advance in the Admin Audit Log. Until live Meta credentials and App Review are complete, some WhatsApp Graph paths may remain labelled SANDBOX in-product.

### 6. Termination & Data Portability
Upon account termination or cancellation, Clinics may export patient records, EMR notes, and appointment histories within thirty (30) days, subject to medical-record retention law.
`;

export const DATA_DELETION_INSTRUCTIONS_BODY = `# Data Deletion Instructions (Meta / WhatsApp / Facebook Login)

**Last updated:** September 2026  
**Controller / product:** Lumera Solutions LLP — clinic software with optional WhatsApp Cloud API and Facebook Login  
**Public status page:** ${PRODUCTION_POLICY_ORIGIN}/data-deletion-instructions  
**Automated callback (Meta App Dashboard → Data Deletion Request URL):** ${PRODUCTION_POLICY_ORIGIN}/api/meta/data-deletion  
**Status check:** ${PRODUCTION_POLICY_ORIGIN}/api/meta/data-deletion-status?code=YOUR_CODE  
**Email:** dpo@lumera.me | compliance@lumera.health

**Lumera is not a certified Meta Tech Provider. Meta App Review is not submitted.**

## Your right to delete
You can request deletion of personal data Lumera stored because you used Facebook Login, connected a WhatsApp Business Account through Lumera, or messaged a clinic that uses Lumera’s WhatsApp desk. This supports Meta Platform Terms (including user data deletion) and India’s DPDP Act. Clinical records a clinic must keep under medical law may be **anonymised** rather than fully erased where retention is legally required.

## Option 1 — Delete via Facebook / Meta (recommended for App Review testers)
1. Open Facebook → **Settings & privacy** → **Settings**
2. Open **Apps and Websites**
3. Select **Lumera** (or the Lumera app name shown in Dashboard)
4. Choose **Remove**
5. Open **View removed apps and websites** → find Lumera → **Send request** for data deletion
6. Meta calls our callback at \`${PRODUCTION_POLICY_ORIGIN}/api/meta/data-deletion\`. You receive a **confirmation code** (and a link back to this page). Keep that code.
7. Check status anytime: paste the code in the checker on this page, or open  
   \`${PRODUCTION_POLICY_ORIGIN}/api/meta/data-deletion-status?code=YOUR_CODE\`

## Option 2 — Email the Data Protection Office
Email **dpo@lumera.me** with subject \`Data deletion request\` and include:
- Full name (or clinic name)
- Email and/or WhatsApp phone number (with country code)
- Facebook user id or WABA id if you have it
- Whether you want Facebook Login data, WhatsApp desk data, or both deleted

We aim to confirm within **48 business hours** and send a confirmation code or completion notice.

## What we delete
- Facebook Login sessions, tokens, and profile fields we stored for your account
- WhatsApp conversation copies, outbound event logs, and cached media we hold for that identity
- Clinic WABA connection secrets for your tenant when you are an admin requesting full disconnect/erasure

## What we may retain (limited)
- Anonymised security/audit traces without your phone/email
- Records a clinic is legally required to keep (anonymised where possible)

## App Review note
Until Meta App Review is approved and live secrets are configured, some environments may still be labelled SANDBOX in-product. The **URLs above are the production policy surfaces**. Do not treat this page as Dashboard-ready until hosting, \`APP_URL=${PRODUCTION_POLICY_ORIGIN}\`, and a Compliance re-skim are complete.
`;

/** Canonical slugs plus short aliases used by the public policy UI. */
export const CMS_POLICY_UPSERTS: CmsPolicySeed[] = [
  { slug: "privacy-policy", title: "Privacy Policy", body: PRIVACY_POLICY_BODY },
  { slug: "privacy", title: "Privacy Policy", body: PRIVACY_POLICY_BODY },
  { slug: "terms-of-service", title: "Terms of Service", body: TERMS_OF_SERVICE_BODY },
  { slug: "terms", title: "Terms of Service", body: TERMS_OF_SERVICE_BODY },
  { slug: "data-deletion-instructions", title: "Data Deletion Instructions", body: DATA_DELETION_INSTRUCTIONS_BODY },
  { slug: "data-deletion", title: "Data Deletion Instructions", body: DATA_DELETION_INSTRUCTIONS_BODY },
];

export const CMS_POLICY_FORCE_UPSERT_SLUGS = CMS_POLICY_UPSERTS.map((row) => row.slug);

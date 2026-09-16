/**
 * Lumera clinic schema — 1:1 translation of server/db.ts migrate() plus
 * ALTER TABLE steps and server/platform-tenants.ts ensurePlatformTenantSchema().
 *
 * Do not "clean up" types: TEXT stays text (including ISO datetimes and JSON
 * blobs), INTEGER 0/1 flags stay integer, REAL stays real. This file replaces
 * the unused template users/entries model. Runtime still bootstraps via
 * CREATE TABLE IF NOT EXISTS in migrate(); drizzle-kit uses this file for
 * Cloud SQL migrations.
 */
import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  pgTable,
  real,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const whatsappConversations = pgTable("whatsapp_conversations", {
  id: text("id").primaryKey(),
  patientPhone: text("patient_phone").notNull().unique(),
  patientName: text("patient_name").notNull(),
  patientId: text("patient_id"),
  uhid: text("uhid"),
  handoverMode: text("handover_mode").notNull().default("bot"),
  assignedStaff: text("assigned_staff").notNull().default("Unassigned"),
  tags: text("tags").notNull().default("[]"),
  preferredLanguage: text("preferred_language").notNull().default("en"),
  unreadCount: integer("unread_count").notNull().default(0),
  lastMessage: text("last_message").notNull().default(""),
  lastMessageTime: text("last_message_time").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const whatsappMessages = pgTable("whatsapp_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  patientPhone: text("patient_phone").notNull(),
  sender: text("sender").notNull(),
  staffName: text("staff_name"),
  content: text("content").notNull(),
  translatedContent: text("translated_content"),
  detectedLanguage: text("detected_language"),
  timeDisplay: text("time_display").notNull(),
  buttons: text("buttons"),
  media: text("media"),
  audioUrl: text("audio_url"),
  voiceTranscript: text("voice_transcript"),
  status: text("status").notNull().default("delivered"),
  createdAt: text("created_at").notNull(),
});

export const whatsappOutboundEvents = pgTable("whatsapp_outbound_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  patientPhone: text("patient_phone").notNull(),
  patientName: text("patient_name").notNull(),
  status: text("status").notNull().default("delivered"),
  details: text("details").notNull(),
  actionPayload: text("action_payload"),
  sentAt: text("sent_at").notNull(),
});

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  specialty: text("specialty").notNull(),
  country: text("country").notNull(),
  timezone: text("timezone").notNull(),
  phone: text("phone").notNull(),
  trialEndsAt: text("trial_ends_at").notNull(),
  aiScribeMinutesLimit: integer("ai_scribe_minutes_limit").notNull().default(500),
  aiScribeMinutesUsed: integer("ai_scribe_minutes_used").notNull().default(0),
  activeStatus: integer("active_status").notNull().default(1),
  hfrId: text("hfr_id").notNull().default(""),
  wabaId: text("waba_id").default(""),
  phoneNumberId: text("phone_number_id").default(""),
  metaAccessToken: text("meta_access_token").default(""),
  metaTokenExpiresAt: text("meta_token_expires_at").default(""),
  metaWabaName: text("meta_waba_name").default(""),
  metaQualityRating: text("meta_quality_rating").default("GREEN"),
  metaOnboardingStatus: text("meta_onboarding_status").default("pending"),
  tagline: text("tagline").default(""),
  address: text("address").default(""),
  city: text("city").default(""),
  email: text("email").default(""),
  website: text("website").default(""),
  gstin: text("gstin").default(""),
  regId: text("reg_id").default(""),
  upiId: text("upi_id").default(""),
  whatsappNumber: text("whatsapp_number").default(""),
  sealText: text("seal_text").default(""),
  footerDisclaimer: text("footer_disclaimer").default(""),
  practiceSettings: text("practice_settings").default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  practiceType: text("practice_type").default("individual"),
  lifecycleStatus: text("lifecycle_status").default(""),
  ownerName: text("owner_name").default(""),
  ownerEmail: text("owner_email").default(""),
  ownerPhone: text("owner_phone").default(""),
  deletedAt: text("deleted_at"),
});

export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    appointmentId: text("appointment_id").notNull().default(""),
    patientId: text("patient_id").notNull().default(""),
    patientName: text("patient_name").notNull().default(""),
    patientPhone: text("patient_phone").notNull().default(""),
    patientUhid: text("patient_uhid").notNull().default(""),
    date: text("date").notNull(),
    items: text("items").notNull().default("[]"),
    subtotal: integer("subtotal").notNull().default(0),
    discountAmount: integer("discount_amount").notNull().default(0),
    gstin: text("gstin").notNull().default(""),
    gstPercent: real("gst_percent").notNull().default(0),
    taxAmount: integer("tax_amount").notNull().default(0),
    totalAmount: integer("total_amount").notNull().default(0),
    paidAmount: integer("paid_amount").notNull().default(0),
    status: text("status").notNull().default("Unpaid"),
    paymentMode: text("payment_mode").notNull().default(""),
    paymentRef: text("payment_ref").notNull().default(""),
    razorpayOrderId: text("razorpay_order_id").notNull().default(""),
    razorpayPaymentId: text("razorpay_payment_id").notNull().default(""),
    razorpayPaymentLinkId: text("razorpay_payment_link_id").notNull().default(""),
    payLink: text("pay_link").notNull().default(""),
    upiId: text("upi_id").notNull().default(""),
    issuedBy: text("issued_by").notNull().default(""),
    receiptWhatsappStatus: text("receipt_whatsapp_status").notNull().default("unsent"),
    receiptWhatsappChannel: text("receipt_whatsapp_channel").notNull().default(""),
    receiptWhatsappMessageId: text("receipt_whatsapp_message_id").notNull().default(""),
    createdAt: text("created_at").notNull(),
    paidAt: text("paid_at"),
  },
  (t) => [
    unique("invoices_tenant_id_invoice_number_unique").on(t.tenantId, t.invoiceNumber),
    index("idx_invoices_tenant").on(t.tenantId, t.date),
    index("idx_invoices_razorpay_order").on(t.razorpayOrderId),
    index("idx_invoices_payment_link").on(t.razorpayPaymentLinkId),
  ]
);

export const metaTemplates = pgTable("meta_templates", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  wabaId: text("waba_id").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  language: text("language").notNull(),
  status: text("status").notNull().default("PENDING"),
  components: text("components").notNull().default("[]"),
  metaTemplateId: text("meta_template_id"),
  rejectionReason: text("rejection_reason"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const dhisTransactions = pgTable(
  "dhis_transactions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    claimsCount: integer("claims_count").notNull().default(0),
    claimsThreshold: integer("claims_threshold").notNull().default(100),
    monthYear: text("month_year").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    transactionType: text("transaction_type").default("OP_CONSULT"),
    patientId: text("patient_id").default(""),
    abhaAddress: text("abha_address").default(""),
    abhaNumber: text("abha_number").default(""),
    kycStatus: text("kyc_status").default("VERIFIED"),
    recordId: text("record_id").default(""),
    fhirBundleId: text("fhir_bundle_id").default(""),
    incentiveAmount: integer("incentive_amount").default(20),
    clinicShare: integer("clinic_share").default(14),
    lumeraShare: integer("lumera_share").default(6),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "dhis_transactions_tenant_id_tenants_id_fk",
    }).onDelete("cascade"),
  ]
);

export const otpVerifications = pgTable("otp_verifications", {
  id: text("id").primaryKey(),
  phone: text("phone").notNull(),
  email: text("email").notNull(),
  otp: text("otp").notNull(),
  purpose: text("purpose").notNull(),
  payload: text("payload").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  verifiedAt: text("verified_at"),
});

export const abdmConsentArtefacts = pgTable(
  "abdm_consent_artefacts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    patientId: text("patient_id").notNull(),
    consentId: text("consent_id").notNull(),
    artefactJson: text("artefact_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    unique("abdm_consent_artefacts_tenant_id_consent_id_unique").on(t.tenantId, t.consentId),
    index("idx_abdm_consent_tenant_patient").on(t.tenantId, t.patientId),
  ]
);

export const plans = pgTable("plans", {
  code: text("code").primaryKey(),
  displayName: text("display_name").notNull(),
  priceCopy: text("price_copy").notNull().default(""),
  monthlyPrice: integer("monthly_price").notNull().default(0),
  description: text("description").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const tenantSubscriptions = pgTable("tenant_subscriptions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().unique(),
  planCode: text("plan_code").notNull(),
  status: text("status").notNull(),
  billingSource: text("billing_source").notNull().default("manual"),
  startedAt: text("started_at").notNull(),
  endsAt: text("ends_at"),
  renewsAt: text("renews_at"),
  monthlyPrice: integer("monthly_price").notNull().default(0),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Table names present after migrate() — used by schema-contract tests. */
export const LUMERA_TABLE_NAMES = [
  "users",
  "sessions",
  "cms_settings",
  "cms_sections",
  "cms_policies",
  "meta_data_deletion_requests",
  "cms_media",
  "doctors",
  "staff",
  "branches",
  "audit_logs",
  "subscriptions",
  "patients",
  "appointments",
  "prescriptions",
  "lab_reports",
  "whatsapp_conversations",
  "whatsapp_messages",
  "whatsapp_outbound_events",
  "tenants",
  "invoices",
  "meta_templates",
  "dhis_transactions",
  "otp_verifications",
  "abdm_consent_artefacts",
  "plans",
  "tenant_subscriptions",
] as const;

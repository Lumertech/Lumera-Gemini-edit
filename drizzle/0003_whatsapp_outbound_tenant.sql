ALTER TABLE "whatsapp_conversations" ADD COLUMN IF NOT EXISTS "last_inbound_at" text;
--> statement-breakpoint
ALTER TABLE "whatsapp_outbound_events" ADD COLUMN IF NOT EXISTS "tenant_id" text;
--> statement-breakpoint
UPDATE "whatsapp_outbound_events"
SET "tenant_id" = 'tenant-wa-unassigned'
WHERE "tenant_id" IS NULL OR btrim("tenant_id") = '';
--> statement-breakpoint
ALTER TABLE "whatsapp_outbound_events" ALTER COLUMN "tenant_id" SET DEFAULT 'tenant-wa-unassigned';
--> statement-breakpoint
ALTER TABLE "whatsapp_outbound_events" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" DROP CONSTRAINT IF EXISTS "whatsapp_conversations_patient_phone_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_wa_conv_tenant_phone" ON "whatsapp_conversations" ("tenant_id", "patient_phone");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wa_evt_tenant" ON "whatsapp_outbound_events" ("tenant_id");

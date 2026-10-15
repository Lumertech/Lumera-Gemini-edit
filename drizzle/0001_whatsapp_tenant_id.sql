ALTER TABLE "whatsapp_conversations" ADD COLUMN IF NOT EXISTS "tenant_id" text;
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD COLUMN IF NOT EXISTS "phone_number_id" text;
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD COLUMN IF NOT EXISTS "waba_id" text;
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "tenant_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wa_conv_tenant" ON "whatsapp_conversations" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wa_msg_tenant" ON "whatsapp_messages" ("tenant_id");

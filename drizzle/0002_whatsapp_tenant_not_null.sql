UPDATE "whatsapp_conversations"
SET "tenant_id" = 'tenant-wa-unassigned'
WHERE "tenant_id" IS NULL OR btrim("tenant_id") = '';
--> statement-breakpoint
UPDATE "whatsapp_messages"
SET "tenant_id" = 'tenant-wa-unassigned'
WHERE "tenant_id" IS NULL OR btrim("tenant_id") = '';
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ALTER COLUMN "tenant_id" SET DEFAULT 'tenant-wa-unassigned';
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ALTER COLUMN "tenant_id" SET DEFAULT 'tenant-wa-unassigned';
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "shipping_context" jsonb;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "document_snapshot" jsonb;

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "blind_shipping" boolean;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "blind_shipping_address" jsonb;

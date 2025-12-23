-- Add audit_logs table for tracking critical actions
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar REFERENCES "users"("id"),
  "user_name" varchar,
  "action_type" varchar NOT NULL,
  "entity_type" varchar NOT NULL,
  "entity_id" varchar,
  "entity_name" varchar,
  "description" text NOT NULL,
  "old_values" jsonb,
  "new_values" jsonb,
  "ip_address" varchar,
  "user_agent" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Create indexes for audit_logs
CREATE INDEX IF NOT EXISTS "idx_audit_logs_user_id" ON "audit_logs" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_action_type" ON "audit_logs" ("action_type");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_entity_type" ON "audit_logs" ("entity_type");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_created_at" ON "audit_logs" ("created_at");

-- Add missing columns to quotes table if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quotes' AND column_name='customer_id') THEN
    ALTER TABLE "quotes" ADD COLUMN "customer_id" varchar REFERENCES "customers"("id") ON DELETE SET NULL;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quotes' AND column_name='contact_id') THEN
    ALTER TABLE "quotes" ADD COLUMN "contact_id" varchar REFERENCES "customer_contacts"("id") ON DELETE SET NULL;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quotes' AND column_name='status') THEN
    ALTER TABLE "quotes" ADD COLUMN "status" varchar(50) DEFAULT 'draft' NOT NULL;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quotes' AND column_name='valid_until') THEN
    ALTER TABLE "quotes" ADD COLUMN "valid_until" timestamp;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quotes' AND column_name='quickbooks_id') THEN
    ALTER TABLE "quotes" ADD COLUMN "quickbooks_id" varchar(100);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quotes' AND column_name='quickbooks_sync_token') THEN
    ALTER TABLE "quotes" ADD COLUMN "quickbooks_sync_token" varchar(100);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quotes' AND column_name='last_synced_at') THEN
    ALTER TABLE "quotes" ADD COLUMN "last_synced_at" timestamp;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quotes' AND column_name='updated_at') THEN
    ALTER TABLE "quotes" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;
  END IF;
END $$;

-- Create index for customer_id in quotes
CREATE INDEX IF NOT EXISTS "quotes_customer_id_idx" ON "quotes" ("customer_id");


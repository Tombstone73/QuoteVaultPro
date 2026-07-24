CREATE TABLE IF NOT EXISTS "assistant_crm_intake_sessions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "conversation_id" varchar NOT NULL,
  "customer_id" varchar REFERENCES "customers"("id") ON DELETE SET NULL,
  "contact_id" varchar REFERENCES "customer_contacts"("id") ON DELETE SET NULL,
  "command_name" varchar(64) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'collecting',
  "intake_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "proposal_fingerprint" varchar(64),
  "created_by_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "payment_terms" varchar(50) NOT NULL DEFAULT 'due_on_receipt';
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "blind_shipping" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_crm_intake_org_user_idx" ON "assistant_crm_intake_sessions" USING btree ("organization_id","user_id","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_crm_intake_org_conversation_idx" ON "assistant_crm_intake_sessions" USING btree ("organization_id","conversation_id","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_crm_intake_customer_idx" ON "assistant_crm_intake_sessions" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_crm_intake_contact_idx" ON "assistant_crm_intake_sessions" USING btree ("contact_id");

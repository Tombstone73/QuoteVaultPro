CREATE TABLE IF NOT EXISTS "assistant_quote_intake_sessions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "conversation_id" varchar NOT NULL,
  "quote_id" varchar REFERENCES "quotes"("id") ON DELETE SET NULL,
  "status" varchar(32) NOT NULL DEFAULT 'collecting',
  "intake_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "proposal_fingerprint" varchar(64),
  "created_by_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_quote_intake_org_user_idx" ON "assistant_quote_intake_sessions" USING btree ("organization_id","user_id","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_quote_intake_org_conversation_idx" ON "assistant_quote_intake_sessions" USING btree ("organization_id","conversation_id","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_quote_intake_quote_idx" ON "assistant_quote_intake_sessions" USING btree ("quote_id");

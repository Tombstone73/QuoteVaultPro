CREATE TABLE IF NOT EXISTS "assistant_billing_intake_sessions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "conversation_id" varchar NOT NULL,
  "command_name" varchar(64) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'preview_ready',
  "intake_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "proposal_fingerprint" varchar(64),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_billing_intake_org_user_idx"
  ON "assistant_billing_intake_sessions" USING btree ("organization_id", "user_id", "updated_at");

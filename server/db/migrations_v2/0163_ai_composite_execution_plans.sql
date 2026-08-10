CREATE TABLE IF NOT EXISTS "ai_composite_execution_plans" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "conversation_id" varchar NOT NULL REFERENCES "ai_conversations"("id") ON DELETE cascade,
  "context_hash" varchar(128) NOT NULL,
  "composite_fingerprint" varchar(128) NOT NULL,
  "operations" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" varchar(32) DEFAULT 'preview_ready' NOT NULL,
  "plan_version" integer DEFAULT 1 NOT NULL,
  "result" jsonb,
  "correlation_id" varchar(128) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ai_composite_execution_plans_org_user_created_idx"
  ON "ai_composite_execution_plans" ("org_id", "user_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_composite_execution_plans_org_conversation_status_idx"
  ON "ai_composite_execution_plans" ("org_id", "conversation_id", "status");
CREATE INDEX IF NOT EXISTS "ai_composite_execution_plans_correlation_id_idx"
  ON "ai_composite_execution_plans" ("correlation_id");

ALTER TABLE "ai_confirmations" ALTER COLUMN "plan_id" DROP NOT NULL;
ALTER TABLE "ai_confirmations" ADD COLUMN IF NOT EXISTS "composite_plan_id" varchar
  REFERENCES "ai_composite_execution_plans"("id") ON DELETE cascade;
ALTER TABLE "ai_confirmations" DROP CONSTRAINT IF EXISTS "ai_confirmations_one_parent_check";
ALTER TABLE "ai_confirmations" ADD CONSTRAINT "ai_confirmations_one_parent_check"
  CHECK ((CASE WHEN "plan_id" IS NULL THEN 0 ELSE 1 END) + (CASE WHEN "composite_plan_id" IS NULL THEN 0 ELSE 1 END) = 1);
CREATE INDEX IF NOT EXISTS "ai_confirmations_composite_plan_expires_idx"
  ON "ai_confirmations" ("composite_plan_id", "expires_at");

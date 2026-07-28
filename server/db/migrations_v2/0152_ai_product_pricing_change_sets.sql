-- Stage 19J: durable, confirmation-bound active/inactive product pricing change sets.
-- Existing draft-batch records remain purpose-specific and are intentionally not reused.
CREATE TABLE IF NOT EXISTS "ai_product_pricing_change_sets" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "plan_id" varchar REFERENCES "ai_execution_plans"("id") ON DELETE SET NULL,
  "conversation_id" varchar REFERENCES "ai_conversations"("id") ON DELETE SET NULL,
  "actor_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "command_name" varchar(120) NOT NULL,
  "command_version" varchar(64) NOT NULL,
  "request_summary" varchar(1000) NOT NULL,
  "selector" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "operation" jsonb NOT NULL,
  "fingerprint" varchar(128) NOT NULL,
  "proposal_status" varchar(32) NOT NULL DEFAULT 'proposed',
  "confirmation_status" varchar(32) NOT NULL DEFAULT 'pending',
  "execution_status" varchar(32) NOT NULL DEFAULT 'proposed',
  "target_count" integer NOT NULL,
  "eligible_count" integer NOT NULL,
  "excluded_count" integer NOT NULL DEFAULT 0,
  "succeeded_count" integer NOT NULL DEFAULT 0,
  "failed_count" integer NOT NULL DEFAULT 0,
  "conflicted_count" integer NOT NULL DEFAULT 0,
  "idempotency_key" varchar(160),
  "correlation_id" varchar(128),
  "confirmed_at" timestamp with time zone,
  "executed_at" timestamp with time zone,
  "rollback_status" varchar(32) NOT NULL DEFAULT 'available',
  "rollback_plan_id" varchar REFERENCES "ai_execution_plans"("id") ON DELETE SET NULL,
  "rollbacked_at" timestamp with time zone,
  "rollback_actor_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "failure_summary" varchar(1000),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ai_product_pricing_change_sets_org_created_idx"
  ON "ai_product_pricing_change_sets" ("org_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_product_pricing_change_sets_org_status_idx"
  ON "ai_product_pricing_change_sets" ("org_id", "execution_status", "created_at");

CREATE TABLE IF NOT EXISTS "ai_product_pricing_change_set_rows" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "change_set_id" varchar NOT NULL REFERENCES "ai_product_pricing_change_sets"("id") ON DELETE CASCADE,
  "org_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "source_order" integer NOT NULL,
  "product_id" varchar NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
  "product_name" varchar(255) NOT NULL,
  "active_snapshot" boolean NOT NULL,
  "active_tree_version_id" varchar,
  "before_values" jsonb NOT NULL,
  "proposed_values" jsonb NOT NULL,
  "executed_values" jsonb,
  "source_fingerprint" varchar(128) NOT NULL,
  "execution_state" varchar(32) NOT NULL DEFAULT 'pending',
  "exclusion_reason" varchar(1000),
  "failure_reason" varchar(1000),
  "attempt_count" integer NOT NULL DEFAULT 0,
  "rollback_state" varchar(32) NOT NULL DEFAULT 'not_requested',
  "rollback_attempt_count" integer NOT NULL DEFAULT 0,
  "rollback_conflict_reason" varchar(1000),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE("change_set_id", "source_order")
);

CREATE INDEX IF NOT EXISTS "ai_product_pricing_change_set_rows_org_change_state_idx"
  ON "ai_product_pricing_change_set_rows" ("org_id", "change_set_id", "execution_state");
CREATE INDEX IF NOT EXISTS "ai_product_pricing_change_set_rows_org_product_idx"
  ON "ai_product_pricing_change_set_rows" ("org_id", "product_id");

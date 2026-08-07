CREATE TABLE IF NOT EXISTS "ai_operator_tasks" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "conversation_id" varchar NOT NULL REFERENCES "ai_conversations"("id") ON DELETE cascade,
  "domain" varchar(80),
  "goal" varchar(2000) NOT NULL,
  "working_summary" varchar(2000),
  "entity_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "missing_information" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "semantic_changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "confirmation_state" varchar(64) DEFAULT 'none' NOT NULL,
  "status" varchar(64) DEFAULT 'active' NOT NULL,
  "canonical_product_intent_proposal_id" varchar(120),
  "last_observation_summary" varchar(2000),
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ai_operator_tasks_org_conversation_status_idx"
  ON "ai_operator_tasks" ("org_id", "conversation_id", "status", "updated_at");
CREATE INDEX IF NOT EXISTS "ai_operator_tasks_org_user_updated_idx"
  ON "ai_operator_tasks" ("org_id", "user_id", "updated_at");

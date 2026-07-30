CREATE TABLE IF NOT EXISTS "ai_configurable_product_proposals" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "conversation_id" varchar REFERENCES "ai_conversations"("id") ON DELETE SET NULL,
  "actor_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "specification" jsonb NOT NULL,
  "fingerprint" varchar(128) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'proposed',
  "created_product_id" varchar REFERENCES "products"("id") ON DELETE SET NULL,
  "created_pbv2_tree_version_id" varchar REFERENCES "pbv2_tree_versions"("id") ON DELETE SET NULL,
  "idempotency_key" varchar(160),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE("org_id", "conversation_id")
);
CREATE INDEX IF NOT EXISTS "ai_configurable_product_proposals_org_status_idx" ON "ai_configurable_product_proposals" ("org_id", "status", "created_at");

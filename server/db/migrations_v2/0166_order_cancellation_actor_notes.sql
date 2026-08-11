ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "canceled_by_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "cancellation_notes" text;

CREATE INDEX IF NOT EXISTS "orders_canceled_by_user_id_idx"
  ON "orders" ("canceled_by_user_id");

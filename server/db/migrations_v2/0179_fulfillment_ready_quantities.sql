-- Fulfillment controls the mutable quantity physically ready to leave the
-- building. Shipment and pickup handoffs remain immutable fulfillment history.
CREATE TABLE "fulfillment_ready_quantities" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "order_id" varchar NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "order_line_item_id" varchar NOT NULL REFERENCES "order_line_items"("id") ON DELETE CASCADE,
  "ready_waiting_quantity" integer NOT NULL DEFAULT 0 CHECK ("ready_waiting_quantity" >= 0),
  "updated_by_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "fulfillment_ready_quantities_org_order_line_uidx"
    UNIQUE ("organization_id", "order_id", "order_line_item_id")
);
CREATE INDEX "fulfillment_ready_quantities_org_order_idx"
  ON "fulfillment_ready_quantities" ("organization_id", "order_id");
CREATE INDEX "fulfillment_ready_quantities_org_line_idx"
  ON "fulfillment_ready_quantities" ("organization_id", "order_line_item_id");

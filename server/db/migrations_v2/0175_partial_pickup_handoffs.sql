-- Immutable, line-level pickup handoffs.  Existing pickup tickets remain the
-- current workflow envelope; these rows preserve partial physical collection.
CREATE TABLE "pickup_handoffs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "pickup_ticket_id" varchar NOT NULL REFERENCES "pickup_tickets"("id") ON DELETE CASCADE,
  "order_id" varchar NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "handed_off_by_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "notes" text,
  "handed_off_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX "pickup_handoffs_org_order_idx" ON "pickup_handoffs" ("organization_id", "order_id");
CREATE INDEX "pickup_handoffs_ticket_idx" ON "pickup_handoffs" ("pickup_ticket_id");

CREATE TABLE "pickup_handoff_items" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "pickup_handoff_id" varchar NOT NULL REFERENCES "pickup_handoffs"("id") ON DELETE CASCADE,
  "order_id" varchar NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "order_line_item_id" varchar NOT NULL REFERENCES "order_line_items"("id") ON DELETE CASCADE,
  "quantity" integer NOT NULL CHECK ("quantity" > 0),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX "pickup_handoff_items_org_line_idx" ON "pickup_handoff_items" ("organization_id", "order_line_item_id");
CREATE INDEX "pickup_handoff_items_handoff_idx" ON "pickup_handoff_items" ("pickup_handoff_id");

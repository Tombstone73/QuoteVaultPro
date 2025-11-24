-- Add orders table for job management
CREATE TABLE IF NOT EXISTS "orders" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_number" varchar(50) NOT NULL UNIQUE,
  "quote_id" varchar REFERENCES "quotes"("id") ON DELETE SET NULL,
  "customer_id" varchar NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "contact_id" varchar REFERENCES "customer_contacts"("id") ON DELETE SET NULL,
  "status" varchar(50) NOT NULL DEFAULT 'new',
  "priority" varchar(50) NOT NULL DEFAULT 'normal',
  "due_date" timestamp with time zone,
  "promised_date" timestamp with time zone,
  "subtotal" decimal(10, 2) NOT NULL DEFAULT 0,
  "tax" decimal(10, 2) NOT NULL DEFAULT 0,
  "total" decimal(10, 2) NOT NULL DEFAULT 0,
  "discount" decimal(10, 2) NOT NULL DEFAULT 0,
  "notes_internal" text,
  "created_by_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create indexes for orders
CREATE INDEX IF NOT EXISTS "orders_order_number_idx" ON "orders" ("order_number");
CREATE INDEX IF NOT EXISTS "orders_customer_id_idx" ON "orders" ("customer_id");
CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "orders" ("status");
CREATE INDEX IF NOT EXISTS "orders_due_date_idx" ON "orders" ("due_date");
CREATE INDEX IF NOT EXISTS "orders_created_at_idx" ON "orders" ("created_at");
CREATE INDEX IF NOT EXISTS "orders_created_by_user_id_idx" ON "orders" ("created_by_user_id");

-- Add order line items table
CREATE TABLE IF NOT EXISTS "order_line_items" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" varchar NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "quote_line_item_id" varchar REFERENCES "quote_line_items"("id") ON DELETE SET NULL,
  "product_id" varchar NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
  "product_variant_id" varchar REFERENCES "product_variants"("id") ON DELETE SET NULL,
  "description" text NOT NULL,
  "width" decimal(10, 2),
  "height" decimal(10, 2),
  "quantity" integer NOT NULL,
  "sqft" decimal(10, 2),
  "unit_price" decimal(10, 2) NOT NULL,
  "total_price" decimal(10, 2) NOT NULL,
  "status" varchar(50) NOT NULL DEFAULT 'queued',
  "nesting_config_snapshot" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create indexes for order_line_items
CREATE INDEX IF NOT EXISTS "order_line_items_order_id_idx" ON "order_line_items" ("order_id");
CREATE INDEX IF NOT EXISTS "order_line_items_product_id_idx" ON "order_line_items" ("product_id");
CREATE INDEX IF NOT EXISTS "order_line_items_status_idx" ON "order_line_items" ("status");

-- Add orderNumber to globalVariables if it doesn't exist (for auto-incrementing order numbers)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "global_variables" WHERE name='orderNumber') THEN
    INSERT INTO "global_variables" (name, value, description, category, is_active)
    VALUES ('orderNumber', '1', 'Auto-incrementing order number counter', 'system', true);
  END IF;
END $$;

-- Comment: Order statuses are: new, scheduled, in_production, ready_for_pickup, shipped, completed, on_hold, canceled
-- Comment: Order priorities are: rush, normal, low
-- Comment: Order line item statuses are: queued, printing, finishing, done, canceled

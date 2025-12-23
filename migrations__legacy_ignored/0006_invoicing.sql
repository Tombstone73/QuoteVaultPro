-- Invoicing & Payments System (Invoices, Invoice Line Items, Payments)
DO $$ BEGIN
  -- Invoices table
  CREATE TABLE IF NOT EXISTS invoices (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number integer UNIQUE NOT NULL,
    order_id varchar REFERENCES orders(id) ON DELETE SET NULL,
    customer_id varchar NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    status varchar(50) NOT NULL DEFAULT 'draft',
    terms varchar(50) NOT NULL DEFAULT 'due_on_receipt',
    custom_terms varchar(255),
    issue_date timestamp with time zone DEFAULT now() NOT NULL,
    due_date timestamp with time zone,
    subtotal decimal(10,2) NOT NULL DEFAULT '0',
    tax decimal(10,2) NOT NULL DEFAULT '0',
    total decimal(10,2) NOT NULL DEFAULT '0',
    amount_paid decimal(10,2) NOT NULL DEFAULT '0',
    balance_due decimal(10,2) NOT NULL DEFAULT '0',
    notes_public text,
    notes_internal text,
    created_by_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    external_accounting_id varchar,
    sync_status varchar(50) NOT NULL DEFAULT 'pending',
    sync_error text,
    synced_at timestamp with time zone,
    created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp DEFAULT now() NOT NULL
  );

  CREATE INDEX IF NOT EXISTS invoices_invoice_number_idx ON invoices(invoice_number);
  CREATE INDEX IF NOT EXISTS invoices_customer_id_idx ON invoices(customer_id);
  CREATE INDEX IF NOT EXISTS invoices_order_id_idx ON invoices(order_id);
  CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices(status);
  CREATE INDEX IF NOT EXISTS invoices_due_date_idx ON invoices(due_date);
  CREATE INDEX IF NOT EXISTS invoices_sync_status_idx ON invoices(sync_status);

  -- Invoice Line Items table
  CREATE TABLE IF NOT EXISTS invoice_line_items (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id varchar NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    order_line_item_id varchar REFERENCES order_line_items(id) ON DELETE SET NULL,
    product_id varchar NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    product_variant_id varchar REFERENCES product_variants(id) ON DELETE SET NULL,
    product_type varchar(50) NOT NULL DEFAULT 'wide_roll',
    description text NOT NULL,
    width decimal(10,2),
    height decimal(10,2),
    quantity integer NOT NULL,
    sqft decimal(10,2),
    unit_price decimal(10,2) NOT NULL,
    total_price decimal(10,2) NOT NULL,
    specs_json jsonb,
    selected_options jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp DEFAULT now() NOT NULL
  );
  CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_id_idx ON invoice_line_items(invoice_id);
  CREATE INDEX IF NOT EXISTS invoice_line_items_product_id_idx ON invoice_line_items(product_id);

  -- Payments table
  CREATE TABLE IF NOT EXISTS payments (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id varchar NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount decimal(10,2) NOT NULL,
    method varchar(50) NOT NULL DEFAULT 'other',
    notes text,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    external_accounting_id varchar,
    sync_status varchar(50) NOT NULL DEFAULT 'pending',
    sync_error text,
    synced_at timestamp with time zone,
    created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp DEFAULT now() NOT NULL
  );
  CREATE INDEX IF NOT EXISTS payments_invoice_id_idx ON payments(invoice_id);
  CREATE INDEX IF NOT EXISTS payments_method_idx ON payments(method);
  CREATE INDEX IF NOT EXISTS payments_created_by_user_id_idx ON payments(created_by_user_id);
  CREATE INDEX IF NOT EXISTS payments_sync_status_idx ON payments(sync_status);

  -- Initialize next invoice number sequence if missing
  INSERT INTO global_variables (name, value, description, category)
  VALUES ('next_invoice_number','1000','Next invoice number sequence','numbering')
  ON CONFLICT (name) DO NOTHING;
END $$;

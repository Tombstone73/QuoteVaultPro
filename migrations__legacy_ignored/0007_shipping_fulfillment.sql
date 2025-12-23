-- Shipping & Fulfillment System
DO $$ BEGIN
  -- Add fulfillment fields to orders table
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='orders' AND column_name='fulfillment_status'
  ) THEN
    ALTER TABLE orders ADD COLUMN fulfillment_status varchar(50) NOT NULL DEFAULT 'pending';
    CREATE INDEX IF NOT EXISTS orders_fulfillment_status_idx ON orders(fulfillment_status);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='orders' AND column_name='shipping_address'
  ) THEN
    ALTER TABLE orders ADD COLUMN shipping_address jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='orders' AND column_name='packing_slip_html'
  ) THEN
    ALTER TABLE orders ADD COLUMN packing_slip_html text;
  END IF;

  -- Create shipments table
  CREATE TABLE IF NOT EXISTS shipments (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    carrier varchar(100) NOT NULL,
    tracking_number varchar(255),
    shipped_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    notes text,
    external_shipping_id varchar, -- ShipStation / carrier API ID
    sync_status varchar(50) NOT NULL DEFAULT 'pending',
    sync_error text,
    synced_at timestamp with time zone,
    created_by_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp DEFAULT now() NOT NULL
  );

  -- Indexes for shipments
  CREATE INDEX IF NOT EXISTS shipments_order_id_idx ON shipments(order_id);
  CREATE INDEX IF NOT EXISTS shipments_carrier_idx ON shipments(carrier);
  CREATE INDEX IF NOT EXISTS shipments_tracking_number_idx ON shipments(tracking_number);
  CREATE INDEX IF NOT EXISTS shipments_sync_status_idx ON shipments(sync_status);
END $$;

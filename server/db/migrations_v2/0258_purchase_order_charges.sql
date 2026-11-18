ALTER TABLE public.purchase_orders
  ADD COLUMN other_charges jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN landed_cost_allocation jsonb,
  ADD CONSTRAINT purchase_orders_other_charges_array CHECK (jsonb_typeof(other_charges) = 'array');
--> statement-breakpoint
ALTER TABLE public.purchase_order_line_items
  ADD COLUMN purchase_unit varchar(50),
  ADD COLUMN manual_landed_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD CONSTRAINT purchase_order_lines_manual_landed_nonnegative CHECK (manual_landed_amount >= 0);

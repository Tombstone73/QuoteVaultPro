ALTER TABLE public.purchase_orders
  ADD COLUMN version integer NOT NULL DEFAULT 0,
  ADD COLUMN revision integer,
  ADD COLUMN original_total numeric(10,2),
  ADD COLUMN payment_terms varchar(50),
  ADD COLUMN payment_method varchar(50),
  ADD COLUMN payment_instructions text,
  ADD COLUMN actual_costs jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN actual_total numeric(10,2),
  ADD COLUMN actual_provisional boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE public.purchase_order_line_items ADD COLUMN position integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE public.purchase_order_revisions (
  purchase_order_id varchar NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  source varchar(30) NOT NULL,
  reason text,
  actor_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
  snapshot jsonb NOT NULL,
  pdf_bytes bytea NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (purchase_order_id, revision)
);

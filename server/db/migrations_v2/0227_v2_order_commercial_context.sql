-- M6 Orders commercial context.  These are Sales-owned requested facts, not
-- Fulfillment handoffs or mutable Customer address references.
ALTER TABLE v2_sales_order_details
  ADD COLUMN requested_fulfillment_method varchar(24),
  ADD COLUMN requested_destination jsonb,
  ADD COLUMN fulfillment_instructions text,
  ADD COLUMN selling_adjustment_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN selling_adjustment_reason text,
  ADD CONSTRAINT v2_sales_order_details_requested_fulfillment_method_chk
    CHECK (requested_fulfillment_method IS NULL OR requested_fulfillment_method IN ('pickup','shipping','local_delivery')),
  ADD CONSTRAINT v2_sales_order_details_requested_destination_object_chk
    CHECK (requested_destination IS NULL OR jsonb_typeof(requested_destination) = 'object'),
  ADD CONSTRAINT v2_sales_order_details_requested_destination_required_chk
    CHECK ((requested_fulfillment_method IN ('shipping','local_delivery') AND requested_destination IS NOT NULL) OR (requested_fulfillment_method IS NULL OR requested_fulfillment_method = 'pickup')),
  ADD CONSTRAINT v2_sales_order_details_adjustment_reason_chk
    CHECK ((selling_adjustment_cents = 0 AND selling_adjustment_reason IS NULL) OR (selling_adjustment_cents <> 0 AND length(btrim(selling_adjustment_reason)) > 0));

-- Billing remains owner of Invoice totals.  The explicit Sales adjustment is
-- projected into the editable Draft and frozen by the existing issued
-- checkpoint rather than being hidden in a rewritten commercial line.
ALTER TABLE v2_billing_invoices
  ADD COLUMN sales_adjustment_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN sales_adjustment_reason text,
  ADD CONSTRAINT v2_billing_invoices_sales_adjustment_reason_chk
    CHECK ((sales_adjustment_cents = 0 AND sales_adjustment_reason IS NULL) OR (sales_adjustment_cents <> 0 AND length(btrim(sales_adjustment_reason)) > 0));

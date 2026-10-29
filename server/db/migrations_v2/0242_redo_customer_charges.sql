-- Expand only the explicitly authorized creation disposition. Free Redo guards remain strict.
ALTER TABLE orders DROP CONSTRAINT orders_redo_complete;
ALTER TABLE orders ADD CONSTRAINT orders_redo_complete CHECK (
 (redo_root_order_id IS NULL AND redo_source_order_id IS NULL AND redo_reason IS NULL AND redo_explanation IS NULL AND redo_disposition IS NULL AND redo_request_key IS NULL AND redo_request_fingerprint IS NULL)
 OR (redo_root_order_id IS NOT NULL AND redo_source_order_id IS NOT NULL AND redo_reason IS NOT NULL AND redo_reason IN ('Print quality','Production error','Shipping damage','Missing pieces','Customer-requested replacement','Other') AND redo_explanation IS NOT NULL AND redo_disposition IS NOT NULL AND redo_disposition IN ('no_customer_charge','charge_customer') AND redo_request_key IS NOT NULL AND redo_request_fingerprint IS NOT NULL AND promised_date IS NOT NULL AND redo_root_order_id <> id AND redo_source_order_id <> id));
ALTER TABLE orders DROP CONSTRAINT orders_redo_zero_charge;
ALTER TABLE orders ADD CONSTRAINT orders_redo_zero_charge CHECK (redo_disposition IS DISTINCT FROM 'no_customer_charge' OR (total = 0 AND subtotal = 0 AND COALESCE(tax,0) = 0 AND COALESCE(tax_amount,0) = 0 AND discount = 0 AND shipping_cents = 0));
CREATE OR REPLACE FUNCTION enforce_order_redo_source_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_order_id varchar; source_no_charge boolean;
BEGIN
 IF TG_OP = 'UPDATE' AND OLD.redo_source_line_item_id IS NOT NULL AND (NEW.order_id, NEW.redo_source_line_item_id) IS DISTINCT FROM (OLD.order_id, OLD.redo_source_line_item_id) THEN
  RAISE EXCEPTION 'Redo source line is immutable' USING ERRCODE = '23514';
 END IF;
 IF TG_OP = 'UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id AND EXISTS (SELECT 1 FROM order_line_items WHERE redo_source_line_item_id = OLD.id) THEN
  RAISE EXCEPTION 'Cannot move a referenced source line' USING ERRCODE = '23514';
 END IF;
 SELECT redo_source_order_id, redo_disposition = 'no_customer_charge' INTO source_order_id, source_no_charge FROM orders WHERE id = NEW.order_id;
 IF source_order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM order_line_items WHERE id = NEW.redo_source_line_item_id AND order_id = source_order_id) THEN
  RAISE EXCEPTION 'Redo source line must belong to immediate source order' USING ERRCODE = '23514';
 END IF;
 IF source_no_charge AND (NEW.total_price <> 0 OR NEW.unit_price <> 0 OR NEW.override_price_cents IS DISTINCT FROM 0 OR COALESCE(NEW.tax_amount,0) <> 0) THEN
  RAISE EXCEPTION 'No-charge replacement lines require a zero-price override' USING ERRCODE = '23514';
 END IF;
 IF source_order_id IS NULL AND NEW.redo_source_line_item_id IS NOT NULL THEN
  RAISE EXCEPTION 'Source line requires Redo order lineage' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;

-- Immutable provenance on canonical orders; no new operational state machine.
ALTER TABLE orders ADD COLUMN redo_root_order_id varchar REFERENCES orders(id) ON DELETE RESTRICT,
 ADD COLUMN redo_source_order_id varchar REFERENCES orders(id) ON DELETE RESTRICT,
 ADD COLUMN redo_reason text, ADD COLUMN redo_explanation text, ADD COLUMN redo_disposition text,
 ADD COLUMN redo_request_key varchar(36), ADD COLUMN redo_request_fingerprint text;
ALTER TABLE orders ADD CONSTRAINT orders_redo_complete CHECK (
 (redo_root_order_id IS NULL AND redo_source_order_id IS NULL AND redo_reason IS NULL AND redo_explanation IS NULL AND redo_disposition IS NULL AND redo_request_key IS NULL AND redo_request_fingerprint IS NULL)
 OR (redo_root_order_id IS NOT NULL AND redo_source_order_id IS NOT NULL AND redo_reason IS NOT NULL AND redo_reason IN ('Print quality','Production error','Shipping damage','Missing pieces','Customer-requested replacement','Other') AND redo_explanation IS NOT NULL AND redo_disposition IS NOT NULL AND redo_disposition = 'no_customer_charge' AND redo_request_key IS NOT NULL AND redo_request_fingerprint IS NOT NULL AND promised_date IS NOT NULL AND redo_root_order_id <> id AND redo_source_order_id <> id));
ALTER TABLE orders ADD CONSTRAINT orders_redo_zero_charge CHECK (redo_disposition IS NULL OR (total = 0 AND subtotal = 0 AND COALESCE(tax,0) = 0 AND COALESCE(tax_amount,0) = 0 AND discount = 0 AND shipping_cents = 0));
CREATE UNIQUE INDEX orders_redo_request_uidx ON orders(organization_id, redo_request_key) WHERE redo_request_key IS NOT NULL;
CREATE INDEX orders_redo_root_idx ON orders(organization_id, redo_root_order_id) WHERE redo_root_order_id IS NOT NULL;
CREATE INDEX orders_redo_source_idx ON orders(redo_source_order_id) WHERE redo_source_order_id IS NOT NULL;
ALTER TABLE order_line_items ADD COLUMN redo_source_line_item_id varchar REFERENCES order_line_items(id) ON DELETE RESTRICT;
CREATE INDEX order_lines_redo_source_idx ON order_line_items(redo_source_line_item_id) WHERE redo_source_line_item_id IS NOT NULL;
CREATE FUNCTION enforce_order_redo_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_row orders%ROWTYPE;
BEGIN
 IF TG_OP = 'UPDATE' AND (NEW.organization_id, NEW.redo_root_order_id, NEW.redo_source_order_id, NEW.redo_reason, NEW.redo_explanation, NEW.redo_disposition, NEW.redo_request_key, NEW.redo_request_fingerprint) IS DISTINCT FROM (OLD.organization_id, OLD.redo_root_order_id, OLD.redo_source_order_id, OLD.redo_reason, OLD.redo_explanation, OLD.redo_disposition, OLD.redo_request_key, OLD.redo_request_fingerprint) AND (OLD.redo_root_order_id IS NOT NULL OR NEW.redo_root_order_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Redo provenance is immutable' USING ERRCODE = '23514';
 END IF;
 IF TG_OP = 'UPDATE' AND NEW.organization_id IS DISTINCT FROM OLD.organization_id AND EXISTS (SELECT 1 FROM orders WHERE redo_source_order_id = OLD.id OR redo_root_order_id = OLD.id) THEN
  RAISE EXCEPTION 'Cannot move a Redo source to another tenant' USING ERRCODE = '23514';
 END IF;
 IF NEW.redo_source_order_id IS NOT NULL THEN
  SELECT * INTO source_row FROM orders WHERE id = NEW.redo_source_order_id AND organization_id = NEW.organization_id FOR KEY SHARE;
  IF NOT FOUND OR NEW.redo_root_order_id IS DISTINCT FROM COALESCE(source_row.redo_root_order_id, source_row.id) OR NOT EXISTS (SELECT 1 FROM orders WHERE id = NEW.redo_root_order_id AND organization_id = NEW.organization_id AND redo_root_order_id IS NULL) THEN
   RAISE EXCEPTION 'Invalid or cross-tenant Redo lineage' USING ERRCODE = '23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER orders_redo_lineage BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION enforce_order_redo_lineage();
CREATE FUNCTION enforce_order_redo_source_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_order_id varchar;
BEGIN
 IF TG_OP = 'UPDATE' AND OLD.redo_source_line_item_id IS NOT NULL AND (NEW.order_id, NEW.redo_source_line_item_id) IS DISTINCT FROM (OLD.order_id, OLD.redo_source_line_item_id) THEN
  RAISE EXCEPTION 'Redo source line is immutable' USING ERRCODE = '23514';
 END IF;
 IF TG_OP = 'UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id AND EXISTS (SELECT 1 FROM order_line_items WHERE redo_source_line_item_id = OLD.id) THEN
  RAISE EXCEPTION 'Cannot move a referenced source line' USING ERRCODE = '23514';
 END IF;
 SELECT redo_source_order_id INTO source_order_id FROM orders WHERE id = NEW.order_id;
 IF source_order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM order_line_items WHERE id = NEW.redo_source_line_item_id AND order_id = source_order_id) THEN
  RAISE EXCEPTION 'Redo source line must belong to immediate source order' USING ERRCODE = '23514';
 END IF;
 IF source_order_id IS NOT NULL AND (NEW.total_price <> 0 OR NEW.unit_price <> 0 OR NEW.override_price_cents IS DISTINCT FROM 0 OR COALESCE(NEW.tax_amount,0) <> 0) THEN
  RAISE EXCEPTION 'No-charge replacement lines require a zero-price override' USING ERRCODE = '23514';
 END IF;
 IF source_order_id IS NULL AND NEW.redo_source_line_item_id IS NOT NULL THEN
  RAISE EXCEPTION 'Source line requires Redo order lineage' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER order_lines_redo_source BEFORE INSERT OR UPDATE ON order_line_items FOR EACH ROW EXECUTE FUNCTION enforce_order_redo_source_line();

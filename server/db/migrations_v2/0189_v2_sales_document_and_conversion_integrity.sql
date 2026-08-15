-- A shared Sales header is never an untyped document: a Quote or Order
-- subtype must be present by transaction commit. The reverse FKs on the
-- subtype tables already guarantee a subtype cannot target the wrong kind.
CREATE OR REPLACE FUNCTION v2_assert_sales_document_subtype() RETURNS trigger AS $$
BEGIN
  IF NEW.document_kind = 'quote' AND NOT EXISTS (
    SELECT 1 FROM v2_sales_quote_details detail
    WHERE detail.document_id = NEW.id AND detail.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'quote Sales document requires quote lifecycle details' USING ERRCODE = '23514';
  END IF;
  IF NEW.document_kind = 'order' AND NOT EXISTS (
    SELECT 1 FROM v2_sales_order_details detail
    WHERE detail.document_id = NEW.id AND detail.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'order Sales document requires order lifecycle details' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER v2_sales_document_subtype_validate
AFTER INSERT OR UPDATE OF document_kind ON v2_sales_documents
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v2_assert_sales_document_subtype();

-- A converted checkpoint has no valid historical meaning without the one
-- canonical conversion relation. The matching relation may be inserted later
-- in the same transaction, hence the deferred check.
CREATE OR REPLACE FUNCTION v2_assert_sales_converted_checkpoint_relation() RETURNS trigger AS $$
BEGIN
  IF NEW.checkpoint_kind = 'quote_converted' AND NOT EXISTS (
    SELECT 1 FROM v2_sales_quote_conversions conversion
    WHERE conversion.organization_id = NEW.organization_id
      AND conversion.quote_document_id = NEW.quote_document_id
      AND conversion.conversion_checkpoint_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'converted quote checkpoint requires canonical conversion relation' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER v2_sales_converted_checkpoint_relation_validate
AFTER INSERT OR UPDATE OF checkpoint_kind ON v2_sales_quote_checkpoints
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v2_assert_sales_converted_checkpoint_relation();

-- Conversion lineage is append-only once established, just like its
-- checkpoints. It is not a mutable current-state pointer.
CREATE OR REPLACE FUNCTION v2_reject_sales_quote_conversion_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'sales quote conversions are immutable' USING ERRCODE = '23514';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER v2_sales_quote_conversion_immutable
BEFORE UPDATE OR DELETE ON v2_sales_quote_conversions
FOR EACH ROW EXECUTE FUNCTION v2_reject_sales_quote_conversion_mutation();

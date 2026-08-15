-- A committed typed Sales header must not be orphaned by later subtype-row
-- removal. Parent deletion in the same transaction remains possible only
-- because the parent no longer exists when this deferred check runs.
CREATE OR REPLACE FUNCTION v2_assert_sales_subtype_retained() RETURNS trigger AS $$
DECLARE document_id_value varchar := OLD.document_id;
DECLARE organization_id_value varchar := OLD.organization_id;
DECLARE expected_kind varchar := CASE WHEN TG_TABLE_NAME = 'v2_sales_quote_details' THEN 'quote' ELSE 'order' END;
DECLARE subtype_still_exists boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM v2_sales_documents document
    WHERE document.id = document_id_value
      AND document.organization_id = organization_id_value
      AND document.document_kind = expected_kind
  ) THEN
    IF expected_kind = 'quote' THEN
      SELECT EXISTS(SELECT 1 FROM v2_sales_quote_details detail WHERE detail.document_id = document_id_value AND detail.organization_id = organization_id_value) INTO subtype_still_exists;
    ELSE
      SELECT EXISTS(SELECT 1 FROM v2_sales_order_details detail WHERE detail.document_id = document_id_value AND detail.organization_id = organization_id_value) INTO subtype_still_exists;
    END IF;
    IF NOT subtype_still_exists THEN
      RAISE EXCEPTION 'Sales document requires retained typed lifecycle details' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER v2_sales_quote_detail_retained_validate
AFTER DELETE OR UPDATE OF document_id, organization_id ON v2_sales_quote_details
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v2_assert_sales_subtype_retained();
CREATE CONSTRAINT TRIGGER v2_sales_order_detail_retained_validate
AFTER DELETE OR UPDATE OF document_id, organization_id ON v2_sales_order_details
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v2_assert_sales_subtype_retained();

-- The scalar Sales columns are authoritative regardless of JSON naming
-- convention. Forbid both contract camelCase and physical snake_case aliases.
ALTER TABLE v2_sales_documents
  DROP CONSTRAINT v2_sales_documents_terms_no_duplicate_projection_chk;
ALTER TABLE v2_sales_documents
  ADD CONSTRAINT v2_sales_documents_terms_no_duplicate_projection_chk
  CHECK (NOT (terms_json ?| ARRAY[
    'taxContextReference', 'salesRepresentativeId', 'commercialNotes',
    'tax_context_reference', 'sales_representative_id', 'commercial_notes'
  ]));

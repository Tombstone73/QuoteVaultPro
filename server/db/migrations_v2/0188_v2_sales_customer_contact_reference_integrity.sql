-- A current Sales document may use a customer-only or contact-only CRM
-- reference. When it names both, they must be an active CRM relationship in
-- the same organization. This validates the reference at the Sales write
-- boundary without making Sales own or mutate CRM relationship lifecycle.
CREATE OR REPLACE FUNCTION v2_validate_sales_document_customer_contact() RETURNS trigger AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL AND NEW.contact_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM customer_contact_links link
       WHERE link.organization_id = NEW.organization_id
         AND link.customer_id = NEW.customer_id
         AND link.contact_id = NEW.contact_id
         AND link.status = 'active'
     ) THEN
    RAISE EXCEPTION 'sales customer/contact reference is not an active CRM relationship' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER v2_sales_document_customer_contact_validate
BEFORE INSERT OR UPDATE OF organization_id, customer_id, contact_id ON v2_sales_documents
FOR EACH ROW EXECUTE FUNCTION v2_validate_sales_document_customer_contact();

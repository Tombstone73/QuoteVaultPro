-- A V1 Invoice has exactly one explicit billing owner. Existing Customer-owned
-- rows remain unchanged; no Customer or Contact record is synthesized here.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE customer_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot add contact-owned Invoice billing: existing Invoice has no Customer owner';
  END IF;
END $$;

ALTER TABLE invoices ADD COLUMN contact_id varchar REFERENCES customer_contacts(id) ON DELETE RESTRICT;
ALTER TABLE invoices ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE invoices ADD CONSTRAINT invoices_billing_owner_check
  CHECK ((customer_id IS NOT NULL) <> (contact_id IS NOT NULL));
CREATE INDEX invoices_contact_id_idx ON invoices (organization_id, contact_id);

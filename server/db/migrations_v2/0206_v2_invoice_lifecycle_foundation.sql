-- M3 Slice 3: Billing retains the one existing Invoice per Order and adds a
-- durable issued checkpoint. There is no replacement Invoice or payment state.

ALTER TABLE v2_billing_invoices
  ADD COLUMN issued_principal_kind varchar(32),
  ADD COLUMN issued_principal_subject varchar(160),
  ADD COLUMN issued_staff_actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT v2_billing_invoices_issued_actor_chk CHECK (
    (invoice_state = 'issued' AND issued_principal_kind IN ('staff','delegated_ai','portal','service') AND length(btrim(issued_principal_subject)) > 0)
    OR (invoice_state <> 'issued' AND issued_principal_kind IS NULL AND issued_principal_subject IS NULL AND issued_staff_actor_user_id IS NULL)
  );

CREATE TABLE v2_billing_invoice_checkpoints (
  id varchar PRIMARY KEY,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id varchar NOT NULL,
  schema_version integer NOT NULL,
  evidence_fingerprint varchar(128) NOT NULL,
  checkpoint_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_billing_invoice_checkpoints_schema_chk CHECK (schema_version = 1),
  CONSTRAINT v2_billing_invoice_checkpoints_fingerprint_chk CHECK (length(btrim(evidence_fingerprint)) > 0),
  CONSTRAINT v2_billing_invoice_checkpoints_json_object_chk CHECK (jsonb_typeof(checkpoint_json) = 'object'),
  CONSTRAINT v2_billing_invoice_checkpoints_id_org_uidx UNIQUE (id, organization_id),
  CONSTRAINT v2_billing_invoice_checkpoints_invoice_org_uidx UNIQUE (invoice_id, organization_id),
  CONSTRAINT v2_billing_invoice_checkpoints_invoice_tenant_fk FOREIGN KEY (invoice_id, organization_id)
    REFERENCES v2_billing_invoices (id, organization_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION v2_billing_invoice_lifecycle_validate() RETURNS trigger AS $$
DECLARE current_state varchar(24);
BEGIN
  IF TG_TABLE_NAME = 'v2_billing_invoices' THEN
    IF OLD.invoice_state <> 'draft' THEN
      RAISE EXCEPTION 'Issued or void Invoice history is immutable.';
    END IF;
    IF NEW.invoice_state = 'void' THEN
      RAISE EXCEPTION 'Invoice void requires a future canonical Billing operation.';
    END IF;
    IF NEW.invoice_state <> 'draft' AND NEW.invoice_state <> 'issued' THEN
      RAISE EXCEPTION 'Invoice lifecycle transition is invalid.';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'v2_billing_invoice_lines' THEN
    SELECT invoice_state INTO current_state FROM v2_billing_invoices
      WHERE organization_id = COALESCE(NEW.organization_id, OLD.organization_id)
        AND id = COALESCE(NEW.invoice_id, OLD.invoice_id);
    IF current_state IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Issued or void Invoice lines are immutable.';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Unsupported Billing lifecycle trigger target.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER v2_billing_invoice_lifecycle_immutable_trigger
BEFORE UPDATE OR DELETE ON v2_billing_invoices
FOR EACH ROW EXECUTE FUNCTION v2_billing_invoice_lifecycle_validate();

CREATE TRIGGER v2_billing_invoice_line_lifecycle_immutable_trigger
BEFORE INSERT OR UPDATE OR DELETE ON v2_billing_invoice_lines
FOR EACH ROW EXECUTE FUNCTION v2_billing_invoice_lifecycle_validate();

CREATE OR REPLACE FUNCTION v2_billing_invoice_checkpoint_immutable_validate() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Issued Invoice checkpoints are immutable.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER v2_billing_invoice_checkpoint_immutable_trigger
BEFORE INSERT OR UPDATE OR DELETE ON v2_billing_invoice_checkpoints
FOR EACH ROW EXECUTE FUNCTION v2_billing_invoice_checkpoint_immutable_validate();

CREATE INDEX v2_billing_invoice_checkpoints_org_created_idx
  ON v2_billing_invoice_checkpoints (organization_id, created_at DESC);

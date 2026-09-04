-- M6: an issued checkpoint remains immutable evidence, while the one canonical
-- Order-backed Invoice continues to project the Order's current commercial
-- facts. This is not a replacement Invoice and does not mutate payments.
CREATE OR REPLACE FUNCTION v2_billing_invoice_lifecycle_validate() RETURNS trigger AS $$
DECLARE current_state varchar(24);
BEGIN
  IF TG_TABLE_NAME = 'v2_billing_invoices' THEN
    IF OLD.invoice_state = 'void' THEN
      RAISE EXCEPTION 'Void Invoice history is immutable.';
    END IF;
    IF OLD.invoice_state = 'issued' THEN
      IF NEW.invoice_state <> 'issued'
        OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
        OR NEW.issued_principal_kind IS DISTINCT FROM OLD.issued_principal_kind
        OR NEW.issued_principal_subject IS DISTINCT FROM OLD.issued_principal_subject
        OR NEW.issued_staff_actor_user_id IS DISTINCT FROM OLD.issued_staff_actor_user_id THEN
        RAISE EXCEPTION 'An issued Invoice checkpoint lifecycle is immutable.';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.invoice_state = 'void' THEN
      RAISE EXCEPTION 'Invoice void requires a future canonical Billing operation.';
    END IF;
    IF NEW.invoice_state NOT IN ('draft','issued') THEN
      RAISE EXCEPTION 'Invoice lifecycle transition is invalid.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'v2_billing_invoice_lines' THEN
    SELECT invoice_state INTO current_state FROM v2_billing_invoices
      WHERE organization_id = COALESCE(NEW.organization_id, OLD.organization_id)
        AND id = COALESCE(NEW.invoice_id, OLD.invoice_id);
    IF current_state = 'void' THEN
      RAISE EXCEPTION 'Void Invoice lines are immutable.';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unsupported Billing lifecycle trigger target.';
END;
$$ LANGUAGE plpgsql;

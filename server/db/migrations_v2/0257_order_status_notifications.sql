ALTER TABLE order_status_pills ADD COLUMN notification_rules jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE orders ADD COLUMN status_notification_event_id varchar;
ALTER TABLE order_status_events ADD COLUMN notification_evaluated boolean NOT NULL DEFAULT false;
ALTER TABLE invoice_email_delivery_jobs
  ADD COLUMN status_order_id varchar,
  ADD COLUMN status_event_id varchar,
  ADD COLUMN status_pill_id varchar,
  ADD COLUMN send_after timestamptz;

ALTER TABLE invoice_email_delivery_jobs DROP CONSTRAINT invoice_email_delivery_jobs_target_check;
ALTER TABLE invoice_email_delivery_jobs ADD CONSTRAINT invoice_email_delivery_jobs_target_check CHECK (
  (delivery_type = 'invoice' AND invoice_id IS NOT NULL AND customer_statement_snapshot_id IS NULL AND status_order_id IS NULL)
  OR (delivery_type = 'customer_statement' AND invoice_id IS NULL AND customer_statement_snapshot_id IS NOT NULL AND status_order_id IS NULL)
  OR (delivery_type = 'order_status' AND invoice_id IS NULL AND customer_statement_snapshot_id IS NULL
    AND status_order_id IS NOT NULL AND status_event_id IS NOT NULL AND status_pill_id IS NOT NULL AND send_after IS NOT NULL)
);

DROP INDEX invoice_email_delivery_jobs_active_guard_uidx;
CREATE UNIQUE INDEX invoice_email_delivery_jobs_active_guard_uidx ON invoice_email_delivery_jobs
  (organization_id, delivery_type, coalesce(invoice_id, ''), coalesce(customer_statement_snapshot_id, ''), recipient_key, invoice_version)
  WHERE status IN ('queued', 'processing', 'retrying', 'needs_review') AND delivery_type <> 'order_status';
CREATE INDEX order_status_delivery_order_idx ON invoice_email_delivery_jobs (organization_id, status_order_id)
  WHERE delivery_type = 'order_status';
CREATE INDEX order_status_delivery_pill_idx ON invoice_email_delivery_jobs (organization_id, status_pill_id)
  WHERE delivery_type = 'order_status';

-- The order row is already locked by the writer. Dispatch takes that same
-- lock before committing its provider boundary, then locks the delivery row.
CREATE FUNCTION invalidate_order_status_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.status_pill_id, OLD.state, OLD.canonical_state, OLD.workflow_status_id, OLD.canceled_at, OLD.customer_id, OLD.contact_id)
      IS NOT DISTINCT FROM
      (NEW.status_pill_id, NEW.state, NEW.canonical_state, NEW.workflow_status_id, NEW.canceled_at, NEW.customer_id, NEW.contact_id)
    THEN RETURN NEW; END IF;
    NEW.status_notification_event_id := NULL;
  END IF;
  UPDATE invoice_email_delivery_jobs
    SET status = 'canceled', failure_reason = 'Order status or recipient changed.',
        claim_expires_at = NULL, updated_at = now()
    WHERE organization_id = OLD.organization_id AND status_order_id = OLD.id AND delivery_type = 'order_status'
      AND (status IN ('queued', 'retrying')
        OR (status = 'processing' AND metadata->>'queueStage' IS DISTINCT FROM 'provider_submitting'));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invalidate_order_status_notification
  BEFORE UPDATE OF status_pill_id, state, canonical_state, workflow_status_id, canceled_at, customer_id, contact_id OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION invalidate_order_status_notification();

CREATE FUNCTION invalidate_status_pill_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE invoice_email_delivery_jobs
    SET status = 'canceled', failure_reason = 'Status notification eligibility or rule changed.',
        claim_expires_at = NULL, updated_at = now()
    WHERE organization_id = OLD.organization_id AND status_pill_id = OLD.id AND delivery_type = 'order_status'
      AND (status IN ('queued', 'retrying')
        OR (status = 'processing' AND metadata->>'queueStage' IS DISTINCT FROM 'provider_submitting'))
      AND (CASE WHEN TG_OP = 'DELETE' THEN true ELSE
          NOT NEW.is_active OR NOT NEW.notification_trigger_eligible OR
          (NOT NEW.customer_visible AND metadata->>'kind' IN ('customer_email', 'customer_portal')) OR
          ((OLD.notification_rules -> (metadata->>'kind')) IS DISTINCT FROM (NEW.notification_rules -> (metadata->>'kind')))
        END);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invalidate_status_pill_notification
  AFTER UPDATE OF is_active, notification_trigger_eligible, customer_visible, notification_rules OR DELETE ON order_status_pills
  FOR EACH ROW EXECUTE FUNCTION invalidate_status_pill_notification();

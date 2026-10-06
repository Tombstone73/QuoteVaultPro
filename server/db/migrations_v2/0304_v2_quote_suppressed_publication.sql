-- Suppression is publication evidence, never a fabricated Gmail receipt.
ALTER TABLE v2_sales_quote_delivery_attempts ADD COLUMN suppression_context jsonb;
ALTER TABLE v2_sales_quote_delivery_attempts DROP CONSTRAINT v2_sales_quote_delivery_attempts_state_chk;
ALTER TABLE v2_sales_quote_delivery_attempts ADD CONSTRAINT v2_sales_quote_delivery_attempts_state_chk
  CHECK (delivery_state IN ('pending','succeeded','failed','uncertain','suppressed'));
ALTER TABLE v2_sales_quote_delivery_attempts DROP CONSTRAINT v2_sales_quote_delivery_attempts_completion_chk;
ALTER TABLE v2_sales_quote_delivery_attempts ADD CONSTRAINT v2_sales_quote_delivery_attempts_completion_chk CHECK ((
  (delivery_state='pending' AND completed_at IS NULL AND provider_message_id IS NULL AND failure_message IS NULL)
  OR (delivery_state='succeeded' AND completed_at IS NOT NULL AND provider_message_id IS NOT NULL AND failure_message IS NULL)
  OR (delivery_state='failed' AND completed_at IS NOT NULL AND provider_message_id IS NULL AND failure_message IS NOT NULL)
  OR (delivery_state='uncertain' AND completed_at IS NOT NULL AND failure_message IS NOT NULL)
  OR (delivery_state='suppressed' AND completed_at IS NOT NULL AND provider_message_id IS NULL
      AND failure_message IS NULL AND quote_checkpoint_id IS NOT NULL AND prepared_evidence_json IS NOT NULL)
) IS TRUE);
ALTER TABLE v2_sales_quote_delivery_attempts ADD CONSTRAINT v2_quote_suppression_context_chk CHECK ((
  (transport='gmail' AND suppression_context IS NULL AND delivery_state<>'suppressed')
  OR (transport='dev_qa_suppressed'
    AND organization_id='b6f969b2-dda3-4133-9d75-c417dabb8f3a'
    AND recipient_email='quote-final-four@example.invalid'
    AND provider_message_id IS NULL AND prepared_evidence_json IS NOT NULL
    AND delivery_state IN ('pending','failed','suppressed')
    AND jsonb_typeof(suppression_context)='object'
    AND suppression_context=jsonb_build_object(
      'schemaVersion',1,'deliveryMode','suppressed','providerCall','not_attempted',
      'environment','dev_qa','scope','m77f_qa_dev_only',
      'organizationId',organization_id,'recipientEmail',recipient_email))
) IS TRUE);

CREATE UNIQUE INDEX v2_quote_delivery_publication_uidx
  ON v2_sales_quote_delivery_attempts(organization_id,quote_document_id,quote_checkpoint_id)
  WHERE delivery_state IN ('succeeded','suppressed');

CREATE FUNCTION v2_quote_delivery_mode_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.transport IS DISTINCT FROM OLD.transport OR NEW.suppression_context IS DISTINCT FROM OLD.suppression_context THEN
    RAISE EXCEPTION 'Quote delivery mode and suppression context are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.delivery_state='suppressed' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Suppressed Quote publication evidence is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER v2_quote_delivery_mode_immutable BEFORE UPDATE ON v2_sales_quote_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION v2_quote_delivery_mode_guard();

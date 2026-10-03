-- Preserve the exact prepared proposal before any provider side effect.
-- Existing attempts deliberately remain NULL; reconstructing old evidence is unsafe.
ALTER TABLE v2_sales_quote_delivery_attempts
  ADD COLUMN prepared_evidence_json jsonb;

ALTER TABLE v2_sales_quote_delivery_attempts
  ADD CONSTRAINT v2_sales_quote_delivery_prepared_evidence_chk CHECK (
    prepared_evidence_json IS NULL OR (
      jsonb_typeof(prepared_evidence_json) = 'object'
      AND prepared_evidence_json->'schemaVersion' = '1'::jsonb
      AND jsonb_typeof(prepared_evidence_json->'organizationId') = 'string'
      AND prepared_evidence_json->>'organizationId' = organization_id
      AND jsonb_typeof(prepared_evidence_json->'quoteId') = 'string'
      AND prepared_evidence_json->>'quoteId' = quote_document_id
      AND jsonb_typeof(prepared_evidence_json->'expectedRevision') = 'string'
      AND length(btrim(prepared_evidence_json->>'expectedRevision')) > 0
      AND jsonb_typeof(prepared_evidence_json->'customerContact') = 'object'
      AND prepared_evidence_json->'customerContact'->>'organizationId' = organization_id
      AND (
        (jsonb_typeof(prepared_evidence_json->'customerContact'->'customerId') = 'string'
          AND length(btrim(prepared_evidence_json->'customerContact'->>'customerId')) > 0)
        OR (jsonb_typeof(prepared_evidence_json->'customerContact'->'contactId') = 'string'
          AND length(btrim(prepared_evidence_json->'customerContact'->>'contactId')) > 0)
      )
      AND jsonb_typeof(prepared_evidence_json->'commercial') = 'object'
      AND jsonb_typeof(prepared_evidence_json->'commercial'->'currency') = 'string'
      AND jsonb_typeof(prepared_evidence_json->'commercial'->'terms') = 'object'
      AND jsonb_typeof(prepared_evidence_json->'commercial'->'lines') = 'array'
      AND jsonb_typeof(prepared_evidence_json->'customerPresentation') = 'object'
      AND jsonb_typeof(prepared_evidence_json->'customerPresentation'->'customerDisplayName') = 'string'
      AND jsonb_typeof(prepared_evidence_json->'organizationPresentation') = 'object'
      AND jsonb_typeof(prepared_evidence_json->'organizationPresentation'->'name') = 'string'
      AND jsonb_typeof(prepared_evidence_json->'recipientEmail') = 'string'
      AND prepared_evidence_json->>'recipientEmail' = recipient_email
      AND jsonb_typeof(prepared_evidence_json->'documentSha256') = 'string'
      AND prepared_evidence_json->>'documentSha256' = document_sha256
      AND jsonb_typeof(prepared_evidence_json->'documentNumber') = 'string'
      AND length(btrim(prepared_evidence_json->>'documentNumber')) > 0
      AND jsonb_typeof(prepared_evidence_json->'documentDate') = 'string'
      AND prepared_evidence_json->>'documentDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    ) IS TRUE
  );

CREATE FUNCTION v2_sales_quote_delivery_prepared_evidence_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.prepared_evidence_json IS NULL THEN
    RAISE EXCEPTION 'New Quote delivery attempts require prepared evidence'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.prepared_evidence_json IS DISTINCT FROM OLD.prepared_evidence_json THEN
    RAISE EXCEPTION 'Prepared Quote delivery evidence is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER v2_sales_quote_delivery_prepared_evidence_immutable
BEFORE INSERT OR UPDATE ON v2_sales_quote_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION v2_sales_quote_delivery_prepared_evidence_guard();

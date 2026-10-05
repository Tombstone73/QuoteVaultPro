-- Provider recovery must retain the original request identity, not infer it
-- from a matching display reference. Historical references stay NULL.
ALTER TABLE v2_quickbooks_payment_references ADD COLUMN recovery_context jsonb;
ALTER TABLE v2_quickbooks_payment_references ADD COLUMN provider_attempt_started_at timestamptz;

CREATE FUNCTION v2_quickbooks_payment_recovery_context_valid(
  context jsonb, tenant varchar, payment varchar, reference varchar
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  allocation jsonb;
  invoice_ids text[] := ARRAY[]::text[];
  invoice_id text;
  amount numeric;
  allocated numeric := 0;
BEGIN
  IF context IS NULL THEN RETURN true; END IF;
  IF (jsonb_typeof(context) = 'object'
    AND context->'schemaVersion' = '1'::jsonb
    AND jsonb_typeof(context->'organizationId') = 'string' AND context->>'organizationId' = tenant
    AND jsonb_typeof(context->'paymentId') = 'string' AND context->>'paymentId' = payment
    AND jsonb_typeof(context->'reference') = 'string' AND context->>'reference' = reference
    AND jsonb_typeof(context->'jobId') = 'string' AND length(btrim(context->>'jobId')) > 0
    AND jsonb_typeof(context->'realmId') = 'string' AND context->>'realmId' ~ '^[0-9]{1,64}$'
    AND jsonb_typeof(context->'customerId') = 'string' AND context->>'customerId' ~ '^[0-9]{1,64}$'
    AND context->>'environment' IN ('sandbox','production')
    AND jsonb_typeof(context->'currency') = 'string' AND context->>'currency' ~ '^[A-Z]{3}$'
    AND jsonb_typeof(context->'amountCents') = 'number'
    AND jsonb_typeof(context->'allocations') = 'array') IS NOT TRUE THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(context) AS keys(key)
    WHERE key NOT IN ('schemaVersion','organizationId','paymentId','reference','jobId','realmId','customerId','environment','currency','amountCents','allocations')) THEN RETURN false; END IF;
  amount := (context->>'amountCents')::numeric;
  IF amount <= 0 OR amount > 9007199254740991 OR amount <> trunc(amount)
    OR jsonb_array_length(context->'allocations') = 0 THEN RETURN false; END IF;
  FOR allocation IN SELECT value FROM jsonb_array_elements(context->'allocations') LOOP
    IF (jsonb_typeof(allocation) = 'object'
      AND jsonb_typeof(allocation->'invoiceId') = 'string' AND allocation->>'invoiceId' ~ '^[0-9]{1,64}$'
      AND jsonb_typeof(allocation->'amountCents') = 'number') IS NOT TRUE THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(allocation) AS keys(key) WHERE key NOT IN ('invoiceId','amountCents')) THEN RETURN false; END IF;
    invoice_id := allocation->>'invoiceId';
    IF invoice_id = ANY(invoice_ids) THEN RETURN false; END IF;
    invoice_ids := array_append(invoice_ids, invoice_id);
    allocated := allocated + (allocation->>'amountCents')::numeric;
    IF (allocation->>'amountCents')::numeric <= 0
      OR (allocation->>'amountCents')::numeric <> trunc((allocation->>'amountCents')::numeric) THEN RETURN false; END IF;
  END LOOP;
  RETURN allocated = amount;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

ALTER TABLE v2_quickbooks_payment_references ADD CONSTRAINT v2_quickbooks_payment_recovery_context_chk
  CHECK (v2_quickbooks_payment_recovery_context_valid(recovery_context,organization_id,payment_id,payment_ref_num) IS TRUE
    AND (provider_attempt_started_at IS NULL OR (recovery_context IS NOT NULL AND isfinite(provider_attempt_started_at))));

CREATE FUNCTION v2_quickbooks_payment_recovery_context_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'QuickBooks Payment reference identity cannot be deleted'
      USING ERRCODE = '23514';
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.provider_attempt_started_at IS NOT NULL OR NEW.recovery_context IS NULL OR NOT EXISTS (
      SELECT 1 FROM v2_quickbooks_sync_jobs job
      WHERE job.id = NEW.recovery_context->>'jobId'
        AND job.organization_id = NEW.organization_id
        AND job.subject_kind = 'payment' AND job.subject_id = NEW.payment_id
    ) THEN
      RAISE EXCEPTION 'New QuickBooks Payment references require their original tenant-scoped recovery request'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.recovery_context IS DISTINCT FROM OLD.recovery_context THEN
    RAISE EXCEPTION 'QuickBooks Payment recovery context is immutable; historical context cannot be fabricated'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.provider_attempt_started_at IS NOT NULL
    AND NEW.provider_attempt_started_at IS DISTINCT FROM OLD.provider_attempt_started_at THEN
    RAISE EXCEPTION 'A recorded provider attempt cannot be reset or changed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER v2_quickbooks_payment_recovery_context_immutable
BEFORE INSERT OR UPDATE OR DELETE ON v2_quickbooks_payment_references
FOR EACH ROW EXECUTE FUNCTION v2_quickbooks_payment_recovery_context_guard();

-- Customer/Invoice publication establishes provider provenance for subsequent
-- Payment recovery. It is transport evidence, not mutable commercial authority.
CREATE FUNCTION v2_quickbooks_provider_request_intent_valid(
  intent jsonb, request varchar, tenant varchar, kind varchar, entity varchar,
  realm varchar, provider_environment varchar
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN (jsonb_typeof(intent) = 'object'
    AND jsonb_typeof(intent->'connection') = 'object'
    AND jsonb_typeof(intent->'payload') = 'object'
    AND jsonb_typeof(intent->'requestId') = 'string' AND intent->>'requestId' = request
    AND jsonb_typeof(intent->'entityKind') = 'string' AND intent->>'entityKind' = kind
    AND jsonb_typeof(intent->'entityId') = 'string' AND intent->>'entityId' = entity
    AND jsonb_typeof(intent->'connection'->'organizationId') = 'string'
      AND intent->'connection'->>'organizationId' = tenant
    AND jsonb_typeof(intent->'connection'->'realmId') = 'string'
      AND intent->'connection'->>'realmId' = realm
    AND jsonb_typeof(intent->'connection'->'environment') = 'string'
      AND intent->'connection'->>'environment' = provider_environment
    AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(intent) AS keys(key)
      WHERE key NOT IN ('connection','payload','requestId','entityKind','entityId'))
    AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(intent->'connection') AS keys(key)
      WHERE key NOT IN ('organizationId','realmId','environment'))) IS TRUE;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE TABLE v2_quickbooks_provider_requests (
  request_id varchar(50) PRIMARY KEY,
  organization_id varchar NOT NULL REFERENCES organizations(id),
  entity_kind varchar(24) NOT NULL,
  entity_id varchar NOT NULL,
  realm_id varchar(64) NOT NULL,
  environment varchar(10) NOT NULL,
  intent_json jsonb NOT NULL,
  provider_attempt_started_at timestamptz,
  confirmed_provider_id varchar(64),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_quickbooks_provider_requests_shape_chk CHECK (
    length(btrim(request_id)) > 0 AND length(btrim(entity_id)) > 0
    AND entity_kind IN ('customer','invoice') AND realm_id ~ '^[0-9]{1,64}$'
    AND environment IN ('sandbox','production') AND isfinite(created_at)
    AND (provider_attempt_started_at IS NULL OR isfinite(provider_attempt_started_at))
    AND ((confirmed_provider_id IS NULL AND confirmed_at IS NULL)
      OR (confirmed_provider_id IS NOT NULL AND confirmed_provider_id ~ '^[0-9]{1,64}$'
        AND confirmed_at IS NOT NULL AND isfinite(confirmed_at)
        AND provider_attempt_started_at IS NOT NULL AND confirmed_at >= provider_attempt_started_at))
    AND v2_quickbooks_provider_request_intent_valid(intent_json,request_id,organization_id,
      entity_kind,entity_id,realm_id,environment)
  )
);

CREATE INDEX v2_quickbooks_provider_requests_entity_idx
  ON v2_quickbooks_provider_requests (organization_id,entity_kind,entity_id,realm_id,environment,created_at);

CREATE FUNCTION v2_quickbooks_provider_request_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'QuickBooks provider request evidence cannot be deleted' USING ERRCODE = '23514';
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.provider_attempt_started_at IS NOT NULL OR NEW.confirmed_provider_id IS NOT NULL OR NEW.confirmed_at IS NOT NULL THEN
      RAISE EXCEPTION 'New QuickBooks provider requests must start without attempt or confirmation evidence' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF ROW(NEW.request_id,NEW.organization_id,NEW.entity_kind,NEW.entity_id,NEW.realm_id,NEW.environment,NEW.intent_json,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.request_id,OLD.organization_id,OLD.entity_kind,OLD.entity_id,OLD.realm_id,OLD.environment,OLD.intent_json,OLD.created_at) THEN
      RAISE EXCEPTION 'QuickBooks provider request scope and intent are immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.provider_attempt_started_at IS NOT NULL AND NEW.provider_attempt_started_at IS DISTINCT FROM OLD.provider_attempt_started_at THEN
      RAISE EXCEPTION 'QuickBooks provider attempt evidence cannot be reset or changed' USING ERRCODE = '23514';
    END IF;
    IF OLD.confirmed_provider_id IS NOT NULL AND ROW(NEW.confirmed_provider_id,NEW.confirmed_at)
      IS DISTINCT FROM ROW(OLD.confirmed_provider_id,OLD.confirmed_at) THEN
      RAISE EXCEPTION 'QuickBooks provider confirmation cannot be reset or changed' USING ERRCODE = '23514';
    END IF;
    IF NEW.confirmed_provider_id IS NOT NULL AND OLD.provider_attempt_started_at IS NULL THEN
      RAISE EXCEPTION 'QuickBooks provider confirmation requires a previously recorded attempt' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER v2_quickbooks_provider_requests_immutable
BEFORE INSERT OR UPDATE OR DELETE ON v2_quickbooks_provider_requests
FOR EACH ROW EXECUTE FUNCTION v2_quickbooks_provider_request_guard();

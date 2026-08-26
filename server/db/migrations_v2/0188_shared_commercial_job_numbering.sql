-- V2 shared commercial Job Numbering. Historical document identities are
-- intentionally not rewritten: only newly-created records receive job_number.

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS job_number integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS job_number integer;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS job_number integer;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_sequence integer;

CREATE UNIQUE INDEX IF NOT EXISTS quotes_org_job_number_unique
  ON quotes (organization_id, job_number) WHERE job_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS orders_org_job_number_unique
  ON orders (organization_id, job_number) WHERE job_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoices_job_number_idx
  ON invoices (organization_id, job_number);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_job_sequence_unique
  ON invoices (organization_id, job_number, invoice_sequence)
  WHERE job_number IS NOT NULL AND invoice_sequence IS NOT NULL;

-- `number_core` becomes the base Job Number for additional invoices, so its
-- previous per-invoice uniqueness would incorrectly reject 20342-2.
DROP INDEX IF EXISTS invoices_org_number_core_unique;

-- Seed the tenant-scoped, atomic next_job_number counter from the highest
-- conservative numeric base across all historical document types. Existing
-- document-specific counters are also honored so previously consumed gaps are
-- never recycled. Prefix parsing accepts only known legacy forms; malformed
-- values are excluded and explicitly reported in the migration log.
DO $$
DECLARE
  org_row record;
  quote_max integer;
  order_max integer;
  invoice_max integer;
  existing_counter integer;
  next_job numeric;
  quote_malformed integer;
  order_malformed integer;
  invoice_malformed integer;
BEGIN
  FOR org_row IN SELECT id FROM organizations LOOP
    -- A counter beyond the storage range cannot be safely reconciled by
    -- selecting a lower value. Stop instead of risking a reused Job Number.
    IF EXISTS (
      SELECT 1
      FROM global_variables
      WHERE organization_id = org_row.id
        AND name IN ('next_quote_number', 'next_order_number', 'next_invoice_number', 'next_job_number')
        AND value ~ '^[0-9]+$'
        AND (
          length(ltrim(value, '0')) > 10
          OR (length(ltrim(value, '0')) = 10 AND ltrim(value, '0') > '2147483647')
        )
    ) THEN
      RAISE EXCEPTION 'shared Job Number counter exceeds PostgreSQL integer range for organization %', org_row.id;
    END IF;

    SELECT max(value) INTO quote_max FROM (
      SELECT number_core AS value FROM quotes WHERE organization_id = org_row.id AND number_core > 0
      UNION ALL SELECT quote_number FROM quotes WHERE organization_id = org_row.id AND quote_number > 0
      UNION ALL SELECT CASE WHEN substring(display_number FROM '^(?i:QT[-_ ]?)([0-9]{1,10})$')::numeric BETWEEN 1 AND 2147483647 THEN substring(display_number FROM '^(?i:QT[-_ ]?)([0-9]{1,10})$')::integer END FROM quotes WHERE organization_id = org_row.id AND display_number ~ '^(?i:QT[-_ ]?)[0-9]{1,10}$'
      UNION ALL SELECT CASE WHEN display_number::numeric BETWEEN 1 AND 2147483647 THEN display_number::integer END FROM quotes WHERE organization_id = org_row.id AND display_number ~ '^[0-9]{1,10}$'
    ) values_found;

    SELECT max(value) INTO order_max FROM (
      SELECT number_core AS value FROM orders WHERE organization_id = org_row.id AND number_core > 0
      UNION ALL SELECT CASE WHEN order_number::numeric BETWEEN 1 AND 2147483647 THEN order_number::integer END FROM orders WHERE organization_id = org_row.id AND order_number ~ '^[0-9]{1,10}$'
      UNION ALL SELECT CASE WHEN substring(display_number FROM '^(?i:(?:ORD|ORDER)[-_ ]?)([0-9]{1,10})$')::numeric BETWEEN 1 AND 2147483647 THEN substring(display_number FROM '^(?i:(?:ORD|ORDER)[-_ ]?)([0-9]{1,10})$')::integer END FROM orders WHERE organization_id = org_row.id AND display_number ~ '^(?i:(?:ORD|ORDER)[-_ ]?)[0-9]{1,10}$'
      UNION ALL SELECT CASE WHEN display_number::numeric BETWEEN 1 AND 2147483647 THEN display_number::integer END FROM orders WHERE organization_id = org_row.id AND display_number ~ '^[0-9]{1,10}$'
    ) values_found;

    SELECT max(value) INTO invoice_max FROM (
      SELECT number_core AS value FROM invoices WHERE organization_id = org_row.id AND number_core > 0
      UNION ALL SELECT invoice_number FROM invoices WHERE organization_id = org_row.id AND invoice_number > 0
      UNION ALL SELECT CASE WHEN substring(display_number FROM '^(?i:INV[-_ ]?)([0-9]{1,10})(?:-[0-9]+)?$')::numeric BETWEEN 1 AND 2147483647 THEN substring(display_number FROM '^(?i:INV[-_ ]?)([0-9]{1,10})(?:-[0-9]+)?$')::integer END FROM invoices WHERE organization_id = org_row.id AND display_number ~ '^(?i:INV[-_ ]?)[0-9]{1,10}(?:-[0-9]+)?$'
      UNION ALL SELECT CASE WHEN substring(display_number FROM '^([0-9]{1,10})(?:-[0-9]+)?$')::numeric BETWEEN 1 AND 2147483647 THEN substring(display_number FROM '^([0-9]{1,10})(?:-[0-9]+)?$')::integer END FROM invoices WHERE organization_id = org_row.id AND display_number ~ '^[0-9]{1,10}(?:-[0-9]+)?$'
    ) values_found;

    SELECT max(CASE WHEN value::numeric BETWEEN 1 AND 2147483647 THEN value::integer END) INTO existing_counter
    FROM global_variables
    WHERE organization_id = org_row.id
      AND name IN ('next_quote_number', 'next_order_number', 'next_invoice_number', 'next_job_number')
      AND value ~ '^[0-9]{1,10}$';

    next_job := greatest(
      1000,
      coalesce(quote_max, 0)::numeric + 1,
      coalesce(order_max, 0)::numeric + 1,
      coalesce(invoice_max, 0)::numeric + 1,
      coalesce(existing_counter, 0)
    );

    IF next_job > 2147483647 THEN
      RAISE EXCEPTION 'shared Job Number sequence is exhausted for organization %', org_row.id;
    END IF;

    INSERT INTO global_variables (id, organization_id, name, value, description, category, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), org_row.id, 'next_job_number', next_job::text, 'Next shared commercial job number sequence (initialized from legacy documents)', 'numbering', true, NOW(), NOW())
    ON CONFLICT (organization_id, name) DO UPDATE SET
      value = CASE
        WHEN global_variables.value ~ '^[0-9]{1,10}$'
          AND global_variables.value::numeric BETWEEN 1 AND 2147483647
          AND global_variables.value::integer > EXCLUDED.value::integer THEN global_variables.value
        ELSE EXCLUDED.value
      END,
      description = EXCLUDED.description,
      updated_at = NOW();

    SELECT count(*) INTO quote_malformed FROM quotes
    WHERE organization_id = org_row.id AND quote_number IS NULL AND number_core IS NULL
      AND coalesce(btrim(display_number), '') <> ''
      AND display_number !~ '^(?i:QT[-_ ]?)[0-9]+$' AND display_number !~ '^[0-9]+$';
    SELECT count(*) INTO order_malformed FROM orders
    WHERE organization_id = org_row.id AND number_core IS NULL AND order_number !~ '^[0-9]+$'
      AND coalesce(btrim(display_number), '') <> ''
      AND display_number !~ '^(?i:(?:ORD|ORDER)[-_ ]?)[0-9]+$' AND display_number !~ '^[0-9]+$';
    SELECT count(*) INTO invoice_malformed FROM invoices
    WHERE organization_id = org_row.id AND invoice_number IS NULL AND number_core IS NULL
      AND coalesce(btrim(display_number), '') <> ''
      AND display_number !~ '^(?i:INV[-_ ]?)[0-9]+(?:-[0-9]+)?$' AND display_number !~ '^[0-9]+(?:-[0-9]+)?$';

    RAISE NOTICE 'shared Job Number init org=% quote_max=% order_max=% invoice_max=% next_job=%', org_row.id, quote_max, order_max, invoice_max, next_job;
    IF quote_malformed + order_malformed + invoice_malformed > 0 THEN
      RAISE WARNING 'shared Job Number init org=% ignored malformed display values: quotes=% orders=% invoices=%', org_row.id, quote_malformed, order_malformed, invoice_malformed;
    END IF;
  END LOOP;
END $$;

-- M6: Quote / Order-Job numbering writer convergence.
--
-- V2 Settings is the future-only authority for Quote and Order/Job series.
-- Legacy compatibility writers remain temporarily reachable, but they must
-- consume the same V2 counter rather than maintain a competing sequence.
-- Existing documents keep their assigned identifiers; the counter moves only
-- forward to the highest known V2, legacy, or previously configured value.

WITH kinds(document_kind, default_prefix, legacy_next_name, legacy_prefix_name) AS (
  VALUES
    ('quote'::varchar, 'QT-'::varchar, 'next_quote_number'::varchar, 'quote_number_prefix'::varchar),
    ('order'::varchar, 'ORD-'::varchar, 'next_order_number'::varchar, 'order_number_prefix'::varchar)
), desired AS (
  SELECT
    organization.id AS organization_id,
    kinds.document_kind,
    GREATEST(
      1000::bigint,
      COALESCE(existing.next_number, 1000::bigint),
      COALESCE((
        SELECT MAX(document.business_number) + 1
        FROM v2_sales_documents document
        WHERE document.organization_id = organization.id
          AND document.document_kind = kinds.document_kind
      ), 1000::bigint),
      CASE kinds.document_kind
        WHEN 'quote' THEN COALESCE((
          SELECT MAX(COALESCE(legacy_quote.number_core, legacy_quote.quote_number)) + 1
          FROM quotes legacy_quote
          WHERE legacy_quote.organization_id = organization.id
        ), 1000::bigint)
        WHEN 'order' THEN COALESCE((
          SELECT MAX(COALESCE(legacy_order.number_core, CASE WHEN legacy_order.order_number ~ '^[0-9]+$' THEN legacy_order.order_number::bigint END)) + 1
          FROM orders legacy_order
          WHERE legacy_order.organization_id = organization.id
        ), 1000::bigint)
      END,
      COALESCE((
        SELECT variable.value::bigint
        FROM global_variables variable
        WHERE variable.organization_id = organization.id
          AND variable.name = kinds.legacy_next_name
          AND variable.value ~ '^[0-9]+$'
      ), 1000::bigint)
    ) AS next_number,
    COALESCE(
      existing.display_prefix,
      (
        SELECT variable.value
        FROM global_variables variable
        WHERE variable.organization_id = organization.id
          AND variable.name = kinds.legacy_prefix_name
          AND variable.value ~ '^[A-Za-z0-9_-]{0,16}$'
      ),
      kinds.default_prefix
    ) AS display_prefix
  FROM organizations organization
  CROSS JOIN kinds
  LEFT JOIN v2_sales_document_number_counters existing
    ON existing.organization_id = organization.id
   AND existing.document_kind = kinds.document_kind
)
INSERT INTO v2_sales_document_number_counters(organization_id, document_kind, next_number, display_prefix, revision)
SELECT organization_id, document_kind, next_number, display_prefix, 1
FROM desired
ON CONFLICT (organization_id, document_kind) DO UPDATE
SET
  next_number = GREATEST(v2_sales_document_number_counters.next_number, EXCLUDED.next_number),
  revision = CASE
    WHEN v2_sales_document_number_counters.next_number < EXCLUDED.next_number
      THEN v2_sales_document_number_counters.revision + 1
    ELSE v2_sales_document_number_counters.revision
  END,
  updated_at = CASE
    WHEN v2_sales_document_number_counters.next_number < EXCLUDED.next_number
      THEN now()
    ELSE v2_sales_document_number_counters.updated_at
  END;

-- This is the one runtime allocation primitive for Quote and Order/Job.
-- It is deliberately called inside the caller-owned transaction, so later
-- transaction failure rolls the allocation back with the document write.
CREATE OR REPLACE FUNCTION v2_allocate_sales_document_number(
  p_organization_id varchar,
  p_document_kind varchar
)
RETURNS TABLE(allocated_core bigint, display_prefix varchar)
LANGUAGE plpgsql
AS $$
DECLARE
  initial_prefix varchar(16);
BEGIN
  IF p_document_kind NOT IN ('quote', 'order') THEN
    RAISE EXCEPTION 'unsupported V2 sales document numbering kind'
      USING ERRCODE = '22023';
  END IF;

  initial_prefix := CASE p_document_kind
    WHEN 'quote' THEN 'QT-'
    WHEN 'order' THEN 'ORD-'
  END;

  RETURN QUERY
  INSERT INTO v2_sales_document_number_counters(
    organization_id,
    document_kind,
    next_number,
    display_prefix,
    revision
  )
  VALUES (p_organization_id, p_document_kind, 1001, initial_prefix, 1)
  ON CONFLICT (organization_id, document_kind) DO UPDATE
  SET
    next_number = v2_sales_document_number_counters.next_number + 1,
    revision = v2_sales_document_number_counters.revision + 1,
    updated_at = now()
  RETURNING
    v2_sales_document_number_counters.next_number - 1,
    v2_sales_document_number_counters.display_prefix;
END;
$$;

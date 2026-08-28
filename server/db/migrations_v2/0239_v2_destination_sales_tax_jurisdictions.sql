-- Destination jurisdictions extend the existing tenant Sales Tax model. No
-- financial rate is inferred or changed: existing Home / Business rows retain
-- their Pickup meaning and destination rules explicitly state applicability.

ALTER TABLE v2_sales_tax_jurisdictions
  ADD COLUMN destination_methods varchar[] NOT NULL
    DEFAULT ARRAY['shipping','local_delivery']::varchar[];

-- The original scope constraint prevented a Home / Business Pickup rule and a
-- destination rule from sharing the same geography.  The replacement keeps
-- the scopes distinct. Partial unique indexes make NULL postal scope unique
-- too (ordinary PostgreSQL UNIQUE treats NULL values as distinct).
ALTER TABLE v2_sales_tax_jurisdictions
  DROP CONSTRAINT IF EXISTS v2_sales_tax_jurisdictions_scope_uidx;

CREATE UNIQUE INDEX v2_sales_tax_jurisdictions_scope_with_postal_kind_uidx
  ON v2_sales_tax_jurisdictions(organization_id,country_code,region_code,postal_code,home_business)
  WHERE postal_code IS NOT NULL;

CREATE UNIQUE INDEX v2_sales_tax_jurisdictions_scope_without_postal_kind_uidx
  ON v2_sales_tax_jurisdictions(organization_id,country_code,region_code,home_business)
  WHERE postal_code IS NULL;

ALTER TABLE v2_sales_tax_jurisdictions
  ADD CONSTRAINT v2_sales_tax_jurisdictions_destination_methods_chk
  CHECK (
    home_business
    OR (
      cardinality(destination_methods) > 0
      AND destination_methods <@ ARRAY['shipping','local_delivery']::varchar[]
    )
  );

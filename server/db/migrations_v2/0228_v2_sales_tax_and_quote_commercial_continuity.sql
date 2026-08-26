-- M6 canonical Sales commercial tax composition.  This is intentionally
-- additive: legacy V1 tax records and V2 zero-tax compatibility invoices stay
-- readable while new Sales documents freeze their own commercial evidence.

CREATE TABLE v2_sales_tax_jurisdictions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  country_code varchar(8) NOT NULL,
  region_code varchar(32) NOT NULL,
  postal_code varchar(32),
  rate_basis_points integer NOT NULL,
  active boolean NOT NULL DEFAULT TRUE,
  home_business boolean NOT NULL DEFAULT FALSE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_sales_tax_jurisdictions_name_chk CHECK (length(btrim(name)) > 0),
  CONSTRAINT v2_sales_tax_jurisdictions_rate_chk CHECK (rate_basis_points BETWEEN 0 AND 10000),
  CONSTRAINT v2_sales_tax_jurisdictions_country_chk CHECK (length(btrim(country_code)) > 0),
  CONSTRAINT v2_sales_tax_jurisdictions_region_chk CHECK (length(btrim(region_code)) > 0),
  CONSTRAINT v2_sales_tax_jurisdictions_scope_uidx UNIQUE (organization_id,country_code,region_code,postal_code)
);
CREATE UNIQUE INDEX v2_sales_tax_jurisdictions_one_home_per_org_uidx
  ON v2_sales_tax_jurisdictions(organization_id) WHERE home_business;

ALTER TABLE v2_sales_document_lines
  ADD COLUMN taxability_snapshot jsonb NOT NULL DEFAULT '{"taxable":true,"source":"legacy_compatibility"}'::jsonb,
  ADD CONSTRAINT v2_sales_document_lines_taxability_snapshot_object_chk CHECK (jsonb_typeof(taxability_snapshot)='object'),
  ADD CONSTRAINT v2_sales_document_lines_taxability_snapshot_taxable_chk CHECK (jsonb_typeof(taxability_snapshot->'taxable')='boolean');

ALTER TABLE v2_sales_quote_details
  ADD COLUMN requested_fulfillment_method varchar(24),
  ADD COLUMN requested_destination jsonb,
  ADD COLUMN fulfillment_instructions text,
  ADD COLUMN selling_adjustment_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN selling_adjustment_reason text,
  ADD COLUMN commercial_charge jsonb,
  ADD COLUMN tax_composition jsonb,
  ADD CONSTRAINT v2_sales_quote_details_requested_fulfillment_method_chk CHECK (requested_fulfillment_method IS NULL OR requested_fulfillment_method IN ('pickup','shipping','local_delivery')),
  ADD CONSTRAINT v2_sales_quote_details_requested_destination_object_chk CHECK (requested_destination IS NULL OR jsonb_typeof(requested_destination)='object'),
  ADD CONSTRAINT v2_sales_quote_details_requested_destination_required_chk CHECK ((requested_fulfillment_method IN ('shipping','local_delivery') AND requested_destination IS NOT NULL) OR (requested_fulfillment_method IS NULL OR requested_fulfillment_method='pickup')),
  ADD CONSTRAINT v2_sales_quote_details_adjustment_reason_chk CHECK ((selling_adjustment_cents=0 AND selling_adjustment_reason IS NULL) OR (selling_adjustment_cents<>0 AND length(btrim(selling_adjustment_reason))>0)),
  ADD CONSTRAINT v2_sales_quote_details_commercial_charge_object_chk CHECK (commercial_charge IS NULL OR jsonb_typeof(commercial_charge)='object'),
  ADD CONSTRAINT v2_sales_quote_details_tax_composition_object_chk CHECK (tax_composition IS NULL OR jsonb_typeof(tax_composition)='object');

ALTER TABLE v2_sales_order_details
  ADD COLUMN commercial_charge jsonb,
  ADD COLUMN tax_composition jsonb,
  ADD CONSTRAINT v2_sales_order_details_commercial_charge_object_chk CHECK (commercial_charge IS NULL OR jsonb_typeof(commercial_charge)='object'),
  ADD CONSTRAINT v2_sales_order_details_tax_composition_object_chk CHECK (tax_composition IS NULL OR jsonb_typeof(tax_composition)='object');

ALTER TABLE v2_billing_invoices
  ADD COLUMN sales_commercial_charge jsonb,
  ADD COLUMN sales_tax_composition jsonb,
  ADD CONSTRAINT v2_billing_invoices_sales_commercial_charge_object_chk CHECK (sales_commercial_charge IS NULL OR jsonb_typeof(sales_commercial_charge)='object'),
  ADD CONSTRAINT v2_billing_invoices_sales_tax_composition_object_chk CHECK (sales_tax_composition IS NULL OR jsonb_typeof(sales_tax_composition)='object');

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS company_display_name varchar(255),
  ADD COLUMN IF NOT EXISTS legal_company_name varchar(255),
  ADD COLUMN IF NOT EXISTS physical_address jsonb,
  ADD COLUMN IF NOT EXISTS remittance_address jsonb,
  ADD COLUMN IF NOT EXISTS tax_id varchar(100),
  ADD COLUMN IF NOT EXISTS invoice_logo_url text,
  ADD COLUMN IF NOT EXISTS invoice_logo_asset_id varchar,
  ADD COLUMN IF NOT EXISTS invoice_payment_instructions text,
  ADD COLUMN IF NOT EXISTS invoice_footer_note text,
  ADD COLUMN IF NOT EXISTS checks_payable_to varchar(255);


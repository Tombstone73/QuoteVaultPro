ALTER TABLE public.company_settings
  ADD COLUMN ups_shipping_handling_fee_cents integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT company_settings_ups_shipping_handling_fee_nonnegative
  CHECK (ups_shipping_handling_fee_cents >= 0);

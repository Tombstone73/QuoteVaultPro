-- Preserve the exact UPS quote option behind a customer shipping-charge decision.
-- Existing charges retain their prior quote and service provenance without guessing an option.
ALTER TABLE public.orders ADD COLUMN shipping_charge_rate_option_id varchar(32);

-- Retiring a documented UPS test placeholder is an internal evidence action.
-- It does not assert that UPS accepted a void or issued a carrier credit.
ALTER TABLE public.ups_label_purchases
  DROP CONSTRAINT ups_label_purchases_status_check;
ALTER TABLE public.ups_label_purchases
  ADD CONSTRAINT ups_label_purchases_status_check
  CHECK (status IN ('REQUESTING','UNCERTAIN','PURCHASED','VOID_REQUESTING','VOID_UNCERTAIN',
    'VOID_ACCEPTED','EXTERNAL_CANCEL_REPORTED','SAMPLE_RETIRED','REJECTED'));

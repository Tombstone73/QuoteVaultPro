-- Historical UPS attempts have no persisted endpoint evidence. Do not infer
-- their environment from tracking values or the current deployment setting.
ALTER TABLE public.ups_shipment_rate_quotes ADD COLUMN environment varchar(8) NOT NULL DEFAULT 'unknown'
  CHECK (environment IN ('unknown', 'test', 'live'));
ALTER TABLE public.ups_label_purchases ADD COLUMN environment varchar(8) NOT NULL DEFAULT 'unknown'
  CHECK (environment IN ('unknown', 'test', 'live'));

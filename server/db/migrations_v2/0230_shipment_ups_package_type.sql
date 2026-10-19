ALTER TABLE public.shipment_packages
  ADD COLUMN IF NOT EXISTS ups_packaging_type varchar(2) NOT NULL DEFAULT '02';

ALTER TABLE public.shipment_packages
  ADD CONSTRAINT shipment_packages_ups_packaging_type_check
  CHECK (ups_packaging_type IN ('02', '21'));

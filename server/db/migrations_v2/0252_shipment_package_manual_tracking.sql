ALTER TABLE public.shipment_packages
  ADD COLUMN manual_tracking_carrier varchar(20),
  ADD COLUMN manual_tracking_number varchar(80),
  ADD CONSTRAINT shipment_packages_manual_tracking_check CHECK (
    (manual_tracking_carrier IS NULL AND manual_tracking_number IS NULL)
    OR (manual_tracking_carrier IS NOT NULL AND manual_tracking_number IS NOT NULL
      AND manual_tracking_carrier IN ('UPS', 'FedEx', 'USPS', 'DHL')
      AND manual_tracking_number ~ '^[A-Z0-9]{5,80}$'
      AND manual_tracking_number <> '1ZXXXXXXXXXXXXXXXX')
  );
--> statement-breakpoint
CREATE UNIQUE INDEX shipment_packages_manual_tracking_uidx
  ON public.shipment_packages (organization_id, manual_tracking_carrier, manual_tracking_number)
  WHERE manual_tracking_number IS NOT NULL;

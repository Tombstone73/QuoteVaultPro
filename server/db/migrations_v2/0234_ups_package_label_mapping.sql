-- UPS returns one PackageResults per box but does not echo the requested box
-- reference. Keep every purchased label while an operator verifies its box.
ALTER TABLE public.ups_package_labels ALTER COLUMN package_id DROP NOT NULL;
ALTER TABLE public.ups_package_labels ADD COLUMN provider_result_ordinal integer
  CHECK (provider_result_ordinal > 0);
CREATE UNIQUE INDEX ups_package_labels_purchase_result_uidx
  ON public.ups_package_labels(purchase_id, provider_result_ordinal);

ALTER TABLE public.ups_label_purchases DROP CONSTRAINT ups_label_purchases_status_check;
ALTER TABLE public.ups_label_purchases ADD CONSTRAINT ups_label_purchases_status_check
  CHECK (status IN ('REQUESTING','UNCERTAIN','PURCHASED','MAPPING_REQUIRED','VOID_REQUESTING',
    'VOID_UNCERTAIN','VOID_ACCEPTED','EXTERNAL_CANCEL_REPORTED','SAMPLE_RETIRED','REJECTED'));
DROP INDEX public.ups_label_purchases_active_shipment_uidx;
CREATE UNIQUE INDEX ups_label_purchases_active_shipment_uidx
  ON public.ups_label_purchases(organization_id, shipment_id)
  WHERE status IN ('REQUESTING','UNCERTAIN','PURCHASED','MAPPING_REQUIRED','VOID_REQUESTING','VOID_UNCERTAIN');

ALTER TABLE public.printer_profiles
  ADD COLUMN production_label_width_mm numeric(5,2),
  ADD COLUMN production_label_height_mm numeric(5,2),
  ADD CONSTRAINT printer_profiles_production_label_media_check CHECK (
    NOT (supported_documents ? 'production_item_label')
    OR (production_label_width_mm IS NOT NULL AND production_label_width_mm BETWEEN 40 AND 120
      AND production_label_height_mm IS NOT NULL AND production_label_height_mm BETWEEN 20 AND 160)
  );

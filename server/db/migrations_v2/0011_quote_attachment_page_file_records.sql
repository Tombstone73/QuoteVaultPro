ALTER TABLE public.quote_attachment_pages
  ADD COLUMN IF NOT EXISTS thumb_file_record_id varchar;

ALTER TABLE public.quote_attachment_pages
  ADD COLUMN IF NOT EXISTS preview_file_record_id varchar;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'quote_attachment_pages'
      AND constraint_name = 'quote_attachment_pages_thumb_file_record_id_file_records_id_fk'
  ) THEN
    ALTER TABLE public.quote_attachment_pages
      ADD CONSTRAINT quote_attachment_pages_thumb_file_record_id_file_records_id_fk
      FOREIGN KEY (thumb_file_record_id)
      REFERENCES public.file_records(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'quote_attachment_pages'
      AND constraint_name = 'quote_attachment_pages_preview_file_record_id_file_records_id_fk'
  ) THEN
    ALTER TABLE public.quote_attachment_pages
      ADD CONSTRAINT quote_attachment_pages_preview_file_record_id_file_records_id_fk
      FOREIGN KEY (preview_file_record_id)
      REFERENCES public.file_records(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS quote_attachment_pages_thumb_file_idx
  ON public.quote_attachment_pages (thumb_file_record_id);

CREATE INDEX IF NOT EXISTS quote_attachment_pages_preview_file_idx
  ON public.quote_attachment_pages (preview_file_record_id);
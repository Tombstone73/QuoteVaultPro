BEGIN;

DELETE FROM public.quote_line_items;

ALTER TABLE public.quote_line_items
  ADD COLUMN IF NOT EXISTS pbv2_tree_version_id UUID NOT NULL,
  ADD COLUMN IF NOT EXISTS pbv2_snapshot_json JSONB NOT NULL,
  ADD COLUMN IF NOT EXISTS priced_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS quote_line_items_pbv2_tree_version_id_idx
  ON public.quote_line_items(pbv2_tree_version_id);

CREATE INDEX IF NOT EXISTS quote_line_items_priced_at_idx
  ON public.quote_line_items(priced_at);

DO $$
BEGIN
  ALTER TABLE public.quote_line_items
    ADD CONSTRAINT quote_line_items_pbv2_tree_version_id_fkey
    FOREIGN KEY (pbv2_tree_version_id)
    REFERENCES public.pbv2_tree_versions(id)
    ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMIT;


-- Additive semantic deadlines. Historical dates are intentionally not backfilled.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deadline_json jsonb;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS deadline_json jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_deadline_json_shape') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_deadline_json_shape CHECK (
      deadline_json IS NULL OR (
        jsonb_typeof(deadline_json) = 'object'
        AND (deadline_json->'accepted' IS NULL OR jsonb_typeof(deadline_json->'accepted') IN ('object','null'))
        AND (deadline_json->'requested' IS NULL OR jsonb_typeof(deadline_json->'requested') IN ('object','null'))
        AND (deadline_json->'accepted'->>'kind' IS DISTINCT FROM 'eod' OR
          (deadline_json->'accepted'->>'instant' IS NULL AND deadline_json->'accepted'->>'localTime' IS NULL))
        AND (deadline_json->'requested'->>'kind' IS DISTINCT FROM 'eod' OR
          (deadline_json->'requested'->>'instant' IS NULL AND deadline_json->'requested'->>'localTime' IS NULL))
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_deadline_json_shape') THEN
    ALTER TABLE quotes ADD CONSTRAINT quotes_deadline_json_shape CHECK (
      deadline_json IS NULL OR (jsonb_typeof(deadline_json) = 'object'
        AND (deadline_json->'accepted' IS NULL OR jsonb_typeof(deadline_json->'accepted') = 'null')
        AND (deadline_json->'requested'->>'kind' IS DISTINCT FROM 'eod' OR
          (deadline_json->'requested'->>'instant' IS NULL AND deadline_json->'requested'->>'localTime' IS NULL)))
    );
  END IF;
END $$;

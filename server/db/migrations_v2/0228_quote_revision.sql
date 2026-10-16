-- Quote revision authority. Existing rows whose column was absent receive the
-- migration time, which is an initialization marker, not a historical edit time.
DROP TRIGGER IF EXISTS quotes_advance_revision ON public.quotes;
DO $$
DECLARE
  updated_type text;
  revision_type text;
BEGIN
  IF to_regclass('public.quotes') IS NULL THEN
    RAISE EXCEPTION '0228_quote_revision requires public.quotes';
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO updated_type
  FROM pg_attribute a WHERE a.attrelid = 'public.quotes'::regclass
    AND a.attname = 'updated_at' AND NOT a.attisdropped;
  IF updated_type IS NULL THEN
    ALTER TABLE public.quotes ADD COLUMN updated_at timestamp without time zone DEFAULT (clock_timestamp() AT TIME ZONE 'UTC');
  ELSIF updated_type <> 'timestamp without time zone' THEN
    RAISE EXCEPTION '0228_quote_revision: quotes.updated_at has incompatible type %', updated_type;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO revision_type
  FROM pg_attribute a WHERE a.attrelid = 'public.quotes'::regclass
    AND a.attname = 'revision' AND NOT a.attisdropped;
  IF revision_type IS NULL THEN
    ALTER TABLE public.quotes ADD COLUMN revision integer DEFAULT 1;
  ELSIF revision_type <> 'integer' THEN
    RAISE EXCEPTION '0228_quote_revision: quotes.revision has incompatible type %', revision_type;
  END IF;

  -- NULL legacy values are initialized now; neither created_at nor workflow
  -- timestamps can establish when the Quote was last edited.
  UPDATE public.quotes SET updated_at = clock_timestamp() AT TIME ZONE 'UTC' WHERE updated_at IS NULL;
  UPDATE public.quotes SET revision = 1 WHERE revision IS NULL;
  ALTER TABLE public.quotes ALTER COLUMN updated_at SET DEFAULT (clock_timestamp() AT TIME ZONE 'UTC');
  ALTER TABLE public.quotes ALTER COLUMN updated_at SET NOT NULL;
  ALTER TABLE public.quotes ALTER COLUMN revision SET DEFAULT 1;
  ALTER TABLE public.quotes ALTER COLUMN revision SET NOT NULL;
END $$;

CREATE OR REPLACE FUNCTION public.advance_quote_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- The row lock serializes writers. A counter is the concurrency token;
  -- timestamps alone can lose multiple writes inside one JS millisecond.
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := greatest(clock_timestamp() AT TIME ZONE 'UTC', OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END $$;

CREATE TRIGGER quotes_advance_revision BEFORE UPDATE ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.advance_quote_revision();

CREATE OR REPLACE FUNCTION public.advance_quote_revision_from_child() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  affected_quote_id varchar;
  old_quote_id varchar;
  new_quote_id varchar;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_quote_id := OLD.quote_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_quote_id := NEW.quote_id; END IF;
  FOR affected_quote_id IN
    SELECT DISTINCT id FROM (
      SELECT old_quote_id AS id
      UNION ALL
      SELECT new_quote_id AS id
    ) changed WHERE id IS NOT NULL ORDER BY id
  LOOP
    UPDATE public.quotes SET updated_at = updated_at WHERE id = affected_quote_id;
  END LOOP;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS quote_line_items_advance_quote_revision ON public.quote_line_items;
CREATE TRIGGER quote_line_items_advance_quote_revision
AFTER INSERT OR UPDATE OR DELETE ON public.quote_line_items
FOR EACH ROW EXECUTE FUNCTION public.advance_quote_revision_from_child();

DROP TRIGGER IF EXISTS quote_attachments_advance_quote_revision ON public.quote_attachments;
CREATE TRIGGER quote_attachments_advance_quote_revision
AFTER INSERT OR UPDATE OR DELETE ON public.quote_attachments
FOR EACH ROW EXECUTE FUNCTION public.advance_quote_revision_from_child();

DROP TRIGGER IF EXISTS quote_workflow_states_advance_quote_revision ON public.quote_workflow_states;
CREATE TRIGGER quote_workflow_states_advance_quote_revision
AFTER INSERT OR UPDATE OR DELETE ON public.quote_workflow_states
FOR EACH ROW EXECUTE FUNCTION public.advance_quote_revision_from_child();

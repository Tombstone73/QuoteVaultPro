-- Adds permanent global human-readable references for bug reports and feature
-- requests. These identifiers are intentionally not organization-scoped because
-- feedback feeds a single Printers Hero product backlog.

ALTER TABLE bug_reports
  ADD COLUMN IF NOT EXISTS reference_number text;

CREATE SEQUENCE IF NOT EXISTS bug_reports_bug_reference_seq;
CREATE SEQUENCE IF NOT EXISTS bug_reports_feature_reference_seq;

WITH ordered AS (
  SELECT
    id,
    type,
    row_number() OVER (
      PARTITION BY type
      ORDER BY created_at ASC, id ASC
    ) AS reference_index
  FROM bug_reports
)
UPDATE bug_reports AS br
SET reference_number =
  CASE
    WHEN ordered.type = 'feature' THEN 'F-' || lpad(ordered.reference_index::text, 4, '0')
    ELSE 'B-' || lpad(ordered.reference_index::text, 4, '0')
  END
FROM ordered
WHERE br.id = ordered.id;

DO $$
DECLARE
  max_bug integer;
  max_feature integer;
BEGIN
  SELECT coalesce(max((substring(reference_number from 3))::integer), 0)
    INTO max_bug
    FROM bug_reports
    WHERE reference_number ~ '^B-[0-9]+$';

  SELECT coalesce(max((substring(reference_number from 3))::integer), 0)
    INTO max_feature
    FROM bug_reports
    WHERE reference_number ~ '^F-[0-9]+$';

  IF max_bug > 0 THEN
    PERFORM setval('bug_reports_bug_reference_seq', max_bug, true);
  ELSE
    PERFORM setval('bug_reports_bug_reference_seq', 1, false);
  END IF;

  IF max_feature > 0 THEN
    PERFORM setval('bug_reports_feature_reference_seq', max_feature, true);
  ELSE
    PERFORM setval('bug_reports_feature_reference_seq', 1, false);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION assign_bug_report_reference_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.reference_number IS NULL OR btrim(NEW.reference_number) = '' THEN
    IF NEW.type = 'feature' THEN
      NEW.reference_number := 'F-' || lpad(nextval('bug_reports_feature_reference_seq')::text, 4, '0');
    ELSE
      NEW.reference_number := 'B-' || lpad(nextval('bug_reports_bug_reference_seq')::text, 4, '0');
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION prevent_bug_report_reference_number_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.reference_number IS DISTINCT FROM NEW.reference_number THEN
    RAISE EXCEPTION 'bug_reports.reference_number is immutable once assigned';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bug_reports_assign_reference_number_trg ON bug_reports;
CREATE TRIGGER bug_reports_assign_reference_number_trg
BEFORE INSERT ON bug_reports
FOR EACH ROW
EXECUTE FUNCTION assign_bug_report_reference_number();

DROP TRIGGER IF EXISTS bug_reports_reference_number_immutable_trg ON bug_reports;
CREATE TRIGGER bug_reports_reference_number_immutable_trg
BEFORE UPDATE OF reference_number ON bug_reports
FOR EACH ROW
EXECUTE FUNCTION prevent_bug_report_reference_number_update();

ALTER TABLE bug_reports
  ALTER COLUMN reference_number SET NOT NULL;

ALTER TABLE bug_reports
  DROP CONSTRAINT IF EXISTS bug_reports_reference_number_format_check;

ALTER TABLE bug_reports
  ADD CONSTRAINT bug_reports_reference_number_format_check
  CHECK (reference_number ~ '^[BF]-[0-9]{4,}$');

CREATE UNIQUE INDEX IF NOT EXISTS bug_reports_reference_number_uidx
  ON bug_reports (reference_number);

CREATE INDEX IF NOT EXISTS bug_reports_reference_number_idx
  ON bug_reports (reference_number);

COMMENT ON COLUMN bug_reports.reference_number IS
  'Permanent global product-backlog reference, for example B-0001 or F-0001. Not organization-scoped and immutable after assignment.';

-- Forward repair for physical DEV drift found by the schema reconciliation audit.
-- Do not alter historic migration/ledger entries: this migration is intentionally
-- self-contained and safe for databases with either the old or intended shape.

-- A production run must survive order deletion as historical production evidence.
-- Preserve one already-correct SET NULL constraint if it exists; remove every
-- duplicate or non-SET-NULL FK on this exact relationship, then create one only
-- when none remains.
ALTER TABLE public.production_runs
  ALTER COLUMN order_id DROP NOT NULL;

DO $$
DECLARE
  production_runs_order_id_attnum smallint;
  orders_id_attnum smallint;
  existing_fk record;
  kept_set_null_fk boolean := false;
BEGIN
  SELECT attnum INTO production_runs_order_id_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.production_runs'::regclass
    AND attname = 'order_id'
    AND NOT attisdropped;

  SELECT attnum INTO orders_id_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.orders'::regclass
    AND attname = 'id'
    AND NOT attisdropped;

  IF production_runs_order_id_attnum IS NULL OR orders_id_attnum IS NULL THEN
    RAISE EXCEPTION 'Cannot reconcile production_runs.order_id FK: expected columns are missing';
  END IF;

  FOR existing_fk IN
    SELECT conname, confdeltype
    FROM pg_constraint
    WHERE conrelid = 'public.production_runs'::regclass
      AND contype = 'f'
      AND confrelid = 'public.orders'::regclass
      AND conkey = ARRAY[production_runs_order_id_attnum]::smallint[]
      AND confkey = ARRAY[orders_id_attnum]::smallint[]
    ORDER BY oid
  LOOP
    IF existing_fk.confdeltype = 'n' AND NOT kept_set_null_fk THEN
      kept_set_null_fk := true;
    ELSE
      EXECUTE format('ALTER TABLE public.production_runs DROP CONSTRAINT %I', existing_fk.conname);
    END IF;
  END LOOP;

  IF NOT kept_set_null_fk THEN
    ALTER TABLE public.production_runs
      ADD CONSTRAINT production_runs_order_id_orders_id_fk
      FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Canonical artwork retirement is a current runtime state, not a historical
-- compatibility value. PostgreSQL handles repeated execution idempotently.
ALTER TYPE public.line_item_file_status ADD VALUE IF NOT EXISTS 'retired';

-- Canonical order identity permits a customer, a contact, or both.
ALTER TABLE public.orders
  ALTER COLUMN customer_id DROP NOT NULL;

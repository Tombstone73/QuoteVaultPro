-- Production Workflow MVP: Jobs + Notes + Status Log
DO $$ BEGIN
  -- Jobs table (add columns if table already existed)
  CREATE TABLE IF NOT EXISTS jobs (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id varchar REFERENCES orders(id) ON DELETE CASCADE,
    order_line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
    product_type varchar(200) NOT NULL,
    status varchar(50) NOT NULL DEFAULT 'pending_prepress',
    priority varchar(20) NOT NULL DEFAULT 'normal',
    specs_json jsonb,
    assigned_to_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
    notes_internal text,
    created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp DEFAULT now() NOT NULL
  );

  -- Ensure new columns exist if previous definition differed
  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name='jobs' AND column_name='order_id'
    ) THEN
      ALTER TABLE jobs ADD COLUMN order_id varchar REFERENCES orders(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name='jobs' AND column_name='priority'
    ) THEN
      ALTER TABLE jobs ADD COLUMN priority varchar(20) NOT NULL DEFAULT 'normal';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name='jobs' AND column_name='specs_json'
    ) THEN
      ALTER TABLE jobs ADD COLUMN specs_json jsonb;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name='jobs' AND column_name='assigned_to_user_id'
    ) THEN
      ALTER TABLE jobs ADD COLUMN assigned_to_user_id varchar REFERENCES users(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name='jobs' AND column_name='notes_internal'
    ) THEN
      ALTER TABLE jobs ADD COLUMN notes_internal text;
    END IF;
  END $$;

  -- Indexes for jobs
  CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
  CREATE INDEX IF NOT EXISTS jobs_assigned_to_user_id_idx ON jobs(assigned_to_user_id);
  CREATE INDEX IF NOT EXISTS jobs_order_id_idx ON jobs(order_id);

  -- Job notes table
  CREATE TABLE IF NOT EXISTS job_notes (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id varchar NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_id varchar REFERENCES users(id) ON DELETE SET NULL,
    note_text text NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL
  );
  CREATE INDEX IF NOT EXISTS job_notes_job_id_idx ON job_notes(job_id);
  CREATE INDEX IF NOT EXISTS job_notes_created_at_idx ON job_notes(created_at);

  -- Job status log table
  CREATE TABLE IF NOT EXISTS job_status_log (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id varchar NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    old_status varchar(50),
    new_status varchar(50) NOT NULL,
    user_id varchar REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp DEFAULT now() NOT NULL
  );
  CREATE INDEX IF NOT EXISTS job_status_log_job_id_idx ON job_status_log(job_id);
  CREATE INDEX IF NOT EXISTS job_status_log_created_at_idx ON job_status_log(created_at);
END $$;

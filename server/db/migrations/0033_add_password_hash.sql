BEGIN;

DO $$
BEGIN
  ALTER TABLE users ADD COLUMN password_hash TEXT;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  CREATE INDEX users_email_lower_idx ON users (lower(email));
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

COMMIT;

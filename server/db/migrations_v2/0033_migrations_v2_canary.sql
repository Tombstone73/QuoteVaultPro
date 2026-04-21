-- Migration 0033: migrations_v2 DDL canary
-- Purpose: sentinel row that proves DDL + DML execution reached this database.
-- Harmless singleton table. Checked by runMigrations.ts post-migrate diagnostic.
-- DO NOT DROP — its presence is the deployment proof.

CREATE TABLE IF NOT EXISTS _migrations_v2_canary (
  id         integer     PRIMARY KEY DEFAULT 1,
  verified   boolean     NOT NULL DEFAULT TRUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT singleton CHECK (id = 1)
);

INSERT INTO _migrations_v2_canary (id) VALUES (1) ON CONFLICT DO NOTHING;

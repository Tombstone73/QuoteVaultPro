-- Migration 0030: Add Gmail OAuth connection status tracking to email_settings
--
-- Adds two columns to support the platform-managed Gmail OAuth flow:
--   connection_status — tracks the state machine for the org's Gmail connection
--   connected_at      — timestamp written only after a successful OAuth callback
--
-- TEMP vs PERMANENT boundary:
--   The OAuth state token is never stored in the DB (it lives as a signed HMAC in memory).
--   connection_status and connected_at are PERMANENT — written only after a successful
--   token exchange + Gmail profile retrieval.
--
-- Safe to run on production: ADD COLUMN IF NOT EXISTS is idempotent.

ALTER TABLE email_settings
  ADD COLUMN IF NOT EXISTS connection_status varchar(50) NOT NULL DEFAULT 'not_connected',
  ADD COLUMN IF NOT EXISTS connected_at timestamp;

-- Backfill: existing records that already have a refresh_token (legacy manual flow)
-- are treated as connected so they continue working until the org reconnects.
UPDATE email_settings
  SET connection_status = 'connected',
      connected_at = updated_at
  WHERE refresh_token IS NOT NULL
    AND refresh_token <> '';

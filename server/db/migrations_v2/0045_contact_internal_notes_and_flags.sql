-- Migration 0045: Add internal_notes and flags to customer_contacts
-- internal_notes: staff-only free-text CRM notes about a contact.
-- flags: JSONB string array of stable flag values (e.g. "vip", "do_not_email").
--
-- Both fields are nullable with no default so existing rows are unaffected.
-- The flags column stores a JSON array of strings validated at the application layer.

ALTER TABLE customer_contacts
  ADD COLUMN IF NOT EXISTS internal_notes text,
  ADD COLUMN IF NOT EXISTS flags jsonb DEFAULT NULL;

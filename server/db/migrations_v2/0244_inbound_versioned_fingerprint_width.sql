-- Evidence identities include a version prefix (v1: + 64 hex characters).
-- Preserve the full identity; never truncate it or rewrite reviewed coverage.
ALTER TABLE public.inbound_email_processing_jobs
  ALTER COLUMN evidence_fingerprint TYPE varchar(128);

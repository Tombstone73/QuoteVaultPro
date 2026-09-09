-- DEV-QA delivery suppression is durable evidence that an external provider
-- side effect was deliberately withheld. It must never be represented as a
-- provider success in either Proof or Portal delivery records.
ALTER TABLE v2_proof_delivery_jobs
  DROP CONSTRAINT IF EXISTS v2_proof_delivery_jobs_state_check;
ALTER TABLE v2_proof_delivery_jobs
  ADD CONSTRAINT v2_proof_delivery_jobs_state_check
  CHECK (state IN ('queued','processing','retry_wait','sent','failed','ambiguous','suppressed'));

ALTER TABLE v2_portal_invitation_delivery_attempts
  DROP CONSTRAINT IF EXISTS v2_portal_invitation_delivery_attempts_delivery_state_check;
ALTER TABLE v2_portal_invitation_delivery_attempts
  ADD CONSTRAINT v2_portal_invitation_delivery_attempts_delivery_state_check
  CHECK (delivery_state IN ('pending','succeeded','uncertain','suppressed'));

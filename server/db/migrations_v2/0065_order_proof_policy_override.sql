ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS proof_approval_policy_override varchar(32) NOT NULL DEFAULT 'inherit_default',
  ADD COLUMN IF NOT EXISTS proof_approval_override_reason text,
  ADD COLUMN IF NOT EXISTS proof_approval_override_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS proof_approval_override_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_proof_approval_policy_override_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_proof_approval_policy_override_check
      CHECK (proof_approval_policy_override IN ('inherit_default', 'force_required', 'bypass'));
  END IF;
END $$;


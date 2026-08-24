-- Normalize V1 hosted processor enablement. A connected Stripe account is
-- configuration, not authorization to offer Stripe for payments.
ALTER TABLE organization_payment_settings
  ADD COLUMN IF NOT EXISTS stripe_enabled boolean NOT NULL DEFAULT false;

-- Existing EPS defaults with EPS disabled are structurally invalid. Stripe
-- defaults are also cleared rather than inferring enablement from a connected
-- account, because readiness requires a runtime Connect-account check.
UPDATE organization_payment_settings
SET provider = 'none'
WHERE (provider = 'eps' AND eps_enabled = false)
   OR provider = 'stripe';

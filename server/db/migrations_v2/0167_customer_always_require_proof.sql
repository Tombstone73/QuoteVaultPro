-- Customer proof requests must remain effective when product-driven proofing
-- is suspended by the organization policy.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS always_require_proof boolean NOT NULL DEFAULT false;

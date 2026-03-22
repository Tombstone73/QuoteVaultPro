ALTER TABLE products
ADD COLUMN IF NOT EXISTS requires_proof_approval boolean NOT NULL DEFAULT false;
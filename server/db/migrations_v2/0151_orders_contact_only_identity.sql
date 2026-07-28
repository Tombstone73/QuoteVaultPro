-- Orders may be addressed to an independent customer contact. Existing rows
-- are untouched; application validation requires customer_id or contact_id.
ALTER TABLE "orders" ALTER COLUMN "customer_id" DROP NOT NULL;

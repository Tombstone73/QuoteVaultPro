-- Explicit customer access is independent of accounting approval. No backfill.
ALTER TABLE invoices ADD COLUMN customer_released_at timestamptz;
ALTER TABLE invoices ADD COLUMN customer_released_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL;

-- Pickup traveler quantities and box labels are immutable print-job context,
-- never fulfillment state. Keeping them with the existing durable print job
-- lets a claimed Windows agent render the exact requested batch.
ALTER TABLE direct_print_jobs
  ADD COLUMN IF NOT EXISTS print_context jsonb;

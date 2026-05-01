ALTER TABLE invoice_reminder_settings
  ADD COLUMN IF NOT EXISTS send_copy_to_internal_email boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS internal_copy_email text,
  ADD COLUMN IF NOT EXISTS pause_for_manual_billing_customers boolean NOT NULL DEFAULT false;

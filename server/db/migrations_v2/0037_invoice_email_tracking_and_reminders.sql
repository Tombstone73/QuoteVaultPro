CREATE TABLE IF NOT EXISTS invoice_email_logs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id varchar NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  message_id text,
  sent_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_email_logs_organization_id_idx
  ON invoice_email_logs (organization_id);

CREATE INDEX IF NOT EXISTS invoice_email_logs_invoice_id_idx
  ON invoice_email_logs (invoice_id);

CREATE INDEX IF NOT EXISTS invoice_email_logs_invoice_sent_at_idx
  ON invoice_email_logs (invoice_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS invoice_email_logs_org_invoice_idx
  ON invoice_email_logs (organization_id, invoice_id);

CREATE TABLE IF NOT EXISTS invoice_reminder_logs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id varchar NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  reminder_number integer NOT NULL,
  sent_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_reminder_logs_invoice_sent_at_idx
  ON invoice_reminder_logs (invoice_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS invoice_reminder_settings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  first_reminder_days_after_due integer,
  repeat_interval_days integer,
  max_reminders integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS invoice_reminder_settings_organization_id_uidx
  ON invoice_reminder_settings (organization_id);
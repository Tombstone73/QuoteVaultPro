ALTER TABLE vendors
ADD COLUMN IF NOT EXISTS sales_rep_name varchar(255),
ADD COLUMN IF NOT EXISTS sales_rep_email varchar(255),
ADD COLUMN IF NOT EXISTS sales_rep_phone varchar(50),
ADD COLUMN IF NOT EXISTS additional_contact_info text,
ADD COLUMN IF NOT EXISTS lead_time_text varchar(120);

UPDATE vendors
SET lead_time_text = CONCAT(default_lead_time_days, ' days')
WHERE lead_time_text IS NULL
  AND default_lead_time_days IS NOT NULL;
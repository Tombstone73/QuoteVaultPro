ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "customer_type" varchar(50) DEFAULT 'business',
  ADD COLUMN IF NOT EXISTS "display_name" varchar(255),
  ADD COLUMN IF NOT EXISTS "individual_first_name" varchar(100),
  ADD COLUMN IF NOT EXISTS "individual_last_name" varchar(100),
  ADD COLUMN IF NOT EXISTS "source_contact_id" varchar,
  ADD COLUMN IF NOT EXISTS "account_creation_source" varchar(50);

UPDATE "customers"
SET "customer_type" = 'business'
WHERE "customer_type" IS NULL;

UPDATE "customers"
SET "display_name" = "company_name"
WHERE "display_name" IS NULL
  AND "company_name" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_source_contact_id_customer_contacts_id_fk'
  ) THEN
    ALTER TABLE "customers"
      ADD CONSTRAINT "customers_source_contact_id_customer_contacts_id_fk"
      FOREIGN KEY ("source_contact_id") REFERENCES "customer_contacts"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "customers_source_contact_idx"
  ON "customers" ("organization_id", "source_contact_id");

CREATE UNIQUE INDEX IF NOT EXISTS "customers_individual_source_contact_uidx"
  ON "customers" ("organization_id", "source_contact_id")
  WHERE "customer_type" = 'individual'
    AND "source_contact_id" IS NOT NULL;

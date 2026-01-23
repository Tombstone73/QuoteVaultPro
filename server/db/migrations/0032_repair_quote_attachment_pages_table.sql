-- Repair migration: Re-create quote_attachment_pages table if missing
-- This migration is idempotent and safe to run multiple times
-- Context: Migration 0001 was tracked but table never applied in some environments

-- Create the table (IF NOT EXISTS for safety)
CREATE TABLE IF NOT EXISTS public.quote_attachment_pages (
	id varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	organization_id varchar NOT NULL,
	attachment_id varchar NOT NULL,
	page_index integer NOT NULL,
	thumb_status "thumb_status" DEFAULT 'uploaded' NOT NULL,
	thumb_key text,
	preview_key text,
	thumb_error text,
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NOT NULL
);

-- Create indexes (IF NOT EXISTS for safety)
CREATE INDEX IF NOT EXISTS quote_attachment_pages_attachment_id_idx ON public.quote_attachment_pages USING btree (attachment_id);
CREATE INDEX IF NOT EXISTS quote_attachment_pages_organization_id_idx ON public.quote_attachment_pages USING btree (organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS quote_attachment_pages_attachment_page_idx ON public.quote_attachment_pages USING btree (attachment_id, page_index);

-- Add foreign key constraints (safe with duplicate_object exception handling)
DO $$
 BEGIN
  ALTER TABLE "quote_attachment_pages" ADD CONSTRAINT "quote_attachment_pages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
 EXCEPTION
  WHEN duplicate_object THEN null;
 END $$;

DO $$
 BEGIN
  ALTER TABLE "quote_attachment_pages" ADD CONSTRAINT "quote_attachment_pages_attachment_id_quote_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."quote_attachments"("id") ON DELETE cascade ON UPDATE no action;
 EXCEPTION
  WHEN duplicate_object THEN null;
 END $$;

-- Track this migration in Drizzle's migration table
INSERT INTO public.__drizzle_migrations (id, hash, created_at)
VALUES (32, '0032_repair_quote_attachment_pages_table', 1737676800000)
ON CONFLICT (id) DO NOTHING;

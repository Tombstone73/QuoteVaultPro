-- Explicit ordering approval is separate from calculator visibility.
ALTER TABLE public.products
  ADD COLUMN portal_orderable boolean NOT NULL DEFAULT false;

CREATE TABLE public.portal_storefront_carts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id varchar NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  access_id varchar NOT NULL REFERENCES public.customer_portal_access(id) ON DELETE CASCADE,
  status varchar(16) NOT NULL DEFAULT 'open',
  version integer NOT NULL DEFAULT 0,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  review jsonb,
  submission_key varchar(64),
  order_id varchar REFERENCES public.orders(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_storefront_carts_status_ck CHECK (status IN ('open', 'submitted', 'abandoned')),
  CONSTRAINT portal_storefront_carts_version_ck CHECK (version >= 0)
);
CREATE UNIQUE INDEX portal_storefront_carts_one_open_uidx ON public.portal_storefront_carts (organization_id, access_id) WHERE status = 'open';
CREATE UNIQUE INDEX portal_storefront_carts_submission_uidx ON public.portal_storefront_carts (organization_id, submission_key) WHERE submission_key IS NOT NULL;
CREATE INDEX portal_storefront_carts_customer_idx ON public.portal_storefront_carts (organization_id, customer_id);

CREATE TABLE public.portal_storefront_cart_files (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cart_id varchar NOT NULL REFERENCES public.portal_storefront_carts(id) ON DELETE CASCADE,
  line_id varchar NOT NULL,
  file_record_id varchar NOT NULL REFERENCES public.file_records(id) ON DELETE RESTRICT,
  original_filename text NOT NULL,
  stored_filename text,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  checksum text,
  extension text,
  note text,
  removed_at timestamptz,
  order_attachment_id varchar REFERENCES public.order_attachments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portal_storefront_cart_files_cart_line_idx ON public.portal_storefront_cart_files (organization_id, cart_id, line_id);
CREATE INDEX portal_storefront_cart_files_retention_idx ON public.portal_storefront_cart_files (removed_at);

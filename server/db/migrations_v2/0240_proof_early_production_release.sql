CREATE TABLE public.line_item_proof_early_releases (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  line_item_id varchar NOT NULL REFERENCES public.order_line_items(id) ON DELETE CASCADE,
  proof_version_id varchar NOT NULL REFERENCES public.line_item_proof_versions(id) ON DELETE RESTRICT,
  proof_file_id varchar NOT NULL REFERENCES public.order_attachments(id) ON DELETE RESTRICT,
  artwork_fingerprint varchar(64) NOT NULL,
  operation_id varchar(128) NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  actor_user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  context jsonb NOT NULL
);
CREATE UNIQUE INDEX proof_early_release_operation_uidx ON public.line_item_proof_early_releases(organization_id, operation_id);
CREATE UNIQUE INDEX proof_early_release_revision_uidx ON public.line_item_proof_early_releases(organization_id, line_item_id, proof_version_id, artwork_fingerprint);

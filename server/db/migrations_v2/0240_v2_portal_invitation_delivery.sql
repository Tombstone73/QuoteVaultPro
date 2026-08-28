-- Portal access and invite tokens remain the canonical customer-portal
-- authority. This V2-only record captures provider confirmation without ever
-- persisting the raw invitation token outside its existing one-way hash.
CREATE TABLE v2_portal_invitation_delivery_attempts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  portal_access_id varchar NOT NULL REFERENCES customer_portal_access(id) ON DELETE CASCADE,
  operation_request_id varchar NOT NULL REFERENCES v2_operation_requests(id) ON DELETE RESTRICT,
  delivery_state varchar(20) NOT NULL CHECK (delivery_state IN ('pending','succeeded','uncertain')),
  provider_message_id varchar,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(organization_id,portal_access_id,operation_request_id),
  UNIQUE(operation_request_id)
);

CREATE INDEX v2_portal_invitation_delivery_access_idx
  ON v2_portal_invitation_delivery_attempts(organization_id, portal_access_id, created_at DESC);

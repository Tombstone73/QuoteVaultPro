-- Delivery evidence is distinct from the existing org_invites token authority.
CREATE TABLE v2_team_invitation_delivery_attempts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invite_id varchar NOT NULL REFERENCES org_invites(id) ON DELETE CASCADE,
  operation_request_id varchar NOT NULL REFERENCES v2_operation_requests(id) ON DELETE RESTRICT,
  delivery_state varchar(20) NOT NULL CHECK (delivery_state IN ('pending','succeeded','uncertain')),
  provider_message_id varchar,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
  UNIQUE(organization_id,invite_id),UNIQUE(operation_request_id)
);

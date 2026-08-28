-- M6: V2 owns tenant Gmail authorization.  The legacy email_settings row is
-- retained only as a one-time adoption source; canonical credentials are
-- encrypted before the legacy token is cleared.
CREATE TABLE v2_email_integrations (
  organization_id varchar PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL DEFAULT 'gmail',
  readiness_state varchar(32) NOT NULL DEFAULT 'not_configured',
  sending_address varchar(320),
  display_name varchar(255),
  encrypted_refresh_token text,
  encryption_key_id varchar(128),
  last_validated_at timestamptz,
  last_error_code varchar(80),
  legacy_adopted_at timestamptz,
  connected_at timestamptz,
  disconnected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_email_integrations_provider_chk CHECK (provider='gmail'),
  CONSTRAINT v2_email_integrations_state_chk CHECK (readiness_state IN ('not_configured','ready','reauth_required','error')),
  CONSTRAINT v2_email_integrations_ready_credential_chk CHECK (
    (readiness_state='ready' AND encrypted_refresh_token IS NOT NULL AND sending_address IS NOT NULL)
    OR readiness_state <> 'ready'
  )
);

CREATE TABLE v2_email_oauth_states (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  principal_subject varchar(255) NOT NULL,
  session_hash varchar(80) NOT NULL,
  state_hash varchar(80) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_email_oauth_states_expiry_chk CHECK (expires_at > created_at)
);
CREATE INDEX v2_email_oauth_states_active_idx ON v2_email_oauth_states(organization_id, expires_at) WHERE consumed_at IS NULL;

CREATE TABLE v2_email_integration_audit_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type varchar(48) NOT NULL,
  provider varchar(32) NOT NULL,
  sending_address varchar(320),
  principal_kind varchar(32) NOT NULL,
  principal_subject varchar(255) NOT NULL,
  staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_email_integration_audit_events_type_chk CHECK (event_type IN ('connected','reconnected','disconnected','legacy_adopted','reauth_required')),
  CONSTRAINT v2_email_integration_audit_events_detail_object_chk CHECK (jsonb_typeof(detail)='object')
);
CREATE INDEX v2_email_integration_audit_events_org_created_idx ON v2_email_integration_audit_events(organization_id, created_at DESC);

INSERT INTO v2_permission_capabilities(id,module,label)
VALUES ('communications.configure','communications','Configure customer communications')
ON CONFLICT(id) DO NOTHING;

INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT t.id,'communications.configure'
FROM v2_permission_set_templates t
WHERE t.template_key IN ('owner','administrator')
ON CONFLICT DO NOTHING;

WITH inserted AS (
  INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id)
  SELECT ps.organization_id,ps.id,'communications.configure'
  FROM v2_permission_sets ps
  WHERE ps.source_template_key IN ('owner','administrator')
  ON CONFLICT DO NOTHING
  RETURNING organization_id
)
UPDATE v2_permission_organization_state state
SET authority_revision=authority_revision+1,updated_at=now()
WHERE state.organization_id IN (SELECT DISTINCT organization_id FROM inserted);

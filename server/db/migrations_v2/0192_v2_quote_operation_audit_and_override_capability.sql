-- M1.7: a platform-owned semantic audit stream for all future V2 modules.
-- This is intentionally not a Sales audit table.
CREATE TABLE v2_audit_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  operation_request_id varchar,
  operation varchar(128) NOT NULL,
  event_type varchar(100) NOT NULL,
  resource_type varchar(80) NOT NULL,
  resource_id varchar NOT NULL,
  principal_kind varchar(32) NOT NULL,
  principal_subject varchar(160) NOT NULL,
  staff_actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_audit_events_principal_kind_chk CHECK (principal_kind IN ('staff','delegated_ai','portal','service')),
  CONSTRAINT v2_audit_events_changes_array_chk CHECK (jsonb_typeof(changes) = 'array'),
  CONSTRAINT v2_audit_events_request_tenant_fk FOREIGN KEY (operation_request_id, organization_id)
    REFERENCES v2_operation_requests(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_audit_events_operation_resource_request_uidx UNIQUE (organization_id, operation_request_id, resource_type, resource_id)
);
CREATE INDEX v2_audit_events_org_resource_created_idx ON v2_audit_events (organization_id, resource_type, resource_id, created_at DESC);

-- Selling-price authority is intentionally distinct from quote create/edit.
INSERT INTO v2_permission_capabilities(id,module,label) VALUES ('quote.overridePrice','sales','Override quote calculated price') ON CONFLICT(id) DO NOTHING;
INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT id,'quote.overridePrice' FROM v2_permission_set_templates WHERE template_key IN ('owner','administrator','sales') ON CONFLICT DO NOTHING;
INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id)
SELECT organization_id,id,'quote.overridePrice' FROM v2_permission_sets WHERE source_template_key IN ('owner','administrator','sales') ON CONFLICT DO NOTHING;

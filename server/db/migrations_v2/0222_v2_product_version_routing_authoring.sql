-- Product Versions select a Routing-owned definition.  The selected template
-- revision, fingerprint, and steps are snapshotted here so later template
-- edits cannot change a published Product Version or a future Order formed
-- from that historical version.
ALTER TABLE pbv2_tree_versions
  ADD CONSTRAINT pbv2_tree_versions_id_organization_product_uidx UNIQUE (id, organization_id, product_id);

CREATE TABLE v2_product_version_routing_specs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id varchar NOT NULL,
  product_version_id varchar NOT NULL,
  routing_mode varchar(24) NOT NULL,
  route_template_id varchar,
  source_template_revision bigint,
  source_template_fingerprint varchar(128),
  steps_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT v2_product_version_routing_specs_mode_chk CHECK (routing_mode IN ('route_required','no_route','unconfigured')),
  CONSTRAINT v2_product_version_routing_specs_shape_chk CHECK (
    (routing_mode='route_required' AND route_template_id IS NOT NULL AND source_template_revision IS NOT NULL AND source_template_fingerprint IS NOT NULL AND steps_json IS NOT NULL)
    OR (routing_mode IN ('no_route','unconfigured') AND route_template_id IS NULL AND source_template_revision IS NULL AND source_template_fingerprint IS NULL AND steps_json IS NULL)
  ),
  CONSTRAINT v2_product_version_routing_specs_version_uidx UNIQUE (organization_id, product_version_id),
  CONSTRAINT v2_product_version_routing_specs_product_version_fk FOREIGN KEY (product_version_id, organization_id, product_id)
    REFERENCES pbv2_tree_versions(id, organization_id, product_id) ON DELETE RESTRICT,
  CONSTRAINT v2_product_version_routing_specs_template_tenant_fk FOREIGN KEY (route_template_id, organization_id)
    REFERENCES v2_route_templates(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX v2_product_version_routing_specs_product_idx ON v2_product_version_routing_specs(organization_id, product_id, product_version_id);

-- Route template authorship already has a narrow capability. Administrators
-- are the existing normal DEV/operations authoring role; Owner remains intact.
INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT id,'route.manageTemplates' FROM v2_permission_set_templates WHERE template_key='administrator'
ON CONFLICT DO NOTHING;
WITH inserted AS (
  INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id)
  SELECT organization_id,id,'route.manageTemplates' FROM v2_permission_sets WHERE source_template_key='administrator'
  ON CONFLICT DO NOTHING
  RETURNING organization_id
)
UPDATE v2_permission_organization_state state
SET authority_revision=state.authority_revision+1,updated_at=now()
WHERE state.organization_id IN (SELECT DISTINCT organization_id FROM inserted);

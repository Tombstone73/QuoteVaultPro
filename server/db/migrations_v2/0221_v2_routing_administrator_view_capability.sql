-- Route advancement is an operational Administrator capability.  Preserve the
-- existing view/advance pairing for both template-backed and managed sets.
INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT id,'route.view'
FROM v2_permission_set_templates
WHERE template_key='administrator'
ON CONFLICT DO NOTHING;

WITH inserted AS (
  INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id)
  SELECT organization_id,id,'route.view'
  FROM v2_permission_sets
  WHERE source_template_key='administrator'
  ON CONFLICT DO NOTHING
  RETURNING organization_id
)
UPDATE v2_permission_organization_state state
SET authority_revision=state.authority_revision+1,updated_at=now()
WHERE state.organization_id IN (SELECT DISTINCT organization_id FROM inserted);

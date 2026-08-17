-- M5.1A: later domain migrations extended permission templates but deliberately
-- left already-created organization copies unchanged. Template-backed sets are
-- managed inherited sets; synchronize their missing grants once, while custom
-- sets (source_template_key IS NULL) remain untouched.
WITH inserted AS (
  INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id)
  SELECT permission_set.organization_id,permission_set.id,template_capability.capability_id
  FROM v2_permission_sets permission_set
  JOIN v2_permission_set_templates template
    ON template.template_key=permission_set.source_template_key
  JOIN v2_permission_set_template_capabilities template_capability
    ON template_capability.template_id=template.id
  WHERE permission_set.source_template_key IS NOT NULL
  ON CONFLICT DO NOTHING
  RETURNING organization_id
)
UPDATE v2_permission_organization_state state
SET authority_revision=state.authority_revision+1,updated_at=now()
WHERE state.organization_id IN (SELECT DISTINCT organization_id FROM inserted);

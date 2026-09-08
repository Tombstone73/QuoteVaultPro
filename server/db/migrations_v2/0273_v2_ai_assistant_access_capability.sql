-- M7.6B: AI access is an explicit staff capability.  It is deliberately not
-- granted to portal users and does not imply authority for any business tool.
INSERT INTO v2_permission_capabilities(id, module, label)
VALUES ('assistant.use', 'ai', 'Use the operational AI Assistant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO v2_permission_set_template_capabilities(template_id, capability_id)
SELECT id, 'assistant.use'
FROM v2_permission_set_templates
WHERE template_key IN ('owner', 'administrator')
ON CONFLICT DO NOTHING;

WITH inserted AS (
  INSERT INTO v2_permission_set_capabilities(organization_id, permission_set_id, capability_id)
  SELECT organization_id, id, 'assistant.use'
  FROM v2_permission_sets
  WHERE source_template_key IN ('owner', 'administrator')
  ON CONFLICT DO NOTHING
  RETURNING organization_id
)
UPDATE v2_permission_organization_state state
SET authority_revision = authority_revision + 1, updated_at = now()
WHERE state.organization_id IN (SELECT DISTINCT organization_id FROM inserted);

-- A normal frozen-route progression is distinct from exceptional reroute or
-- skip authority.  Managed operational sets receive the narrow capability;
-- custom sets remain unchanged by design.
INSERT INTO v2_permission_capabilities(id,module,label)
VALUES ('route.advance','routing','Advance an eligible frozen route step')
ON CONFLICT(id) DO NOTHING;

INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT id,'route.advance'
FROM v2_permission_set_templates
WHERE template_key IN ('owner','administrator','production')
ON CONFLICT DO NOTHING;

WITH inserted AS (
  INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id)
  SELECT organization_id,id,'route.advance'
  FROM v2_permission_sets
  WHERE source_template_key IN ('owner','administrator','production')
  ON CONFLICT DO NOTHING
  RETURNING organization_id
)
UPDATE v2_permission_organization_state state
SET authority_revision=state.authority_revision+1,updated_at=now()
WHERE state.organization_id IN (SELECT DISTINCT organization_id FROM inserted);

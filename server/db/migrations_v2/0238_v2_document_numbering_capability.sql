-- M6: human-facing numbering affects commercial identity. Only the Owner
-- template receives the dedicated capability; organization.configure is not
-- a substitute.

INSERT INTO v2_permission_capabilities(id,module,label)
VALUES ('numbering.configure','organization','Configure future document numbering')
ON CONFLICT(id) DO NOTHING;

INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT t.id,'numbering.configure'
FROM v2_permission_set_templates t
WHERE t.template_key='owner'
ON CONFLICT DO NOTHING;

WITH inserted AS (
  INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id)
  SELECT ps.organization_id,ps.id,'numbering.configure'
  FROM v2_permission_sets ps
  WHERE ps.source_template_key='owner'
  ON CONFLICT DO NOTHING
  RETURNING organization_id
)
UPDATE v2_permission_organization_state state
SET authority_revision=authority_revision+1,updated_at=now()
WHERE state.organization_id IN (SELECT DISTINCT organization_id FROM inserted);

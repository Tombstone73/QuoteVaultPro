-- M6: V2 organization identity configuration adopts company_settings as the
-- existing tenant truth. This migration adds only its scoped authority; it
-- deliberately does not duplicate or rewrite company profile data.
INSERT INTO v2_permission_capabilities(id,module,label)
VALUES ('organization.configure','organization','Configure organization identity and documents')
ON CONFLICT(id) DO NOTHING;

INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT t.id,'organization.configure'
FROM v2_permission_set_templates t
WHERE t.template_key IN ('owner','administrator')
ON CONFLICT DO NOTHING;

WITH inserted AS (
  INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id)
  SELECT ps.organization_id,ps.id,'organization.configure'
  FROM v2_permission_sets ps
  WHERE ps.source_template_key IN ('owner','administrator')
  ON CONFLICT DO NOTHING
  RETURNING organization_id
)
UPDATE v2_permission_organization_state state
SET authority_revision=authority_revision+1,updated_at=now()
WHERE state.organization_id IN (SELECT DISTINCT organization_id FROM inserted);

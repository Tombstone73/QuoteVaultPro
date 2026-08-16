-- source_template_key is provenance, not continuing authority. M1.9 adds the
-- capability to templates for newly-created sets but must not silently widen
-- existing organization-customized permission sets.
DELETE FROM v2_permission_set_capabilities capability
USING v2_permission_sets permission_set
WHERE capability.organization_id = permission_set.organization_id
  AND capability.permission_set_id = permission_set.id
  AND capability.capability_id = 'order.overridePrice'
  AND permission_set.source_template_key IN ('owner','administrator','sales');

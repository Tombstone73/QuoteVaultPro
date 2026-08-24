-- Formula identity, not FormulaRevision or ProductVersion, owns visibility and
-- optional Product scope. Existing identities predate a scope owner; retain
-- their historical tenant-library discoverability before enforcing the model.
ALTER TABLE v2_formula_identities
  ADD COLUMN scope_product_id varchar;

UPDATE v2_formula_identities
  SET visibility = 'library'
  WHERE visibility = 'product_scoped';

ALTER TABLE v2_formula_identities
  ADD CONSTRAINT v2_formula_identities_scope_product_tenant_fk
  FOREIGN KEY (scope_product_id, organization_id)
  REFERENCES products(id, organization_id) ON DELETE RESTRICT;

ALTER TABLE v2_formula_identities
  ADD CONSTRAINT v2_formula_identities_visibility_scope_chk
  CHECK (
    (visibility = 'library' AND scope_product_id IS NULL)
    OR
    (visibility = 'product_scoped' AND scope_product_id IS NOT NULL)
  );

CREATE INDEX v2_formula_identities_scope_product_idx
  ON v2_formula_identities(organization_id, scope_product_id)
  WHERE scope_product_id IS NOT NULL;

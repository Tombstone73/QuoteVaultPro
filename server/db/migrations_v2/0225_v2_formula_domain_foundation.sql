-- Formula expressions have a single owner.  Logical Formulas are mutable only
-- in catalog metadata; their pricing definitions live in append-only revisions.
CREATE TYPE v2_formula_visibility AS ENUM ('product_scoped','library');
CREATE TYPE v2_formula_status AS ENUM ('active','inactive','archived');
CREATE TABLE v2_formula_identities (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL,
  normalized_name varchar(255) NOT NULL,
  description text,
  visibility v2_formula_visibility NOT NULL DEFAULT 'product_scoped',
  status v2_formula_status NOT NULL DEFAULT 'active',
  current_revision_id varchar,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT v2_formula_identities_name_uidx UNIQUE (organization_id, normalized_name),
  CONSTRAINT v2_formula_identities_id_org_uidx UNIQUE (id, organization_id)
);

CREATE TABLE formula_revisions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  formula_id varchar NOT NULL,
  revision_number integer NOT NULL,
  expression text NOT NULL,
  declared_inputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT formula_revisions_number_chk CHECK (revision_number > 0),
  CONSTRAINT formula_revisions_expression_chk CHECK (length(btrim(expression)) > 0),
  CONSTRAINT formula_revisions_formula_tenant_fk FOREIGN KEY (formula_id, organization_id)
    REFERENCES v2_formula_identities(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT formula_revisions_formula_number_uidx UNIQUE (organization_id, formula_id, revision_number),
  CONSTRAINT formula_revisions_id_formula_org_uidx UNIQUE (id, formula_id, organization_id),
  CONSTRAINT formula_revisions_id_org_uidx UNIQUE (id, organization_id)
);

ALTER TABLE v2_formula_identities
  ADD CONSTRAINT v2_formula_identities_current_revision_tenant_fk
  FOREIGN KEY (current_revision_id, id, organization_id)
  REFERENCES formula_revisions(id, formula_id, organization_id) ON DELETE RESTRICT;

CREATE INDEX v2_formula_identities_catalog_idx
  ON v2_formula_identities(organization_id, status, visibility, normalized_name);
CREATE INDEX formula_revisions_formula_idx
  ON formula_revisions(organization_id, formula_id, revision_number DESC);

-- This append-only binding freezes existing and future ProductVersion Formula
-- resolution without mutating historical ProductVersion tree JSON.
CREATE TABLE v2_product_version_formula_revision_bindings (
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id varchar NOT NULL,
  product_version_id varchar NOT NULL,
  formula_id varchar NOT NULL,
  formula_revision_id varchar NOT NULL,
  input_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (organization_id, product_version_id),
  CONSTRAINT v2_product_version_formula_revision_product_fk FOREIGN KEY (product_version_id, organization_id, product_id)
    REFERENCES pbv2_tree_versions(id, organization_id, product_id) ON DELETE RESTRICT,
  CONSTRAINT v2_product_version_formula_revision_formula_fk FOREIGN KEY (formula_revision_id, formula_id, organization_id)
    REFERENCES formula_revisions(id, formula_id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX v2_product_version_formula_revision_formula_idx
  ON v2_product_version_formula_revision_bindings(organization_id, formula_id, formula_revision_id);

-- Revisions are immutable commercial definitions.
CREATE OR REPLACE FUNCTION v2_formula_revision_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Formula revisions are immutable' USING ERRCODE='23514';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER v2_formula_revision_immutable_trg
  BEFORE UPDATE OR DELETE ON formula_revisions
  FOR EACH ROW EXECUTE FUNCTION v2_formula_revision_immutable();

CREATE OR REPLACE FUNCTION v2_product_version_formula_binding_immutable() RETURNS trigger AS $$
DECLARE version_status text;
DECLARE target_product_version_id varchar;
DECLARE target_organization_id varchar;
DECLARE target_product_id varchar;
BEGIN
  -- Drafts may intentionally select a different immutable revision before
  -- publication. Once the owning ProductVersion is ACTIVE/historical, the
  -- binding is commercial history and must never move.
  IF TG_OP = 'DELETE' THEN
    target_product_version_id := OLD.product_version_id;
    target_organization_id := OLD.organization_id;
    target_product_id := OLD.product_id;
  ELSE
    target_product_version_id := NEW.product_version_id;
    target_organization_id := NEW.organization_id;
    target_product_id := NEW.product_id;
  END IF;
  SELECT status INTO version_status FROM pbv2_tree_versions
    WHERE id=target_product_version_id
      AND organization_id=target_organization_id
      AND product_id=target_product_id;
  IF version_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Published ProductVersion Formula revision bindings are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER v2_product_version_formula_binding_immutable_trg
  BEFORE UPDATE OR DELETE ON v2_product_version_formula_revision_bindings
  FOR EACH ROW EXECUTE FUNCTION v2_product_version_formula_binding_immutable();

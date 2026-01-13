-- Migration 0022: PBV2 (Product Builder v2) tree versions
-- Introduces versioned, immutable PBV2 trees with draft/publish lifecycle.

-- Status enum for PBV2 tree versions
DO $$ BEGIN
  CREATE TYPE pbv2_tree_version_status AS ENUM ('DRAFT', 'ACTIVE', 'DEPRECATED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Versioned PBV2 trees
CREATE TABLE IF NOT EXISTS pbv2_tree_versions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id VARCHAR NOT NULL REFERENCES products(id) ON DELETE CASCADE,

  status pbv2_tree_version_status NOT NULL DEFAULT 'DRAFT',
  schema_version INTEGER NOT NULL DEFAULT 1,
  tree_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  published_at TIMESTAMPTZ NULL,

  created_by_user_id VARCHAR NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id VARCHAR NULL REFERENCES users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pbv2_tree_versions_org_id_idx ON pbv2_tree_versions(organization_id);
CREATE INDEX IF NOT EXISTS pbv2_tree_versions_product_id_idx ON pbv2_tree_versions(product_id);
CREATE INDEX IF NOT EXISTS pbv2_tree_versions_status_idx ON pbv2_tree_versions(status);
CREATE INDEX IF NOT EXISTS pbv2_tree_versions_org_product_status_idx ON pbv2_tree_versions(organization_id, product_id, status);
CREATE INDEX IF NOT EXISTS pbv2_tree_versions_updated_at_idx ON pbv2_tree_versions(updated_at);

-- Link products to the currently active PBV2 tree version
ALTER TABLE IF EXISTS public.products
  ADD COLUMN IF NOT EXISTS pbv2_active_tree_version_id VARCHAR NULL;

-- Foreign key: product -> active PBV2 version
DO $$ BEGIN
  ALTER TABLE public.products
    ADD CONSTRAINT products_pbv2_active_tree_version_id_fkey
      FOREIGN KEY (pbv2_active_tree_version_id)
      REFERENCES pbv2_tree_versions(id)
      ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS products_pbv2_active_tree_version_id_idx ON products(pbv2_active_tree_version_id);

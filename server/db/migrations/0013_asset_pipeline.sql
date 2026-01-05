-- Migration 0013: Canonical Asset Pipeline
-- Introduces unified asset management for quotes, orders, and future modules
-- NO breaking changes to existing tables; legacy fields remain functional

-- Asset status enum
DO $$ BEGIN
  CREATE TYPE asset_status AS ENUM ('uploaded', 'analyzed', 'prepress_ready', 'prepress_failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Asset preview status enum
DO $$ BEGIN
  CREATE TYPE asset_preview_status AS ENUM ('pending', 'ready', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Asset variant kind enum
DO $$ BEGIN
  CREATE TYPE asset_variant_kind AS ENUM ('thumb', 'preview', 'prepress_normalized', 'prepress_report');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Asset variant status enum (reuses preview status pattern)
DO $$ BEGIN
  CREATE TYPE asset_variant_status AS ENUM ('pending', 'ready', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Asset link parent type enum
DO $$ BEGIN
  CREATE TYPE asset_link_parent_type AS ENUM ('quote_line_item', 'order', 'order_line_item', 'invoice', 'note');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Asset link role enum
DO $$ BEGIN
  CREATE TYPE asset_link_role AS ENUM ('primary', 'attachment', 'proof', 'reference', 'other');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Assets table: Canonical file records
CREATE TABLE IF NOT EXISTS assets (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL,
  file_key TEXT NOT NULL, -- uploads/org_<orgId>/asset/<assetId>/<filename>
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  sha256 TEXT, -- Optional: for deduplication
  status asset_status NOT NULL DEFAULT 'uploaded',
  preview_key TEXT, -- thumbs/org_<orgId>/asset/<assetId>/preview.jpg
  thumb_key TEXT, -- thumbs/org_<orgId>/asset/<assetId>/thumb.jpg
  preview_status asset_preview_status NOT NULL DEFAULT 'pending',
  preview_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for assets
CREATE INDEX IF NOT EXISTS assets_org_id_idx ON assets(organization_id);
CREATE INDEX IF NOT EXISTS assets_org_asset_idx ON assets(organization_id, id);
CREATE INDEX IF NOT EXISTS assets_file_key_idx ON assets(file_key);
CREATE INDEX IF NOT EXISTS assets_preview_status_idx ON assets(organization_id, preview_status) WHERE preview_status = 'pending';

-- Asset variants table: Derived files (thumbs, previews, future prepress outputs)
CREATE TABLE IF NOT EXISTS asset_variants (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL,
  asset_id VARCHAR NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  kind asset_variant_kind NOT NULL,
  key TEXT NOT NULL, -- Storage key for this variant
  status asset_variant_status NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(asset_id, kind) -- One variant per kind per asset
);

-- Indexes for asset_variants
CREATE INDEX IF NOT EXISTS asset_variants_org_id_idx ON asset_variants(organization_id);
CREATE INDEX IF NOT EXISTS asset_variants_asset_id_idx ON asset_variants(asset_id);
CREATE INDEX IF NOT EXISTS asset_variants_org_asset_idx ON asset_variants(organization_id, asset_id);
CREATE INDEX IF NOT EXISTS asset_variants_status_idx ON asset_variants(organization_id, status) WHERE status = 'pending';

-- Asset links table: Connects assets to consumers (quotes, orders, etc.)
CREATE TABLE IF NOT EXISTS asset_links (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL,
  asset_id VARCHAR NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  parent_type asset_link_parent_type NOT NULL,
  parent_id VARCHAR NOT NULL,
  role asset_link_role NOT NULL DEFAULT 'other',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for asset_links
CREATE INDEX IF NOT EXISTS asset_links_org_id_idx ON asset_links(organization_id);
CREATE INDEX IF NOT EXISTS asset_links_asset_id_idx ON asset_links(asset_id);
CREATE INDEX IF NOT EXISTS asset_links_parent_idx ON asset_links(organization_id, parent_type, parent_id);
CREATE INDEX IF NOT EXISTS asset_links_org_parent_role_idx ON asset_links(organization_id, parent_type, parent_id, role);

-- Comments for documentation
COMMENT ON TABLE assets IS 'Canonical file records for quotes, orders, invoices, and future modules. Storage path: uploads/org_{orgId}/asset/{assetId}/{filename}';
COMMENT ON TABLE asset_variants IS 'Derived files (thumbnails, previews, future prepress outputs). Storage path: thumbs/org_{orgId}/asset/{assetId}/{variant}.jpg';
COMMENT ON TABLE asset_links IS 'Links assets to their consumers (quote line items, orders, etc.). Many-to-many relationship.';

COMMENT ON COLUMN assets.file_key IS 'Storage key in format: uploads/org_{orgId}/asset/{assetId}/{originalFilename}';
COMMENT ON COLUMN assets.preview_key IS 'Storage key for preview variant: thumbs/org_{orgId}/asset/{assetId}/preview.jpg';
COMMENT ON COLUMN assets.thumb_key IS 'Storage key for thumbnail variant: thumbs/org_{orgId}/asset/{assetId}/thumb.jpg';
COMMENT ON COLUMN assets.sha256 IS 'Optional SHA256 hash for future deduplication';
COMMENT ON COLUMN assets.status IS 'Asset lifecycle: uploaded (default) | analyzed | prepress_ready | prepress_failed';
COMMENT ON COLUMN assets.preview_status IS 'Preview generation status: pending (default) | ready | failed';

COMMENT ON COLUMN asset_links.parent_type IS 'Type of parent entity: quote_line_item | order | order_line_item | invoice | note';
COMMENT ON COLUMN asset_links.parent_id IS 'ID of parent entity (e.g., quote line item ID, order ID)';
COMMENT ON COLUMN asset_links.role IS 'Asset role in context: primary | attachment | proof | reference | other';

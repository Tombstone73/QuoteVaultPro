-- Migration: 0020_multi_tenant_organizations.sql
-- Description: Creates organizations and user_organizations tables for multi-tenant architecture
-- Run order: FIRST (before 0021_add_organization_id_to_tables.sql)

-- ============================================================
-- PHASE 1: Create enum types (idempotent)
-- ============================================================

-- Organization type enum
DO $$ BEGIN
  CREATE TYPE organization_type AS ENUM ('internal', 'external_saas');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Organization status enum
DO $$ BEGIN
  CREATE TYPE organization_status AS ENUM ('active', 'suspended', 'trial', 'canceled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Org member role enum
DO $$ BEGIN
  CREATE TYPE org_member_role AS ENUM ('owner', 'admin', 'manager', 'member');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- PHASE 2: Create organizations table
-- ============================================================

CREATE TABLE IF NOT EXISTS organizations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  type organization_type NOT NULL DEFAULT 'internal',
  status organization_status NOT NULL DEFAULT 'active',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  trial_ends_at TIMESTAMPTZ,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for organizations
CREATE INDEX IF NOT EXISTS organizations_slug_idx ON organizations(slug);
CREATE INDEX IF NOT EXISTS organizations_status_idx ON organizations(status);
CREATE INDEX IF NOT EXISTS organizations_type_idx ON organizations(type);
CREATE INDEX IF NOT EXISTS organizations_type_status_idx ON organizations(type, status);

-- ============================================================
-- PHASE 3: Create user_organizations join table
-- ============================================================

CREATE TABLE IF NOT EXISTS user_organizations (
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role org_member_role NOT NULL DEFAULT 'member',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, organization_id)
);

-- Indexes for user_organizations
CREATE INDEX IF NOT EXISTS user_organizations_user_id_idx ON user_organizations(user_id);
CREATE INDEX IF NOT EXISTS user_organizations_organization_id_idx ON user_organizations(organization_id);
CREATE INDEX IF NOT EXISTS user_organizations_is_default_idx ON user_organizations(is_default);
CREATE INDEX IF NOT EXISTS user_organizations_user_default_idx ON user_organizations(user_id, is_default) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS user_organizations_role_idx ON user_organizations(role);

-- ============================================================
-- PHASE 4: Seed default "Titan Group" organization
-- ============================================================

INSERT INTO organizations (id, name, slug, type, status, settings)
VALUES (
  'org_titan_001',
  'Titan Group',
  'titan',
  'internal',
  'active',
  '{"timezone": "America/New_York", "currency": "USD", "dateFormat": "MM/DD/YYYY"}'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = NOW();

-- ============================================================
-- PHASE 5: Associate all existing users with Titan Group as owners
-- ============================================================

-- Insert all existing users as owners of the default org (if not already associated)
INSERT INTO user_organizations (user_id, organization_id, role, is_default)
SELECT 
  u.id, 
  'org_titan_001', 
  CASE 
    WHEN u.role = 'owner' OR u.is_admin = true THEN 'owner'::org_member_role
    WHEN u.role = 'admin' THEN 'admin'::org_member_role
    WHEN u.role = 'manager' THEN 'manager'::org_member_role
    ELSE 'member'::org_member_role
  END,
  true
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM user_organizations uo 
  WHERE uo.user_id = u.id AND uo.organization_id = 'org_titan_001'
);

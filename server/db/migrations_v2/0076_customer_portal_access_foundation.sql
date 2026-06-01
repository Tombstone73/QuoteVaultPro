DO $$
BEGIN
  CREATE TYPE user_account_type AS ENUM ('INTERNAL_USER', 'PORTAL_CUSTOMER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE customer_portal_access_status AS ENUM ('DISABLED', 'PENDING_INVITE', 'ACTIVE', 'SUSPENDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_type user_account_type NOT NULL DEFAULT 'INTERNAL_USER';

UPDATE users
SET account_type = 'PORTAL_CUSTOMER'
WHERE role = 'customer';

UPDATE users
SET account_type = 'PORTAL_CUSTOMER'
WHERE id IN (
  SELECT user_id
  FROM customers
  WHERE user_id IS NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_portal_access (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id varchar NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  contact_id varchar REFERENCES customer_contacts(id) ON DELETE SET NULL,
  user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  status customer_portal_access_status NOT NULL DEFAULT 'DISABLED',
  email varchar(255) NOT NULL,
  display_name varchar(255),
  invite_sent_at timestamptz,
  invite_accepted_at timestamptz,
  password_set_at timestamptz,
  suspended_at timestamptz,
  disabled_at timestamptz,
  last_login_at timestamptz,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_portal_access_org_idx
  ON customer_portal_access(organization_id);

CREATE INDEX IF NOT EXISTS customer_portal_access_customer_idx
  ON customer_portal_access(customer_id);

CREATE INDEX IF NOT EXISTS customer_portal_access_contact_idx
  ON customer_portal_access(contact_id);

CREATE INDEX IF NOT EXISTS customer_portal_access_status_idx
  ON customer_portal_access(status);

CREATE UNIQUE INDEX IF NOT EXISTS customer_portal_access_org_contact_uidx
  ON customer_portal_access(organization_id, contact_id)
  WHERE contact_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customer_portal_access_user_uidx
  ON customer_portal_access(user_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_portal_invite_tokens (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  access_id varchar NOT NULL REFERENCES customer_portal_access(id) ON DELETE CASCADE,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  sent_at timestamptz,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_portal_invite_tokens_hash_uidx
  ON customer_portal_invite_tokens(token_hash);

CREATE INDEX IF NOT EXISTS customer_portal_invite_tokens_access_idx
  ON customer_portal_invite_tokens(access_id);

CREATE INDEX IF NOT EXISTS customer_portal_invite_tokens_org_idx
  ON customer_portal_invite_tokens(organization_id);

CREATE INDEX IF NOT EXISTS customer_portal_invite_tokens_expires_idx
  ON customer_portal_invite_tokens(expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS customer_portal_invite_tokens_active_access_uidx
  ON customer_portal_invite_tokens(access_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;

INSERT INTO customer_portal_access (
  organization_id,
  customer_id,
  user_id,
  status,
  email,
  display_name,
  invite_accepted_at,
  password_set_at,
  created_at,
  updated_at
)
SELECT
  c.organization_id,
  c.id,
  c.user_id,
  'ACTIVE',
  COALESCE(u.email, c.email),
  c.company_name,
  now(),
  ai.password_set_at,
  now(),
  now()
FROM customers c
JOIN users u ON u.id = c.user_id
LEFT JOIN auth_identities ai ON ai.user_id = u.id AND ai.provider = 'password'
WHERE c.user_id IS NOT NULL
  AND COALESCE(u.email, c.email) IS NOT NULL
ON CONFLICT DO NOTHING;

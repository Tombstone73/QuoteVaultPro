CREATE TABLE IF NOT EXISTS public.ups_account_connections (
  organization_id varchar PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  encrypted_account_number text NOT NULL,
  encrypted_access_token text NOT NULL,
  encrypted_refresh_token text NOT NULL,
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz,
  mode varchar(10) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'connected',
  verified_at timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

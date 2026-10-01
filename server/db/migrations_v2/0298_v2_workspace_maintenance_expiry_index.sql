-- Keep bounded tenant expiry selection off unrelated tenants and future drafts.
CREATE INDEX v2_sales_workspaces_tenant_expiry_idx
  ON v2_sales_workspaces(organization_id,expires_at,id) WHERE state='draft';
--> statement-breakpoint
-- Creator-scoped owner expiry must also skip other creators in the same tenant.
CREATE INDEX v2_sales_workspaces_creator_expiry_idx
  ON v2_sales_workspaces(organization_id,creator_user_id,expires_at,id) WHERE state='draft';

import type { Pool, PoolClient } from "pg";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { OrganizationId } from "../../src/modules/shared/commercialValues.js";
import type { TenantBranding } from "./ownerPdfRenderer.js";

type Row = Readonly<{ name: string; address: string | null; phone: string | null; email: string | null; website: string | null }>;
const value = (input: string | null) => input?.trim() || undefined;

/** Canonical tenant presentation projection used by every server-rendered document. */
export const readTenantBranding = async (client: Pool | PoolClient, organizationId: OrganizationId): Promise<TenantBranding> => {
  const result = await client.query<Row>("SELECT COALESCE(NULLIF(btrim(cs.company_display_name),''),NULLIF(btrim(cs.company_name),''),o.name) name,cs.address,cs.phone,cs.email,cs.website FROM organizations o LEFT JOIN company_settings cs ON cs.organization_id=o.id WHERE o.id=$1", [organizationId]);
  const row = result.rows[0];
  if (!row) throw new V2ApplicationError("NOT_FOUND", "Organization was not found.");
  return { name: row.name, ...(value(row.address) ? { address: value(row.address) } : {}), ...(value(row.phone) ? { phone: value(row.phone) } : {}), ...(value(row.email) ? { email: value(row.email) } : {}), ...(value(row.website) ? { website: value(row.website) } : {}) };
};

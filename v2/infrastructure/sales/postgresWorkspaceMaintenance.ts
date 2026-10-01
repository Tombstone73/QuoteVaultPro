import type { Pool } from "pg";
import type { SalesWorkspaceMaintenanceStore } from "../../src/modules/sales/workspaceMaintenance.js";
import { validateWorkspaceMaintenanceLimit, validateWorkspaceMaintenanceOrganizationId } from "../../src/modules/sales/workspaceMaintenance.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { PostgresSalesWorkspaceStore } from "./postgresSalesWorkspace.js";

/** Sales-only selection and expiry; Artwork owns every file/claim mutation. */
export class PostgresWorkspaceMaintenance implements SalesWorkspaceMaintenanceStore {
  private readonly workspaces: PostgresSalesWorkspaceStore;
  constructor(private readonly pool: Pool) { this.workspaces = new PostgresSalesWorkspaceStore(pool); }

  async listOrganizationIds(input: Readonly<{ afterOrganizationId: string | null; limit: number }>): Promise<readonly string[]> {
    validateWorkspaceMaintenanceLimit(input.limit, 25);
    if (input.afterOrganizationId !== null) validateWorkspaceMaintenanceOrganizationId(input.afterOrganizationId);
    const client = await this.pool.connect();
    try {
      const organizationIds: string[] = [];
      let cursor = input.afterOrganizationId ?? "";
      // One indexed seek per tenant, instead of DISTINCT scanning every row in
      // large tenants. The existing creation-unique index starts with org ID.
      // All states matter: removed-file claims can outlive a draft or promotion.
      for (let index = 0; index < input.limit; index += 1) {
        const row = (await client.query<{ organization_id: string }>(`SELECT organization_id FROM v2_sales_workspaces
          WHERE organization_id>$1 ORDER BY organization_id,creation_request_id LIMIT 1`, [cursor])).rows[0];
        if (!row) break;
        cursor = validateWorkspaceMaintenanceOrganizationId(row.organization_id);
        organizationIds.push(cursor);
      }
      return organizationIds;
    } finally { client.release(); }
  }

  async expireDrafts(input: Readonly<{ organizationId: string; now: string; limit: number }>): Promise<readonly string[]> {
    validateWorkspaceMaintenanceOrganizationId(input.organizationId);
    validateWorkspaceMaintenanceLimit(input.limit);
    if (typeof input.now !== "string" || !Number.isFinite(Date.parse(input.now))) {
      throw new V2ApplicationError("VALIDATION_ERROR", "Invalid workspace maintenance time.");
    }
    return this.workspaces.run(async (tx) => {
      const candidates = await tx.client.query<{ creator_user_id: string }>(`SELECT creator_user_id FROM v2_sales_workspaces
        WHERE organization_id=$1 AND state='draft' AND expires_at<=$2
        ORDER BY expires_at,id LIMIT $3`, [input.organizationId, input.now, input.limit]);
      const ids: string[] = [];
      for (const creatorUserId of new Set(candidates.rows.map((row) => row.creator_user_id))) {
        const remaining = input.limit - ids.length;
        if (!remaining) break;
        ids.push(...await tx.expireDrafts(input.organizationId, creatorUserId, input.now, remaining));
      }
      return ids;
    });
  }
}

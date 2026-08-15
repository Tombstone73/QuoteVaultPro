import type { TransactionalClient } from "../persistence/types.js";
import type { StaffMembershipAuthorityReader, TrustedStaffMembership } from "../../src/authorization/temporaryStaffPrincipalIssuer.js";

type MembershipRow = {
  user_id: string;
  organization_id: string;
  role: string | null;
  membership_updated_at: Date;
  organization_updated_at: Date;
  organization_status: "active" | "suspended" | "trial" | "canceled";
  delete_state: string;
  is_archived: boolean;
};

/**
 * Read-only V1-schema compatibility adapter. It deliberately never joins
 * `users`: global role/admin/platform flags cannot become tenant authority.
 */
export class PostgresStaffMembershipAuthorityReader implements StaffMembershipAuthorityReader {
  constructor(private readonly client: TransactionalClient) {}

  async findForStaffAuthority(userId: string, organizationId: string): Promise<TrustedStaffMembership | null> {
    const result = await this.client.query<MembershipRow>(`SELECT uo.user_id, uo.organization_id, uo.role,
      uo.updated_at AS membership_updated_at, o.updated_at AS organization_updated_at,
      o.status AS organization_status, o.delete_state, o.is_archived
      FROM user_organizations uo
      INNER JOIN organizations o ON o.id = uo.organization_id
      WHERE uo.user_id = $1 AND uo.organization_id = $2`, [userId, organizationId]);
    const row = result.rows[0];
    if (!row) return null;
    // V2 intentionally treats active and trial organizations as usable, while
    // suspended/canceled/archived/deleting organizations cannot issue Staff.
    const organizationActive = row.delete_state === "active" && !row.is_archived && (row.organization_status === "active" || row.organization_status === "trial");
    return {
      userId: row.user_id,
      organizationId: row.organization_id,
      role: row.role,
      // The legacy join table has no lifecycle flag: an existing row is active.
      active: true,
      organizationActive,
      authorityRevision: `${row.membership_updated_at.toISOString()}:${row.organization_updated_at.toISOString()}`,
    };
  }
}

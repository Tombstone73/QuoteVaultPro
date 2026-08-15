import type { PermissionAuthorityReader, PermissionAuthoritySnapshot, PermissionSetSummary } from "../../src/authorization/permissionSets.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import type { TransactionalClient } from "../persistence/types.js";

type OrganizationRow = { authority_revision: number; status: "active" | "suspended" | "trial" | "canceled"; delete_state: string; is_archived: boolean };
type SetRow = PermissionSetSummary & { capability_id: Capability | null };
const orgActive = (row: OrganizationRow) => row.delete_state === "active" && !row.is_archived && (row.status === "active" || row.status === "trial");
const unique = <T>(values: readonly T[]) => [...new Set(values)];

/** Read-only final V2 authority resolver. Every lookup has an organization predicate. */
export class PostgresPermissionAuthorityReader implements PermissionAuthorityReader {
  constructor(private readonly client: TransactionalClient) {}
  private async organization(organizationId: string): Promise<OrganizationRow | null> {
    const result = await this.client.query<OrganizationRow>(`SELECT s.authority_revision, o.status, o.delete_state, o.is_archived
      FROM v2_permission_organization_state s JOIN organizations o ON o.id = s.organization_id
      WHERE s.organization_id = $1`, [organizationId]);
    return result.rows[0] ?? null;
  }
  async resolveStaff(userId: string, organizationId: string): Promise<PermissionAuthoritySnapshot | null> {
    const organization = await this.organization(organizationId);
    if (!organization) return null;
    const membership = await this.client.query<{ user_id: string; is_active: boolean }>(`SELECT user_id, is_active FROM user_organizations WHERE user_id = $1 AND organization_id = $2`, [userId, organizationId]);
    if (!membership.rows[0]) return null;
    const sets = await this.client.query<SetRow>(`SELECT ps.id, ps.name, ps.active, ps.revision, pc.id AS capability_id
      FROM v2_staff_permission_set_assignments a
      JOIN v2_permission_sets ps ON ps.id = a.permission_set_id AND ps.organization_id = a.organization_id
      LEFT JOIN v2_permission_set_capabilities psc ON psc.permission_set_id = ps.id AND psc.organization_id = ps.organization_id
      LEFT JOIN v2_permission_capabilities pc ON pc.id = psc.capability_id AND pc.active = true
      WHERE a.user_id = $1 AND a.organization_id = $2 AND a.active = true AND ps.principal_kind = 'staff'`, [userId, organizationId]);
    const map = new Map<string, PermissionSetSummary>();
    for (const row of sets.rows) map.set(row.id, { id: row.id, name: row.name, active: row.active, revision: row.revision });
    return { organizationId, organizationActive: orgActive(organization), authorityRevision: organization.authority_revision,
      staff: { userId, membershipId: `user_organizations:${organizationId}:${userId}`, membershipActive: membership.rows[0].is_active,
        permissionSets: [...map.values()], capabilities: unique(sets.rows.filter((row) => row.active && row.capability_id !== null).map((row) => row.capability_id!)) } };
  }
  async resolvePortal(userId: string, organizationId: string): Promise<PermissionAuthoritySnapshot | null> {
    const organization = await this.organization(organizationId);
    if (!organization) return null;
    const access = await this.client.query<{ id: string; customer_id: string; status: string }>(`SELECT cpa.id, cpa.customer_id, cpa.status
      FROM customer_portal_access cpa JOIN customers c ON c.id = cpa.customer_id AND c.organization_id = cpa.organization_id
      WHERE cpa.user_id = $1 AND cpa.organization_id = $2`, [userId, organizationId]);
    const portal = access.rows[0];
    if (!portal) return null;
    const sets = await this.client.query<SetRow>(`SELECT ps.id, ps.name, ps.active, ps.revision, pc.id AS capability_id
      FROM v2_portal_permission_set_assignments a JOIN v2_permission_sets ps ON ps.id = a.permission_set_id AND ps.organization_id = a.organization_id
      LEFT JOIN v2_permission_set_capabilities psc ON psc.permission_set_id = ps.id AND psc.organization_id = ps.organization_id
      LEFT JOIN v2_permission_capabilities pc ON pc.id = psc.capability_id AND pc.active = true
      WHERE a.portal_access_id = $1 AND a.organization_id = $2 AND a.active = true AND ps.principal_kind = 'portal'`, [portal.id, organizationId]);
    const ceiling = await this.client.query<{ capability_id: Capability }>(`SELECT capability_id FROM v2_customer_portal_ceiling_capabilities
      WHERE organization_id = $1 AND customer_id = $2
      UNION ALL
      SELECT d.capability_id FROM v2_organization_portal_capability_defaults d
      WHERE d.organization_id = $1 AND NOT EXISTS (SELECT 1 FROM v2_customer_portal_ceiling_policies p WHERE p.organization_id = $1 AND p.customer_id = $2)`, [organizationId, portal.customer_id]);
    const map = new Map<string, PermissionSetSummary>();
    for (const row of sets.rows) map.set(row.id, { id: row.id, name: row.name, active: row.active, revision: row.revision });
    return { organizationId, organizationActive: orgActive(organization), authorityRevision: organization.authority_revision,
      portal: { userId, portalAccessId: portal.id, customerId: portal.customer_id, accessActive: portal.status === "ACTIVE", permissionSets: [...map.values()], assignedCapabilities: unique(sets.rows.filter((row) => row.active && row.capability_id !== null).map((row) => row.capability_id!)), ceilingCapabilities: unique(ceiling.rows.map((row) => row.capability_id)) } };
  }
}

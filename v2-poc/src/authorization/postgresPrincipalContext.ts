import type { PoolClient } from "pg";

import { type Capability, type DelegatedAiPrincipal, type Principal, type StaffPrincipal } from "./authorityPolicy";
import { V2PocError } from "../shared/errors";

const privilegedCapabilities: readonly Capability[] = ["orders.create", "quotes.convert", "proof.respond", "fulfillment.pickup", "finance.record"];

export type OrganizationContext = {
  principal: Principal;
  taxEnabled: boolean;
  defaultTaxRateBasisPoints: number;
};

/**
 * The only V2 adapter that translates persisted staff membership into a typed
 * principal. Canonical applications receive a Principal and never query
 * user_organizations themselves.
 */
export class PostgresPrincipalContext {
  async resolve(client: PoolClient, principal: Principal, organizationId: string): Promise<OrganizationContext> {
    const declaredOrganizationId = principal.kind === "ai" ? principal.staff.organizationId : principal.organizationId;
    if (declaredOrganizationId !== organizationId) {
      throw new V2PocError("FORBIDDEN", "Principal is bound to a different organization.");
    }
    const staff = principal.kind === "staff" ? principal : principal.kind === "ai" ? principal.staff : null;
    if (staff) {
      const row = (await client.query(
        `select uo.role,o.default_tax_rate,o.tax_enabled
           from user_organizations uo join organizations o on o.id=uo.organization_id
          where uo.user_id=$1 and uo.organization_id=$2 and o.delete_state='active' and o.is_archived=false`,
        [staff.actorId, organizationId],
      )).rows[0] as { role: string; default_tax_rate: string; tax_enabled: boolean } | undefined;
      if (!row) throw new V2PocError("FORBIDDEN", "Staff principal is not an active member of the requested organization.");
      const verifiedStaff: StaffPrincipal = {
        kind: "staff",
        organizationId,
        actorId: staff.actorId,
        capabilities: ["owner", "admin", "manager"].includes(row.role) ? privilegedCapabilities : [],
      };
      const verified: Principal = principal.kind === "ai"
        ? { ...principal as DelegatedAiPrincipal, staff: verifiedStaff }
        : verifiedStaff;
      return { principal: verified, taxEnabled: row.tax_enabled, defaultTaxRateBasisPoints: Math.round(Number(row.default_tax_rate) * 10_000) };
    }

    const row = (await client.query(
      `select default_tax_rate,tax_enabled from organizations where id=$1 and delete_state='active' and is_archived=false`,
      [organizationId],
    )).rows[0] as { default_tax_rate: string; tax_enabled: boolean } | undefined;
    if (!row) throw new V2PocError("NOT_FOUND", "Organization not found.");
    return { principal, taxEnabled: row.tax_enabled, defaultTaxRateBasisPoints: Math.round(Number(row.default_tax_rate) * 10_000) };
  }
}

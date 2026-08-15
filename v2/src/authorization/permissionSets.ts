import { failure, success, type ApplicationResult, V2ApplicationError } from "../errors/applicationError.js";
import type { Capability } from "./capabilities.js";
import type { AuthenticatedIdentity, PrincipalIssuer, PrincipalIssuanceContext } from "./principalIssuer.js";
import type { PortalPrincipal, Principal, StaffPrincipal } from "./principals.js";

export type PermissionSetSummary = Readonly<{ id: string; name: string; active: boolean; revision: number }>;
export type PermissionAuthoritySnapshot = Readonly<{
  organizationId: string;
  organizationActive: boolean;
  authorityRevision: string | number;
  staff?: Readonly<{ userId: string; membershipId: string; membershipActive: boolean; permissionSets: readonly PermissionSetSummary[]; capabilities: readonly Capability[] }>;
  portal?: Readonly<{ userId: string; portalAccessId: string; customerId: string; accessActive: boolean; permissionSets: readonly PermissionSetSummary[]; assignedCapabilities: readonly Capability[]; ceilingCapabilities: readonly Capability[] }>;
}>;

/** Persistence port: results are freshly resolved and structurally organization scoped. */
export interface PermissionAuthorityReader {
  resolveStaff(userId: string, organizationId: string): Promise<PermissionAuthoritySnapshot | null>;
  resolvePortal(userId: string, organizationId: string): Promise<PermissionAuthoritySnapshot | null>;
}

const frozen = (values: readonly Capability[]) => Object.freeze([...new Set(values)].sort()) as readonly Capability[];

/** Normal M1.5 issuance; there is intentionally no M1.4 role fallback. */
export class PermissionSetPrincipalIssuer implements PrincipalIssuer {
  constructor(private readonly authorities: PermissionAuthorityReader) {}
  async issue(identity: AuthenticatedIdentity, context?: PrincipalIssuanceContext): Promise<Principal> {
    if (!context?.organizationId) throw new V2ApplicationError("VALIDATION_ERROR", "An organization is required to issue a principal.");
    const result = identity.authenticationMethod === "session"
      ? await this.issueStaff(identity, context.organizationId)
      : identity.authenticationMethod === "portal_session"
        ? await this.issuePortal(identity, context.organizationId)
        : failure<Principal>(new V2ApplicationError("FORBIDDEN", "This issuer does not issue service principals."));
    if (!result.ok) throw result.error;
    return result.value;
  }
  async issueStaff(identity: AuthenticatedIdentity, organizationId: string): Promise<ApplicationResult<StaffPrincipal>> {
    if (!identity.subjectId || identity.authenticationMethod !== "session") return failure(new V2ApplicationError("FORBIDDEN", "A verified Staff session is required."));
    const snapshot = await this.authorities.resolveStaff(identity.subjectId, organizationId);
    const staff = snapshot?.staff;
    if (!snapshot || !staff || snapshot.organizationId !== organizationId || staff.userId !== identity.subjectId) return failure(new V2ApplicationError("NOT_FOUND", "Staff authority is unavailable for this organization."));
    if (!snapshot.organizationActive || !staff.membershipActive || staff.permissionSets.filter((set) => set.active).length === 0 || staff.capabilities.length === 0) return failure(new V2ApplicationError("FORBIDDEN", "No active V2 permission-set assignment grants Staff authority."));
    return success(Object.freeze({ kind: "staff", organizationId, userId: identity.subjectId, authority: Object.freeze({ membershipId: staff.membershipId, permissionSetIds: Object.freeze(staff.permissionSets.filter((set) => set.active).map((set) => set.id)), capabilities: frozen(staff.capabilities), source: "permission_set", authorityRevision: String(snapshot.authorityRevision) }) }));
  }
  async issuePortal(identity: AuthenticatedIdentity, organizationId: string): Promise<ApplicationResult<PortalPrincipal>> {
    if (!identity.subjectId || identity.authenticationMethod !== "portal_session") return failure(new V2ApplicationError("FORBIDDEN", "A verified Portal session is required."));
    const snapshot = await this.authorities.resolvePortal(identity.subjectId, organizationId);
    const portal = snapshot?.portal;
    if (!snapshot || !portal || snapshot.organizationId !== organizationId || portal.userId !== identity.subjectId) return failure(new V2ApplicationError("NOT_FOUND", "Portal authority is unavailable for this organization."));
    const allowed = new Set(portal.ceilingCapabilities);
    const capabilities = frozen(portal.assignedCapabilities.filter((capability) => allowed.has(capability)));
    if (!snapshot.organizationActive || !portal.accessActive || portal.permissionSets.filter((set) => set.active).length === 0 || capabilities.length === 0) return failure(new V2ApplicationError("FORBIDDEN", "No active V2 Portal permission-set assignment grants authority."));
    return success(Object.freeze({ kind: "portal", organizationId, customerId: portal.customerId, subjectId: identity.subjectId, capabilities }));
  }
}

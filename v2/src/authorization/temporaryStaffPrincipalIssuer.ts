import { failure, success, type ApplicationResult, V2ApplicationError } from "../errors/applicationError.js";
import { createHash } from "node:crypto";
import type { Principal, StaffPrincipal } from "./principals.js";
import type { AuthenticatedIdentity, PrincipalIssuer, PrincipalIssuanceContext } from "./principalIssuer.js";
import { resolveTemporaryLegacyStaffAuthority } from "./staffAuthorityCompatibility.js";

/** A server-side read model; global user roles and flags are intentionally absent. */
export type TrustedStaffMembership = Readonly<{
  userId: string;
  organizationId: string;
  role: string | null;
  active: boolean;
  organizationActive: boolean;
  /** Changes whenever current membership authority changes; it is observable, not a cache key. */
  authorityRevision: string;
}>;

export interface StaffMembershipAuthorityReader {
  findForStaffAuthority(userId: string, organizationId: string): Promise<TrustedStaffMembership | null>;
}

export type IssueStaffPrincipalInput = Readonly<{
  identity: AuthenticatedIdentity;
  /** Selection input only; never a role or capability claim. */
  requestedOrganizationId: string;
}>;

export interface StaffPrincipalIssuer {
  issueStaff(input: IssueStaffPrincipalInput): Promise<ApplicationResult<StaffPrincipal>>;
}

/**
 * The requested organization is selection input only. The membership reader
 * resolves it afresh and is the sole source of tenant authority.
 */
export class TemporaryStaffCompatibilityPrincipalIssuer implements PrincipalIssuer, StaffPrincipalIssuer {
  constructor(private readonly memberships: StaffMembershipAuthorityReader) {}

  async issue(identity: AuthenticatedIdentity, context?: PrincipalIssuanceContext): Promise<Principal> {
    if (!context?.organizationId) {
      throw new V2ApplicationError("VALIDATION_ERROR", "An organization is required to issue a Staff principal.");
    }
    const result = await this.issueStaff({ identity, requestedOrganizationId: context.organizationId });
    if (!result.ok) throw result.error;
    return result.value;
  }

  async issueStaff({ identity, requestedOrganizationId: organizationId }: IssueStaffPrincipalInput): Promise<ApplicationResult<StaffPrincipal>> {
    if (!identity.subjectId) return failure(new V2ApplicationError("FORBIDDEN", "Authentication is required."));
    if (identity.authenticationMethod !== "session") {
      return failure(new V2ApplicationError("FORBIDDEN", "This issuer accepts authenticated Staff sessions only."));
    }
    if (!organizationId) return failure(new V2ApplicationError("VALIDATION_ERROR", "An organization is required to issue a Staff principal."));

    // This lookup happens for every issuance. No session role/capability cache,
    // global user role, isAdmin, or platform flag can influence the result.
    const membership = await this.memberships.findForStaffAuthority(identity.subjectId, organizationId);
    if (!membership || membership.userId !== identity.subjectId || membership.organizationId !== organizationId) {
      return failure(new V2ApplicationError("NOT_FOUND", "Staff authority is unavailable for this organization."));
    }
    if (!membership.organizationActive) {
      return failure(new V2ApplicationError("FORBIDDEN", "This organization is not available."));
    }
    if (!membership.active) {
      return failure(new V2ApplicationError("FORBIDDEN", "Staff membership is not active."));
    }
    const authority = resolveTemporaryLegacyStaffAuthority(membership.role);
    if (!authority) {
      return failure(new V2ApplicationError("FORBIDDEN", "Staff membership role is not supported by temporary V2 authority."));
    }

    const capabilities = Object.freeze([...authority.capabilities]);
    const staffAuthority = Object.freeze({
      membershipId: `v1_user_organizations:sha256:${createHash("sha256").update(`${organizationId}\u0000${identity.subjectId}`).digest("hex")}`,
      role: authority.role,
      capabilities,
      source: authority.source,
      authorityRevision: membership.authorityRevision,
      replacementMilestone: authority.replacementMilestone,
    });
    return success(Object.freeze({
      kind: "staff",
      organizationId,
      userId: identity.subjectId,
      authority: staffAuthority,
    }));
  }
}

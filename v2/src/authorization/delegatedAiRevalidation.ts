import { V2ApplicationError } from "../errors/applicationError.js";
import type { AuthenticatedIdentity, PrincipalIssuer } from "./principalIssuer.js";
import type { DelegatedAiPrincipal, StaffPrincipal } from "./principals.js";

export type ApprovedAiDelegation = DelegatedAiPrincipal["delegation"];

/**
 * GO-time boundary: reconstruct delegated authority from a freshly issued
 * Staff principal. Plans retain their explicit narrow capability list and
 * never trust the Staff snapshot captured during planning.
 */
export async function revalidateDelegatedAiPrincipal(
  issuer: PrincipalIssuer,
  identity: AuthenticatedIdentity,
  approved: DelegatedAiPrincipal,
): Promise<DelegatedAiPrincipal> {
  if (identity.subjectId !== approved.staff.userId || approved.staff.organizationId !== approved.organizationId) {
    throw new V2ApplicationError("FORBIDDEN", "Delegated AI revalidation cannot substitute its verified Staff actor or organization.");
  }
  const issued = await issuer.issue(identity, { organizationId: approved.organizationId });
  if (issued.kind !== "staff" || issued.organizationId !== approved.organizationId || issued.userId !== approved.staff.userId) {
    throw new V2ApplicationError("FORBIDDEN", "Delegated AI requires freshly verified Staff authority.");
  }
  const staff: StaffPrincipal = issued;
  return Object.freeze({ kind: "delegated_ai", organizationId: approved.organizationId, staff, delegation: Object.freeze({ ...approved.delegation, revalidatedAt: new Date(), allowedCapabilities: Object.freeze([...approved.delegation.allowedCapabilities]) }) });
}

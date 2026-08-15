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
  organizationId: string,
  delegation: ApprovedAiDelegation,
): Promise<DelegatedAiPrincipal> {
  const issued = await issuer.issue(identity, { organizationId });
  if (issued.kind !== "staff" || issued.organizationId !== organizationId) {
    throw new V2ApplicationError("FORBIDDEN", "Delegated AI requires freshly verified Staff authority.");
  }
  const staff: StaffPrincipal = issued;
  return Object.freeze({ kind: "delegated_ai", organizationId, staff, delegation: Object.freeze({ ...delegation, allowedCapabilities: Object.freeze([...delegation.allowedCapabilities]) }) });
}

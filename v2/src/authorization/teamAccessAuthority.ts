import type { Principal, StaffPrincipal } from "./principals.js";

/** The canonical organization membership and platform-developer facts used
 * only for Team & Access administration. Route handlers do not compare role
 * labels themselves. */
export const teamAccessManagementAuthority = (input: Readonly<{ organizationRole: string; isPlatformDeveloper: boolean }>): boolean =>
  input.isPlatformDeveloper || input.organizationRole === "owner" || input.organizationRole === "admin";

/** Team & Access metadata is intentionally visible to every verified Staff
 * principal in its active organization. Portal principals never qualify. */
export const canReadTeamAccess = (principal: Principal): principal is StaffPrincipal => principal.kind === "staff";

/** Authorization mutations remain restricted to the canonical elevated
 * organization authorities, freshly projected into the Staff principal. */
export const canManageTeamAccess = (principal: Principal): principal is StaffPrincipal =>
  principal.kind === "staff" && principal.authority.teamAccessManagement === true;

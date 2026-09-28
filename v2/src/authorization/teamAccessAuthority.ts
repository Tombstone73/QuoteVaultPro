import type { Principal, StaffPrincipal } from "./principals.js";

export type TeamRoleDelegation = "owner" | "administrator" | "manager" | "platform_developer" | "none";

export const teamRoleDelegationAuthority = (input: Readonly<{ organizationRole: string; isPlatformDeveloper: boolean }>): TeamRoleDelegation => {
  if (input.isPlatformDeveloper) return "platform_developer";
  if (input.organizationRole === "owner") return "owner";
  if (input.organizationRole === "admin") return "administrator";
  if (input.organizationRole === "manager") return "manager";
  return "none";
};

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

/** Role definition and Staff-role assignment are narrower concepts than
 * broad Team & Access administration. Managers may perform these two actions
 * subject to the server-side capability delegation ceiling. */
export const canBuildTeamRoles = (principal: Principal): principal is StaffPrincipal =>
  principal.kind === "staff" && principal.authority.teamRoleDelegation !== undefined && principal.authority.teamRoleDelegation !== "none";

export const canAssignStaffRoles = canBuildTeamRoles;

export const hasUnlimitedTeamRoleDelegation = (principal: StaffPrincipal): boolean =>
  principal.authority.teamRoleDelegation === "owner" || principal.authority.teamRoleDelegation === "platform_developer";

export const canDelegateTeamCapability = (principal: StaffPrincipal, capability: string): boolean =>
  canBuildTeamRoles(principal) && (hasUnlimitedTeamRoleDelegation(principal) || principal.authority.capabilities.includes(capability as never));

export const delegableTeamCapabilities = <T extends string>(principal: StaffPrincipal, capabilities: readonly T[]): readonly T[] =>
  capabilities.filter((capability) => canDelegateTeamCapability(principal, capability));

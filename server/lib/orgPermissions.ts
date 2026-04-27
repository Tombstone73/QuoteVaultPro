/**
 * orgPermissions.ts
 *
 * Org-scoped invitation and role-assignment policy helpers.
 *
 * IMPORTANT: user_organizations.role is the authoritative org-scoped role.
 * users.role and users.is_admin are global identity fields only and must NOT
 * be used for org invite / role-assignment permission checks.
 *
 * Policy enforced in this pass (surgical fix; full RBAC is a future milestone):
 *   owner:   invite yes | assign owner, admin, manager, member
 *   admin:   invite yes | assign admin, manager, member
 *   manager: invite yes | assign manager, member
 *   member:  invite no  | assign none
 *   unknown: invite no  | assign none  ← fail-closed
 *
 * TODO (future RBAC): Replace with a richer permission model that supports
 * department-scoped managers and custom permission sets.
 */

export type OrgMemberRole = 'owner' | 'admin' | 'manager' | 'member';

/**
 * Returns true if the actor's org-scoped role may invite new users to the org.
 * Fails closed for unknown / empty roles.
 */
export function canInviteOrgUsers(actorRole: string): boolean {
  return actorRole === 'owner' || actorRole === 'admin' || actorRole === 'manager';
}

/**
 * Returns true if the actor's org-scoped role may assign `targetRole`
 * when inviting or updating a user.
 *
 * Scope matrix:
 *   owner   → owner, admin, manager, member
 *   admin   → admin, manager, member
 *   manager → manager, member
 *   other   → nothing (fail-closed)
 */
export function canAssignOrgRole(actorRole: string, targetRole: string): boolean {
  switch (actorRole) {
    case 'owner':
      return ['owner', 'admin', 'manager', 'member'].includes(targetRole);
    case 'admin':
      return ['admin', 'manager', 'member'].includes(targetRole);
    case 'manager':
      return ['manager', 'member'].includes(targetRole);
    default:
      // member and unknown roles cannot assign anything
      return false;
  }
}

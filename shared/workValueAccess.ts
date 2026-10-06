import { resolveOrganizationRoleAuthority } from "./organizationRoleAuthority";

/** Reuses the established finance.read grant; callers supply the active
 * organization role from a trusted tenant context. */
export function canReadWorkValue(role: unknown): boolean {
  return resolveOrganizationRoleAuthority(role).grants.includes("finance.read");
}

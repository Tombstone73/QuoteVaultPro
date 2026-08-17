export type ActiveOrganizationMembership = {
  id: string;
  isDefault?: boolean | null;
};

/**
 * Mirrors tenantContext's active-organization precedence for client-facing
 * membership data. Authority must always be derived from this membership.
 */
export function resolveActiveOrganization<T extends ActiveOrganizationMembership>(
  organizations: readonly T[] | null | undefined,
  lastActiveOrganizationId: string | null | undefined,
): T | null {
  const memberships = organizations ?? [];

  if (lastActiveOrganizationId) {
    const activeMembership = memberships.find((organization) => organization.id === lastActiveOrganizationId);
    if (activeMembership) return activeMembership;
  }

  const defaultMembership = memberships.find((organization) => organization.isDefault === true);
  if (defaultMembership) return defaultMembership;

  return memberships.length === 1 ? memberships[0] : null;
}

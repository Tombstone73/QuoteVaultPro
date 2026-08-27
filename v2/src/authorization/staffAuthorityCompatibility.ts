import type { Capability } from "./capabilities.js";

/**
 * TEMPORARY COMPATIBILITY INFRASTRUCTURE ONLY.
 *
 * This narrow map exists until M1.5 replaces it with organization-scoped,
 * configurable permission sets. Do not import it from domain/application/UI
 * code; TemporaryStaffCompatibilityPrincipalIssuer is its only runtime user.
 */
export const TEMPORARY_STAFF_AUTHORITY_SOURCE = "temporary_staff_membership_compatibility" as const;
export const TEMPORARY_STAFF_AUTHORITY_REPLACEMENT_MILESTONE = "M1.5 — Permission-Set Foundation" as const;

export const legacyMembershipRoles = ["owner", "admin", "manager", "member"] as const;
export type LegacyMembershipRole = (typeof legacyMembershipRoles)[number];

const stableCapabilities = (capabilities: readonly Capability[]): readonly Capability[] => Object.freeze([...new Set(capabilities)].sort());

const readAndPreview: readonly Capability[] = [
  "quote.view", "order.view", "customer.view", "product.view", "pricing.preview", "invoice.view",
];

const managerCommercial: readonly Capability[] = [
  ...readAndPreview,
  "customer.edit",
  "quote.create", "quote.edit", "quote.send", "quote.convert",
  "order.create", "order.edit",
  "invoice.editDraft",
];

const ownerAdminCommercial: readonly Capability[] = [
  ...managerCommercial,
  "order.cancel",
  "invoice.issue",
  "product.edit",
  // Artwork is an operational Owner/Admin workflow. Keep it explicitly
  // bounded here until organization-scoped permission sets replace this map.
  "artwork.view", "artwork.adopt", "artwork.assign",
];

/**
 * Explicit early-M1 ceiling. The current V1 membership enum has no employee
 * role; every unknown value fails closed rather than inheriting global role or
 * administrator flags. This deliberately grants no payment,
 * refund, production, routing, integration, or settings authority.
 */
const temporaryLegacyRoleCapabilityMap: Readonly<Record<LegacyMembershipRole, readonly Capability[]>> = Object.freeze({
  owner: stableCapabilities(ownerAdminCommercial),
  admin: stableCapabilities(ownerAdminCommercial),
  manager: stableCapabilities(managerCommercial),
  member: stableCapabilities(readAndPreview),
});

export type ResolvedTemporaryStaffAuthority = Readonly<{
  role: LegacyMembershipRole;
  capabilities: readonly Capability[];
  source: typeof TEMPORARY_STAFF_AUTHORITY_SOURCE;
  replacementMilestone: typeof TEMPORARY_STAFF_AUTHORITY_REPLACEMENT_MILESTONE;
}>;

export const resolveTemporaryLegacyStaffAuthority = (role: unknown): ResolvedTemporaryStaffAuthority | null => {
  if (typeof role !== "string" || !(legacyMembershipRoles as readonly string[]).includes(role)) return null;
  const legacyRole = role as LegacyMembershipRole;
  return {
    role: legacyRole,
    capabilities: temporaryLegacyRoleCapabilityMap[legacyRole],
    source: TEMPORARY_STAFF_AUTHORITY_SOURCE,
    replacementMilestone: TEMPORARY_STAFF_AUTHORITY_REPLACEMENT_MILESTONE,
  };
};

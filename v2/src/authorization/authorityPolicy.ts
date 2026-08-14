import type { Capability } from "./capabilities.js";
import type { Principal } from "./principals.js";

export type AuthorityResource = Readonly<{
  organizationId: string;
  customerId?: string | null;
}>;

export type AuthorizationRequest = Readonly<{
  capability: Capability;
  resource: AuthorityResource;
  now?: Date;
}>;

export type AuthorizationDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; reason: AuthorizationDenialReason }>;

export type AuthorizationDenialReason =
  | "ORGANIZATION_OUT_OF_SCOPE"
  | "CUSTOMER_OUT_OF_SCOPE"
  | "CAPABILITY_NOT_GRANTED"
  | "AI_DELEGATION_STALE"
  | "AI_DELEGATION_NOT_APPROVED";

/**
 * Pure policy over already-verified identity facts. It intentionally has no
 * persistence, session, route, or domain dependency.
 */
export class AuthorityPolicy {
  decide(principal: Principal, request: AuthorizationRequest): AuthorizationDecision {
    if (principal.organizationId !== request.resource.organizationId) {
      return { allowed: false, reason: "ORGANIZATION_OUT_OF_SCOPE" };
    }

    if (principal.kind === "portal" && principal.customerId !== request.resource.customerId) {
      return { allowed: false, reason: "CUSTOMER_OUT_OF_SCOPE" };
    }

    if (principal.kind === "delegated_ai") {
      const now = request.now ?? new Date();
      // A delegated identity may only narrow a staff authority in the same
      // organization; it cannot retarget a valid Staff identity cross-tenant.
      if (principal.staff.organizationId !== principal.organizationId) {
        return { allowed: false, reason: "ORGANIZATION_OUT_OF_SCOPE" };
      }
      if (
        principal.delegation.planApprovedAt > now ||
        principal.delegation.goApprovedAt > now ||
        principal.delegation.revalidatedAt > now
      ) {
        return { allowed: false, reason: "AI_DELEGATION_NOT_APPROVED" };
      }
      if (principal.delegation.expiresAt <= now) {
        return { allowed: false, reason: "AI_DELEGATION_STALE" };
      }
      if (!principal.delegation.allowedCapabilities.includes(request.capability)) {
        return { allowed: false, reason: "CAPABILITY_NOT_GRANTED" };
      }
      if (!principal.staff.authority.capabilities.includes(request.capability)) {
        return { allowed: false, reason: "CAPABILITY_NOT_GRANTED" };
      }
      return { allowed: true };
    }

    const capabilities =
      principal.kind === "staff" ? principal.authority.capabilities : principal.capabilities;
    return capabilities.includes(request.capability)
      ? { allowed: true }
      : { allowed: false, reason: "CAPABILITY_NOT_GRANTED" };
  }
}

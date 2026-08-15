import type { Capability } from "./capabilities.js";

export type PrincipalKind = "staff" | "delegated_ai" | "portal" | "service";

/** Organization-specific authority asserted by a verified membership adapter. */
export type StaffAuthority = Readonly<{
  membershipId: string;
  role: string;
  capabilities: readonly Capability[];
  /** Present only while M1.4 temporary membership compatibility is installed. */
  source?: "temporary_staff_membership_compatibility";
  authorityRevision?: string;
  replacementMilestone?: "M1.5 — Permission-Set Foundation";
}>;

export type StaffPrincipal = Readonly<{
  kind: "staff";
  organizationId: string;
  userId: string;
  authority: StaffAuthority;
}>;

export type DelegatedAiPrincipal = Readonly<{
  kind: "delegated_ai";
  organizationId: string;
  staff: StaffPrincipal;
  delegation: Readonly<{
    commandId: string;
    allowedCapabilities: readonly Capability[];
    planApprovedAt: Date;
    goApprovedAt: Date;
    revalidatedAt: Date;
    expiresAt: Date;
  }>;
}>;

export type PortalPrincipal = Readonly<{
  kind: "portal";
  organizationId: string;
  customerId: string;
  subjectId: string;
  capabilities: readonly Capability[];
}>;

export type ServicePrincipal = Readonly<{
  kind: "service";
  organizationId: string;
  clientId: string;
  capabilities: readonly Capability[];
}>;

export type Principal =
  | StaffPrincipal
  | DelegatedAiPrincipal
  | PortalPrincipal
  | ServicePrincipal;

export const principalSubject = (principal: Principal): string => {
  switch (principal.kind) {
    case "staff":
      return principal.userId;
    case "delegated_ai":
      return `${principal.staff.userId}:${principal.delegation.commandId}`;
    case "portal":
      return principal.subjectId;
    case "service":
      return principal.clientId;
  }
};

/** The real staff user is retained for attribution, never fabricated. */
export const staffActorId = (principal: Principal): string | undefined =>
  principal.kind === "staff"
    ? principal.userId
    : principal.kind === "delegated_ai"
      ? principal.staff.userId
      : undefined;

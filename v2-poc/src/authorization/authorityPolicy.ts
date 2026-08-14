import { V2PocError } from "../shared/errors";

export type Capability = "orders.create" | "quotes.convert" | "proof.respond" | "fulfillment.pickup" | "finance.record";
export type StaffPrincipal = { kind: "staff"; organizationId: string; actorId: string; capabilities: readonly Capability[] };
export type DelegatedAiPrincipal = { kind: "ai"; staff: StaffPrincipal; command: string; confirmed: boolean; fresh: boolean };
export type PortalPrincipal = { kind: "portal"; organizationId: string; customerId: string; portalSubjectId: string; capabilities: readonly Capability[] };
export type ServicePrincipal = { kind: "service"; organizationId: string; clientId: string; capabilities: readonly Capability[] };
export type Principal = StaffPrincipal | DelegatedAiPrincipal | PortalPrincipal | ServicePrincipal;
export type ResourceScope = { organizationId: string; customerId?: string | null };

export class AuthorityPolicy {
  authorize(principal: Principal, capability: Capability, resource: ResourceScope): void {
    const effective = principal.kind === "ai" ? principal.staff : principal;
    if (principal.kind === "ai" && (!principal.confirmed || !principal.fresh || principal.command !== capability)) throw new V2PocError("FORBIDDEN", "AI authority is stale, unconfirmed, or outside its approved command.");
    if (effective.organizationId !== resource.organizationId) throw new V2PocError("FORBIDDEN", "Resource is outside the principal organization.");
    if (!effective.capabilities.includes(capability)) throw new V2PocError("FORBIDDEN", "Principal lacks the required capability.");
    if (effective.kind === "portal" && resource.customerId !== effective.customerId) throw new V2PocError("FORBIDDEN", "Resource is outside the portal customer scope.");
  }
  actorId(principal: Principal): string | null { return principal.kind === "ai" ? principal.staff.actorId : principal.kind === "staff" ? principal.actorId : null; }
}

export const principalSubject = (principal: Principal): string => principal.kind === "staff" ? principal.actorId : principal.kind === "ai" ? `${principal.staff.actorId}:${principal.command}` : principal.kind === "portal" ? principal.portalSubjectId : principal.clientId;
export const staffActor = (principal: Principal): string | null => principal.kind === "staff" ? principal.actorId : principal.kind === "ai" ? principal.staff.actorId : null;

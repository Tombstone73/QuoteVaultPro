import type { V2UnitOfWork } from "../infrastructure/inMemoryV2Database";
import { V2PocError } from "../shared/errors";
import type { ActorOrganizationContext } from "../shared/model";

export async function resolveActorOrganizationContext(unitOfWork: V2UnitOfWork, actorId: string, organizationId: string): Promise<ActorOrganizationContext> {
  const membership = unitOfWork.state.memberships.find((entry) => entry.actorId === actorId && entry.organizationId === organizationId);
  if (!membership) throw new V2PocError("FORBIDDEN", "Actor is not a member of the requested organization.");
  const grants = new Set<"orders:create">();
  if (["owner", "admin", "manager", "employee"].includes(membership.role)) grants.add("orders:create");
  return { actorId, organizationId, role: membership.role, grants };
}

export function requireOrderCreate(context: ActorOrganizationContext): void {
  if (!context.grants.has("orders:create")) throw new V2PocError("FORBIDDEN", "Actor lacks the organization-scoped orders:create capability.");
}

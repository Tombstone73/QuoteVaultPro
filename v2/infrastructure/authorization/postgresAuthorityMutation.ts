import type { TransactionalClient } from "../persistence/types.js";
import type { StaffPrincipal, Principal } from "../../src/authorization/principals.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import { AuthorityPolicy } from "../../src/authorization/authorityPolicy.js";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets.js";
import { PostgresPermissionAuthorityReader } from "./postgresPermissionAuthorityRead.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";

/** Call immediately after BEGIN on the same client, before any dependent lock. */
export async function enterAuthorityMutation(client: TransactionalClient, organizationIds: readonly string[], exclusive = false): Promise<void> {
  await client.query("SELECT v2_authority_entry($1::varchar[],$2::boolean)", [[...new Set(organizationIds)].sort(), exclusive]);
}

export async function freshAuthorityActor(client: TransactionalClient, actor: StaffPrincipal, organizationId: string): Promise<StaffPrincipal> {
  if (actor.organizationId !== organizationId) throw new V2ApplicationError("WRONG_TENANT", "Team access is organization scoped.");
  const login = await client.query<{ ready: boolean }>("SELECT v2_staff_login_ready($1) ready", [actor.userId]);
  if (!login.rows[0]?.ready) throw new V2ApplicationError("FORBIDDEN", "Staff credentials are unavailable.");
  const issued = await new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(client)).issueStaff(
    { subjectId: actor.userId, authenticationMethod: "session", authenticatedAt: new Date() }, organizationId);
  if (!issued.ok) throw issued.error;
  return issued.value;
}

export function assertAuthorityReplay(request: Readonly<{principalKind:string;principalSubject:string;staffActorUserId?:string|null;status:string}>, actor: StaffPrincipal): void {
  if (request.principalKind !== "staff" || request.principalSubject !== actor.userId || request.staffActorUserId !== actor.userId)
    throw new V2ApplicationError("FORBIDDEN", "This authority request belongs to another actor.");
  if (request.status !== "succeeded") throw new V2ApplicationError("CONFLICT", "This authority request has no successful receipt. Reload before retrying.");
}

export async function assertStructuralFloor(client: TransactionalClient, organizationId: string): Promise<void> {
  const result = await client.query("SELECT user_id FROM v2_usable_structural_administrators($1) LIMIT 1", [organizationId]);
  if (!result.rowCount) throw new V2ApplicationError("CONFLICT", "The final usable Owner or Administrator cannot be removed, disabled, or weakened.");
}

export async function markAuthorityChanged(client: TransactionalClient, organizationId: string): Promise<void> {
  await client.query("SELECT v2_authority_changed($1)", [organizationId]);
}

export async function assertFreshAuthorityCapability(client: TransactionalClient, principal: Principal, organizationId: string, capability: Capability): Promise<void> {
  const fresh = principal.kind === "staff" ? await freshAuthorityActor(client,principal,organizationId)
    : principal.kind === "delegated_ai" ? {...principal,staff:await freshAuthorityActor(client,principal.staff,organizationId),delegation:{...principal.delegation,revalidatedAt:new Date()}}
    : principal;
  if(!new AuthorityPolicy().decide(fresh,{capability,resource:{organizationId}}).allowed) throw new V2ApplicationError("FORBIDDEN","Current authority cannot perform this operation.");
}

import { normalizeOrganizationRole, resolveOrganizationRoleAuthority } from "@shared/organizationRoleAuthority";

export type AssistantAuthorityStatus = "allowed" | "denied" | "unknown";
export type TrustedAssistantActorAuthorityInput = {
  actorUserId: string;
  organizationId: string;
  organizationRole: unknown;
  authenticationSource: "authenticated_request";
  tenantSource: "tenant_context";
};
export type AssistantActorAuthorityContext = {
  actorUserId: string;
  organizationId: string;
  organizationRole: string | null;
  grants: readonly string[];
  status: "resolved" | "unknown";
  authoritySourceTrace: readonly string[];
};
export type AssistantAuthorityOperation =
  | { kind: "command"; commandName: string; targetOrganizationId?: string }
  | { kind: "read_tool"; toolName: string; targetOrganizationId?: string }
  | { kind: "capability"; capabilityId: string; targetOrganizationId?: string };
export type AssistantAuthorityDecision = {
  status: AssistantAuthorityStatus;
  requiredPermission: string | null;
  matchedGrant: string | null;
  reason: string;
  authoritySourceTrace: readonly string[];
  metadataSource: string;
};
export type AssistantAuthorityComparison = {
  surface: "chat" | "execution" | "command_metadata";
  result: "exact_match" | "current_grants_more" | "current_grants_less" | "unknown";
  currentOnly: readonly string[];
  resolverOnly: readonly string[];
};

function normalizeGrants(grants: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(grants.map((grant) => grant.trim().toLowerCase()).filter(Boolean))].sort());
}

/** Uses only tenantContext's persisted organization role. Unknown roles stay
 * unresolved rather than becoming an AI-specific or platform-admin role. */
export function resolveAssistantActorAuthority(input: TrustedAssistantActorAuthorityInput): AssistantActorAuthorityContext {
  const role = normalizeOrganizationRole(input.organizationRole);
  if (!input.actorUserId || !input.organizationId || !role) {
    return { actorUserId: input.actorUserId, organizationId: input.organizationId, organizationRole: role, grants: [], status: "unknown", authoritySourceTrace: [input.authenticationSource, input.tenantSource, "missing_trusted_actor_tenant_or_role"] };
  }
  const policy = resolveOrganizationRoleAuthority(role);
  return { actorUserId: input.actorUserId, organizationId: input.organizationId, organizationRole: policy.role, grants: normalizeGrants(policy.grants), status: policy.status, authoritySourceTrace: [input.authenticationSource, input.tenantSource, ...policy.sourceTrace] };
}

export function compareAssistantAuthority(surface: AssistantAuthorityComparison["surface"], currentGrants: readonly string[], authority: AssistantActorAuthorityContext): AssistantAuthorityComparison {
  if (authority.status !== "resolved") return { surface, result: "unknown", currentOnly: normalizeGrants(currentGrants), resolverOnly: [] };
  const current = normalizeGrants(currentGrants); const resolver = normalizeGrants(authority.grants);
  const currentOnly = current.filter((grant) => !resolver.includes(grant)); const resolverOnly = resolver.filter((grant) => !current.includes(grant));
  return { surface, result: !currentOnly.length && !resolverOnly.length ? "exact_match" : currentOnly.length ? "current_grants_more" : "current_grants_less", currentOnly, resolverOnly };
}

export function compareAssistantCommandMetadata(metadata: { requiredCapability: string; allowedRoles: readonly string[] }, authority: AssistantActorAuthorityContext): AssistantAuthorityComparison {
  const role = authority.organizationRole;
  if (authority.status !== "resolved" || !role) return { surface: "command_metadata", result: "unknown", currentOnly: [], resolverOnly: [] };
  const allowedRoles = metadata.allowedRoles.map(normalizeOrganizationRole).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
  const roleAllowsCommand = allowedRoles.includes(role);
  const resolverAllowsCommand = authority.grants.includes(metadata.requiredCapability);
  if (roleAllowsCommand === resolverAllowsCommand) return { surface: "command_metadata", result: "exact_match", currentOnly: [], resolverOnly: [] };
  return roleAllowsCommand ? { surface: "command_metadata", result: "current_grants_more", currentOnly: [metadata.requiredCapability], resolverOnly: [] } : { surface: "command_metadata", result: "current_grants_less", currentOnly: [], resolverOnly: [metadata.requiredCapability] };
}

/** Registry composition has no request actor. Compare each declared command
 * role against the same trusted-role normalization and emit one safe summary. */
export function emitAssistantCommandRegistryShadowDiagnostic(commands: readonly { name: string; requiredCapability: string; allowedRoles: readonly string[] }[]): void {
  if (process.env.NODE_ENV === "production") return;
  const mismatches = commands.flatMap((command) => command.allowedRoles.map(normalizeOrganizationRole).flatMap((role) => {
    if (!role) return [`${command.name}:unknown_role`];
    const authority = resolveAssistantActorAuthority({ actorUserId: "diagnostic_actor", organizationId: "diagnostic_tenant", organizationRole: role, authenticationSource: "authenticated_request", tenantSource: "tenant_context" });
    const comparison = compareAssistantCommandMetadata(command, authority);
    return comparison.result === "exact_match" ? [] : [`${command.name}:${role}`];
  }));
  console.info("[assistant_authority_shadow]", { surface: "command_metadata", comparedCommandCount: commands.length, mismatchedCommandRolePairCount: mismatches.length, mismatchedCommandRolePairs: mismatches });
}

/** Development/test only. It deliberately omits user IDs, tenant IDs, prompts, and tokens. */
export function emitAssistantAuthorityShadowDiagnostic(comparison: AssistantAuthorityComparison): void {
  if (process.env.NODE_ENV === "production") return;
  console.info("[assistant_authority_shadow]", { surface: comparison.surface, result: comparison.result, currentOnly: comparison.currentOnly, resolverOnly: comparison.resolverOnly });
}

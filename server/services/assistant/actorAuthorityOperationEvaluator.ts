import { getCanonicalCapability, getCanonicalCapabilityForCommand } from "./canonicalCapabilityRegistry";
import { assistantToolRegistry } from "./toolRegistry";
import type { AssistantActorAuthorityContext, AssistantAuthorityDecision, AssistantAuthorityOperation } from "./actorAuthorityResolver";

function requiredPermission(operation: AssistantAuthorityOperation): { permission: string | null; source: string } {
  if (operation.kind === "read_tool") {
    const tool = assistantToolRegistry.get(operation.toolName as never);
    if (!tool) return { permission: null, source: "assistantToolRegistry:unknown_tool" };
    if (tool.requiredPermission === "internal_staff") return { permission: "assistant.internal_staff", source: "assistantToolRegistry" };
    if (tool.requiredPermission === "catalog_read") return { permission: "catalog.read", source: "assistantToolRegistry" };
    if (tool.requiredPermission === "finance_read") return { permission: "finance.read", source: "assistantToolRegistry" };
    return { permission: null, source: "assistantToolRegistry:unknown_policy" };
  }
  const capability = operation.kind === "command"
    ? getCanonicalCapabilityForCommand(operation.commandName)
    : getCanonicalCapability(operation.capabilityId);
  return capability?.requiredGrant
    ? { permission: capability.requiredGrant, source: "canonicalCapabilityRegistry" }
    : { permission: null, source: "canonicalCapabilityRegistry:unknown_or_missing_permission_metadata" };
}

/** Metadata-aware evaluator is intentionally not imported by request routes.
 * It is used by diagnostics, developer reports, and focused tests only. */
export function evaluateAssistantOperationAuthority(authority: AssistantActorAuthorityContext, operation: AssistantAuthorityOperation): AssistantAuthorityDecision {
  const targetOrganizationId = operation.targetOrganizationId;
  if (targetOrganizationId && targetOrganizationId !== authority.organizationId) return { status: "denied", requiredPermission: null, matchedGrant: null, reason: "tenant_mismatch", authoritySourceTrace: authority.authoritySourceTrace, metadataSource: "trusted_tenant_context" };
  const requirement = requiredPermission(operation);
  if (authority.status !== "resolved" || !requirement.permission) return { status: "unknown", requiredPermission: requirement.permission, matchedGrant: null, reason: authority.status !== "resolved" ? "authority_unresolved" : "operation_permission_metadata_unknown", authoritySourceTrace: authority.authoritySourceTrace, metadataSource: requirement.source };
  const matchedGrant = authority.grants.find((grant) => grant === requirement.permission) ?? null;
  return matchedGrant
    ? { status: "allowed", requiredPermission: requirement.permission, matchedGrant, reason: "trusted_role_grant_matches_requirement", authoritySourceTrace: authority.authoritySourceTrace, metadataSource: requirement.source }
    : { status: "denied", requiredPermission: requirement.permission, matchedGrant: null, reason: "trusted_role_grant_missing", authoritySourceTrace: authority.authoritySourceTrace, metadataSource: requirement.source };
}

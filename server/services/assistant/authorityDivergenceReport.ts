import { assistantProductionCommandAllowlist } from "./execution/commandRegistry";
import { capabilityInventory, commandPermissionMetadataGaps } from "./capabilityInventory";
import { legacyChatPermissionsForOrganizationRole, legacyExecutionSyntheticPermissionsForOrganizationRole } from "./actorAuthorityShadowAdapters";

function commandPermission(name: string): string | null {
  return capabilityInventory.find((item) => item.commandName === name)?.permissionRequirement ?? null;
}
function commandsOutside(grants: readonly string[]): string[] {
  const set = new Set(grants);
  return assistantProductionCommandAllowlist.filter((name) => { const permission = commandPermission(name); return permission !== "unknown" && permission !== null && !set.has(permission); });
}

export function renderAssistantAuthorityDivergenceMarkdown(): string {
  const memberChat = legacyChatPermissionsForOrganizationRole("member");
  const memberExecution = legacyExecutionSyntheticPermissionsForOrganizationRole("member");
  const adminChat = legacyChatPermissionsForOrganizationRole("admin");
  const adminExecution = legacyExecutionSyntheticPermissionsForOrganizationRole("admin");
  const memberBroader = memberExecution.filter((grant) => !memberChat.includes(grant));
  const adminBroader = adminExecution.filter((grant) => !adminChat.includes(grant));
  const unknownCommands = assistantProductionCommandAllowlist.filter((name) => commandPermission(name) === "unknown");
  return [
    "# AI Operator authority divergence (Phase 2A)", "",
    "Generated from the Phase 1 inventory and exact extractions of the current chat and execution route grant maps. This is developer-only shadow evidence, not runtime enforcement.", "",
    "## Trusted authority sources", "",
    "- Authentication: authenticated request identity (`claims.sub` or `id`).",
    "- Tenant and organization role: `tenantContext`, backed by the tenant membership record.",
    "- Current role-to-grant mapping: chat `buildActor`; Phase 2A wraps this as a legacy adapter only.",
    "- Execution scope is synthetic and is explicitly not accepted as a resolver authority source.", "",
    "## Known grant divergence", "",
    `- Member chat grants: ${memberChat.length}; member execution synthetic grants: ${memberExecution.length}; execution-only: ${memberBroader.length}.`,
    `- Admin chat grants: ${adminChat.length}; admin execution synthetic grants: ${adminExecution.length}; execution-only: ${adminBroader.length}.`,
    `- Commands with known permission metadata outside member chat grants: ${commandsOutside(memberChat).length}.`,
    `- Commands with known permission metadata outside admin chat grants: ${commandsOutside(adminChat).length}.`, "",
    "## Execution-only permissions for a member", "",
    ...memberBroader.map((permission) => `- \`${permission}\``), "",
    "## Unresolvable command permission metadata", "",
    ...unknownCommands.map((name) => `- \`${name}\` (missing from descriptive command-permission mirror)`), "",
    "## Known descriptive mirror gaps", "",
    ...commandPermissionMetadataGaps.map((name) => `- \`${name}\``), "",
    "## Deliberate Phase 2B questions", "",
    "- `super_admin` is not a tenant role mapped by chat authority and resolves UNKNOWN.",
    "- Command `allowedRoles` is metadata, not the current execution gate; compare it before cutover.",
    "- Route families use non-uniform authorization middleware, so normal application authority remains partly unproven.", "",
  ].join("\n");
}

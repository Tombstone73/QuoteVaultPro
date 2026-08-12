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
    "# AI Operator authority convergence (Phase 2B)", "",
    "Generated from the Phase 1 inventory, authoritative command metadata, and retained legacy grant-map extractions. This is developer-only cutover evidence; runtime authority now uses the shared tenant-role policy.", "",
    "## Trusted authority sources", "",
    "- Authentication: authenticated request identity (`claims.sub` or `id`).",
    "- Tenant and organization role: `tenantContext`, backed by the tenant membership record.",
    "- Runtime role-to-grant mapping: `shared/organizationRoleAuthority.ts` through `AssistantActorAuthorityResolver`.",
    "- Legacy chat/execution maps remain diagnostic-only and cannot grant authority.", "",
    "## Known grant divergence", "",
    `- Member chat grants: ${memberChat.length}; member execution synthetic grants: ${memberExecution.length}; execution-only: ${memberBroader.length}.`,
    `- Admin chat grants: ${adminChat.length}; admin execution synthetic grants: ${adminExecution.length}; execution-only: ${adminBroader.length}.`,
    `- Commands with known permission metadata outside member chat grants: ${commandsOutside(memberChat).length}.`,
    `- Commands with known permission metadata outside admin chat grants: ${commandsOutside(adminChat).length}.`, "",
    "## Execution-only permissions for a member", "",
    ...memberBroader.map((permission) => `- \`${permission}\``), "",
    "## Command metadata resolution", "",
    ...(unknownCommands.length ? unknownCommands.map((name) => `- \`${name}\` remains unresolved.`) : ["All production command permission mappings are source-backed by command definitions."]), "",
    "## Descriptive mirror gaps", "",
    ...(commandPermissionMetadataGaps.length ? commandPermissionMetadataGaps.map((name) => `- \`${name}\``) : ["None."]), "",
    "## Remaining authority questions", "",
    "- `super_admin` is not a tenant role mapped by the shared policy and resolves UNKNOWN.",
    "- Command `allowedRoles` and `requiredCapability` are both runtime execution gates.",
    "- Route families use non-uniform authorization middleware, so normal application authority remains partly unproven.", "",
  ].join("\n");
}

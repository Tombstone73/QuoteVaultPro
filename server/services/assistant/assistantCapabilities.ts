import { DrizzleAiFoundationRepository, type AiFoundationRepository } from "../../storage/aiFoundation.repo";
import type { AssistantCapabilityResolver } from "./assistantService";
import { aiProviderResolver } from "../ai/aiProviderResolver";
import { resolveAiProviderCapabilities } from "../ai/providers/providerCapabilities";
import { assistantProductionCommandAllowlist } from "./execution/commandRegistry";
import { isPublicWebResearchConfigured } from "./publicWebResearch";

/**
 * Compatibility exports for existing AssistantService consumers. They are
 * projections of canonical metadata, never independent capability, authority,
 * or AI-eligibility policy.
 */
export type AssistantCapabilityProductionCommand = (typeof assistantProductionCommandAllowlist)[number];

export type AssistantCapabilityProjection = {
  productionCommands: readonly AssistantCapabilityProductionCommand[];
  commandPermissions: Readonly<Record<AssistantCapabilityProductionCommand, string>>;
  readTools: readonly string[];
};

/** Lazy so a consumer that only needs organization/provider configuration does
 * not initialize the read-tool implementation graph. The loaded values remain
 * registry projections and are revalidated by the registry itself. */
export async function getAssistantCapabilityProjection(): Promise<AssistantCapabilityProjection> {
  const { canonicalCapabilityRegistry, getCanonicalCapabilityForCommand } = await import("./canonicalCapabilityRegistry");
  const commandPermissions = Object.fromEntries(assistantProductionCommandAllowlist.map((command) => {
    const capability = getCanonicalCapabilityForCommand(command);
    if (!capability?.requiredGrant || capability.aiEligibility !== "eligible") throw new Error(`Canonical command capability missing reviewed eligibility metadata: ${command}`);
    return [command, capability.requiredGrant];
  })) as Record<AssistantCapabilityProductionCommand, string>;
  return {
    productionCommands: assistantProductionCommandAllowlist,
    commandPermissions: Object.freeze(commandPermissions),
    readTools: Object.freeze(canonicalCapabilityRegistry.filter((capability) => capability.source === "read_tool" && capability.aiEligibility === "eligible" && capability.sourceId).map((capability) => capability.sourceId!)),
  };
}

/**
 * The organization switch is the master kill switch. Stage 2 additionally
 * checks the dedicated assistant feature and only advertises business tools
 * when an OpenAI-compatible provider can be resolved server-side.
 */
export class OrganizationAssistantCapabilityResolver implements AssistantCapabilityResolver {
  constructor(private readonly aiSettings: AiFoundationRepository = new DrizzleAiFoundationRepository()) {}

  async getCapabilities(organizationId: string) {
    const settings = await this.aiSettings.getSettings(organizationId);
    const enabled = Boolean(settings?.isEnabled && settings?.assistantEnabled);
    if (!enabled) {
      return { enabled: false, toolsEnabled: false, providerConfigured: false, externalResearchEnabled: false, unavailableReason: "The assistant is disabled for this organization." };
    }
    try {
      const provider = await aiProviderResolver.resolveProvider({ orgId: organizationId, feature: "assistant" });
      const toolsEnabled = Boolean(provider.enabled && provider.endpoint && provider.apiKey && provider.model
        && (provider.provider === "openai" || provider.provider === "openai_compatible"));
      const externalResearchEnabled = toolsEnabled && (
        resolveAiProviderCapabilities(provider).nativeWebSearch || isPublicWebResearchConfigured()
      );
      return {
        enabled: true,
        toolsEnabled,
        providerConfigured: toolsEnabled,
        externalResearchEnabled,
        unavailableReason: toolsEnabled ? null : "Business questions are unavailable until a compatible AI provider is configured.",
      };
    } catch {
      return { enabled: true, toolsEnabled: false, providerConfigured: false, externalResearchEnabled: false, unavailableReason: "Business questions are unavailable until AI configuration is complete." };
    }
  }
}

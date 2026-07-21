import { DrizzleAiFoundationRepository, type AiFoundationRepository } from "../../storage/aiFoundation.repo";
import type { AssistantCapabilityResolver } from "./assistantService";
import { aiProviderResolver } from "../ai/aiProviderResolver";

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
      return { enabled: false, toolsEnabled: false, unavailableReason: "The assistant is disabled for this organization." };
    }
    try {
      const provider = await aiProviderResolver.resolveProvider({ orgId: organizationId, feature: "assistant" });
      const toolsEnabled = Boolean(provider.enabled && provider.endpoint && provider.apiKey && provider.model
        && (provider.provider === "openai" || provider.provider === "openai_compatible"));
      return {
        enabled: true,
        toolsEnabled,
        unavailableReason: toolsEnabled ? null : "Business questions are unavailable until a compatible AI provider is configured.",
      };
    } catch {
      return { enabled: true, toolsEnabled: false, unavailableReason: "Business questions are unavailable until AI configuration is complete." };
    }
  }
}

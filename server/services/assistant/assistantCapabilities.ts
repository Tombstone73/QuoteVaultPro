import { DrizzleAiFoundationRepository, type AiFoundationRepository } from "../../storage/aiFoundation.repo";
import type { AssistantCapabilityResolver } from "./assistantService";
import { aiProviderResolver } from "../ai/aiProviderResolver";
import { assistantProductionCommandAllowlist } from "./execution/commandRegistry";

/**
 * These are intentionally an informational mirror of the reviewed production
 * command policy, not a registry or an execution path. Keeping the list here
 * means the assistant can explain its actual supported actions without
 * exposing a dynamic command-registration surface to a request or model.
 */
export const assistantCapabilityProductionCommands = assistantProductionCommandAllowlist;

export const assistantCapabilityReadTools = [
  "search.global",
  "customers.get_summary",
  "orders.get_summary",
  "products.get_summary",
  "reports.operational_summary",
  "navigation.get_current_context",
] as const;

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
      return { enabled: false, toolsEnabled: false, providerConfigured: false, unavailableReason: "The assistant is disabled for this organization." };
    }
    try {
      const provider = await aiProviderResolver.resolveProvider({ orgId: organizationId, feature: "assistant" });
      const toolsEnabled = Boolean(provider.enabled && provider.endpoint && provider.apiKey && provider.model
        && (provider.provider === "openai" || provider.provider === "openai_compatible"));
      return {
        enabled: true,
        toolsEnabled,
        providerConfigured: toolsEnabled,
        unavailableReason: toolsEnabled ? null : "Business questions are unavailable until a compatible AI provider is configured.",
      };
    } catch {
      return { enabled: true, toolsEnabled: false, providerConfigured: false, unavailableReason: "Business questions are unavailable until AI configuration is complete." };
    }
  }
}

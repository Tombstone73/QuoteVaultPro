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

/** Capability reporting deliberately mirrors the command registry allowlist,
 * but permissions and presentation stay explicit per reviewed command. This
 * lets a later composition enable a reviewed command without a fall-through
 * permission or a misleading generic action claim. */
export const assistantCapabilityCommandPermissions = {
  "quotes.add_internal_note": "assistant.quotes.add_internal_note",
  "quotes.create_draft": "assistant.quotes.create_draft",
  "quotes.update_draft": "assistant.quotes.update_draft",
  "orders.create": "assistant.orders.create",
  "orders.update_editable": "assistant.orders.update_editable",
  "quotes.convert_to_order": "assistant.quotes.convert_to_order",
  "products.create_inactive_draft": "assistant.products.create_inactive_draft",
  "products.update_inactive_draft": "assistant.products.update_inactive_draft",
} as const;

export const assistantCapabilityCommandDescriptions = {
  "quotes.add_internal_note": "add an internal quote note after your confirmation",
  "quotes.create_draft": "create one draft quote after your confirmation",
  "quotes.update_draft": "update one editable draft quote after your confirmation",
  "orders.create": "create one order with production deferred after your confirmation",
  "orders.update_editable": "update one editable order after your confirmation",
  "quotes.convert_to_order": "convert one quote to an order with production deferred after your confirmation",
  "products.create_inactive_draft": "help create an inactive product draft after your confirmation",
  "products.update_inactive_draft": "update an inactive product draft after your confirmation",
} as const;

export type AssistantCapabilityProductionCommand = keyof typeof assistantCapabilityCommandPermissions;

export function isAssistantCapabilityProductionCommand(value: string): value is AssistantCapabilityProductionCommand {
  return Object.prototype.hasOwnProperty.call(assistantCapabilityCommandPermissions, value);
}

export const assistantCapabilityReadTools = [
  "search.global",
  "customers.get_summary",
  "orders.get_summary",
  "products.get_summary",
  "reports.operational_summary",
  "navigation.get_current_context",
  "production.get_queue_summary",
  "operations.get_attention_summary",
  "orders.get_due_summary",
  "analytics.resolve_customer",
  "analytics.customer_product_sales",
  "analytics.customer_uninvoiced_orders",
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

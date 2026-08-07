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
  "customers.create": "assistant.customers.create",
  "customers.update_profile": "assistant.customers.update_profile",
  "customers.update_commercial_terms": "assistant.customers.update_commercial_terms",
  "contacts.create": "assistant.contacts.create",
  "contacts.update": "assistant.contacts.update",
  "production.intake_line_items": "assistant.production.intake_line_items",
  "production.send_to_prepress": "assistant.production.send_to_prepress",
  "production.update_job_status": "assistant.production.update_job_status",
  "production.add_job_note": "assistant.production.add_job_note",
  "fulfillment.create_shipment": "assistant.fulfillment.create_shipment",
  "fulfillment.update_shipment_details": "assistant.fulfillment.update_shipment_details",
  "fulfillment.mark_shipped": "assistant.fulfillment.mark_shipped",
  "fulfillment.create_pickup_ticket": "assistant.fulfillment.create_pickup_ticket",
  "fulfillment.add_note": "assistant.fulfillment.add_note",
  "billing.create_invoice": "assistant.billing.create_invoice",
  "billing.update_invoice_draft": "assistant.billing.update_invoice_draft",
  "billing.send_invoice": "assistant.billing.send_invoice",
  "billing.add_invoice_note": "assistant.billing.add_invoice_note",
  "payments.record_manual_payment": "assistant.payments.record_manual_payment",
  "payments.add_payment_note": "assistant.payments.add_payment_note",
  "products.create_inactive_draft": "assistant.products.create_inactive_draft",
  "products.update_inactive_draft": "assistant.products.update_inactive_draft",
  "products.update_inactive_draft_batch": "assistant.products.update_inactive_draft_batch",
} as const;

export const assistantCapabilityCommandDescriptions = {
  "quotes.add_internal_note": "add an internal quote note after your confirmation",
  "quotes.create_draft": "create one draft quote after your confirmation",
  "quotes.update_draft": "update one editable draft quote after your confirmation",
  "orders.create": "create one order with production deferred after your confirmation",
  "orders.update_editable": "update one editable order after your confirmation",
  "quotes.convert_to_order": "convert one quote to an order with production deferred after your confirmation",
  "customers.create": "create one customer after your confirmation",
  "customers.update_profile": "update one customer profile after your confirmation",
  "customers.update_commercial_terms": "update one customer’s commercial terms after your confirmation",
  "contacts.create": "create one customer contact after your confirmation",
  "contacts.update": "update one customer contact after your confirmation",
  "production.intake_line_items": "route selected line items to production after your confirmation",
  "production.send_to_prepress": "send one selected line item to Prepress after your confirmation",
  "production.update_job_status": "start one queued production job after your confirmation",
  "production.add_job_note": "add one internal production note after your confirmation",
  "fulfillment.create_shipment": "create one eligible draft shipment after your confirmation",
  "fulfillment.update_shipment_details": "update safe draft shipment details after your confirmation",
  "fulfillment.mark_shipped": "mark one eligible shipment shipped after your confirmation",
  "fulfillment.create_pickup_ticket": "create or reuse one eligible pickup ticket after your confirmation",
  "fulfillment.add_note": "add one internal fulfillment note after your confirmation",
  "billing.create_invoice": "create an eligible invoice after your confirmation",
  "billing.update_invoice_draft": "update safe draft invoice details after your confirmation",
  "billing.send_invoice": "mark an eligible invoice sent after your confirmation",
  "billing.add_invoice_note": "add one internal invoice note after your confirmation",
  "payments.record_manual_payment": "record one internal manual payment after your confirmation",
  "payments.add_payment_note": "add one internal payment note after your confirmation",
  "products.create_inactive_draft": "help create an inactive product draft after your confirmation",
  "products.update_inactive_draft": "update an inactive product draft after your confirmation",
  "products.update_inactive_draft_batch": "update a bounded set of inactive product drafts after your confirmation",
} as const;

export type AssistantCapabilityProductionCommand = keyof typeof assistantCapabilityCommandPermissions;

export function isAssistantCapabilityProductionCommand(value: string): value is AssistantCapabilityProductionCommand {
  return Object.prototype.hasOwnProperty.call(assistantCapabilityCommandPermissions, value);
}

export const assistantCapabilityReadTools = [
  "search.global",
  "quotes.search",
  "customers.get_summary",
  "orders.get_summary",
  "products.get_summary",
  "reports.operational_summary",
  "navigation.get_current_context",
  "production.get_queue_summary",
  "operations.get_attention_summary",
  "orders.get_due_summary",
  "production.get_completed_jobs",
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

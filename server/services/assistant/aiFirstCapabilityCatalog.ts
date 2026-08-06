import { z } from "zod";
import { assistantProductionCommandAllowlist } from "./execution/commandRegistry";
import { assistantToolNameValues } from "@shared/assistantContracts";
import {
  assistantIntentCapabilityIdValues,
  assistantIntentDomainValues,
  assistantIntentModeValues,
  assistantIntentOperationValues,
  type AssistantIntentCapabilityId,
} from "./aiFirstIntentPlannerContract";

export const assistantCapabilityInputContractValues = ["original_message", "trusted_context", "structured_action"] as const;
export const assistantCapabilityContextRequirementValues = ["none", "current_entity", "active_session"] as const;

export const assistantCapabilityCatalogItemSchema = z.object({
  id: z.enum(assistantIntentCapabilityIdValues),
  domain: z.enum(assistantIntentDomainValues),
  mode: z.enum(assistantIntentModeValues),
  operations: z.array(z.enum(assistantIntentOperationValues)).min(1),
  requiredPermissions: z.array(z.string().trim().min(1).max(160)),
  requiredContext: z.enum(assistantCapabilityContextRequirementValues),
  inputContract: z.enum(assistantCapabilityInputContractValues),
  confirmationRequired: z.boolean(),
  specialistCompiler: z.boolean(),
  legacyCompatibility: z.boolean(),
  readToolNames: z.array(z.enum(assistantToolNameValues)),
  commandNames: z.array(z.enum(assistantProductionCommandAllowlist)),
}).strict();
export type AssistantCapabilityCatalogItem = z.infer<typeof assistantCapabilityCatalogItemSchema>;

/**
 * The planner-visible capability inventory. It deliberately names server
 * capabilities instead of provider tools; dispatch independently verifies the
 * selected entry against its registered read tool or confirmation-bound command.
 */
export const assistantCapabilityCatalog = [
  { id: "system_guide", domain: "system", mode: "read", operations: ["explain"], requiredPermissions: ["internal_staff"], requiredContext: "none", inputContract: "original_message", confirmationRequired: false, specialistCompiler: false, legacyCompatibility: false, readToolNames: [], commandNames: [] },
  { id: "search_customers", domain: "customers", mode: "read", operations: ["lookup"], requiredPermissions: ["internal_staff"], requiredContext: "none", inputContract: "original_message", confirmationRequired: false, specialistCompiler: false, legacyCompatibility: false, readToolNames: ["search.global", "customers.get_summary"], commandNames: [] },
  { id: "search_products", domain: "products", mode: "read", operations: ["lookup", "explain"], requiredPermissions: ["catalog_read"], requiredContext: "none", inputContract: "original_message", confirmationRequired: false, specialistCompiler: false, legacyCompatibility: false, readToolNames: ["search.global", "products.get_summary"], commandNames: [] },
  { id: "search_orders", domain: "orders", mode: "read", operations: ["lookup", "explain"], requiredPermissions: ["internal_staff"], requiredContext: "none", inputContract: "original_message", confirmationRequired: false, specialistCompiler: false, legacyCompatibility: false, readToolNames: ["search.global", "orders.get_summary", "orders.get_due_summary"], commandNames: [] },
  { id: "operational_summary", domain: "reporting", mode: "read", operations: ["report"], requiredPermissions: ["internal_staff"], requiredContext: "none", inputContract: "original_message", confirmationRequired: false, specialistCompiler: false, legacyCompatibility: false, readToolNames: ["reports.operational_summary", "production.get_queue_summary", "operations.get_attention_summary", "production.get_completed_jobs"], commandNames: [] },
  { id: "legacy_read_tooling", domain: "reporting", mode: "read", operations: ["lookup", "report", "explain"], requiredPermissions: ["internal_staff"], requiredContext: "none", inputContract: "original_message", confirmationRequired: false, specialistCompiler: false, legacyCompatibility: true, readToolNames: ["navigation.get_current_context", "analytics.resolve_customer", "analytics.customer_product_sales", "analytics.customer_uninvoiced_orders"], commandNames: [] },
  { id: "canonical_product_intent_compiler", domain: "products", mode: "mutation", operations: ["create", "continue_session", "correct", "select_candidate", "accept_recommendation", "request_confirmation", "execute_go"], requiredPermissions: ["assistant.products.create_inactive_draft"], requiredContext: "none", inputContract: "original_message", confirmationRequired: true, specialistCompiler: true, legacyCompatibility: false, readToolNames: [], commandNames: ["products.create_from_canonical_intent"] },
  { id: "products_workflow", domain: "products", mode: "mutation", operations: ["create", "update", "request_confirmation", "execute_go"], requiredPermissions: ["assistant.products.update_inactive_draft"], requiredContext: "none", inputContract: "original_message", confirmationRequired: true, specialistCompiler: false, legacyCompatibility: false, readToolNames: [], commandNames: ["products.create_inactive_draft", "products.create_inactive_draft_batch", "products.update_inactive_draft_batch", "products.adjust_pricing", "products.rollback_pricing_change_set", "products.create_configurable_draft"] },
  { id: "clone_product", domain: "products", mode: "mutation", operations: ["create", "request_confirmation", "execute_go"], requiredPermissions: ["assistant.products.create_inactive_draft"], requiredContext: "current_entity", inputContract: "original_message", confirmationRequired: true, specialistCompiler: false, legacyCompatibility: false, readToolNames: [], commandNames: ["products.clone_to_inactive_draft"] },
  { id: "update_inactive_product", domain: "products", mode: "mutation", operations: ["update", "request_confirmation", "execute_go"], requiredPermissions: ["assistant.products.update_inactive_draft"], requiredContext: "current_entity", inputContract: "original_message", confirmationRequired: true, specialistCompiler: false, legacyCompatibility: false, readToolNames: [], commandNames: ["products.update_inactive_draft"] },
  { id: "replace_product_matrix", domain: "products", mode: "mutation", operations: ["update", "request_confirmation", "execute_go"], requiredPermissions: ["assistant.products.update_inactive_draft"], requiredContext: "current_entity", inputContract: "original_message", confirmationRequired: true, specialistCompiler: false, legacyCompatibility: false, readToolNames: [], commandNames: ["products.replace_inactive_matrix"] },
  { id: "replace_product_tiers", domain: "products", mode: "mutation", operations: ["update", "request_confirmation", "execute_go"], requiredPermissions: ["assistant.products.update_inactive_draft"], requiredContext: "current_entity", inputContract: "original_message", confirmationRequired: true, specialistCompiler: false, legacyCompatibility: false, readToolNames: [], commandNames: ["products.replace_inactive_quantity_tiers"] },
  { id: "create_quote", domain: "quotes", mode: "mutation", operations: ["create", "request_confirmation", "execute_go"], requiredPermissions: ["assistant.quotes.create_draft"], requiredContext: "none", inputContract: "original_message", confirmationRequired: true, specialistCompiler: false, legacyCompatibility: false, readToolNames: [], commandNames: ["quotes.create_draft"] },
  { id: "update_quote", domain: "quotes", mode: "mutation", operations: ["update", "request_confirmation", "execute_go"], requiredPermissions: ["assistant.quotes.update_draft"], requiredContext: "current_entity", inputContract: "original_message", confirmationRequired: true, specialistCompiler: false, legacyCompatibility: false, readToolNames: [], commandNames: ["quotes.update_draft", "quotes.add_internal_note"] },
  { id: "convert_quote", domain: "quotes", mode: "mutation", operations: ["update", "request_confirmation", "execute_go"], requiredPermissions: ["assistant.orders.create"], requiredContext: "current_entity", inputContract: "original_message", confirmationRequired: true, specialistCompiler: false, legacyCompatibility: false, readToolNames: [], commandNames: ["quotes.convert_to_order"] },
  { id: "create_order", domain: "orders", mode: "mutation", operations: ["create", "request_confirmation", "execute_go"], requiredPermissions: ["assistant.orders.create"], requiredContext: "none", inputContract: "original_message", confirmationRequired: true, specialistCompiler: false, legacyCompatibility: false, readToolNames: [], commandNames: ["orders.create"] },
  { id: "update_order", domain: "orders", mode: "mutation", operations: ["update", "request_confirmation", "execute_go"], requiredPermissions: ["assistant.orders.update_editable"], requiredContext: "current_entity", inputContract: "original_message", confirmationRequired: true, specialistCompiler: false, legacyCompatibility: false, readToolNames: [], commandNames: ["orders.update_editable"] },
  { id: "orders_workflow", domain: "orders", mode: "mutation", operations: ["create", "update", "request_confirmation", "execute_go"], requiredPermissions: ["assistant.orders.create"], requiredContext: "none", inputContract: "original_message", confirmationRequired: true, specialistCompiler: false, legacyCompatibility: false, readToolNames: [], commandNames: ["orders.create", "orders.update_editable"] },
  { id: "production_operations", domain: "production", mode: "mutation", operations: ["update", "request_confirmation", "execute_go"], requiredPermissions: ["assistant.production.intake_line_items"], requiredContext: "current_entity", inputContract: "original_message", confirmationRequired: true, specialistCompiler: false, legacyCompatibility: false, readToolNames: [], commandNames: ["production.intake_line_items", "production.send_to_prepress", "production.update_job_status", "production.add_job_note"] },
  { id: "fulfillment_operations", domain: "fulfillment", mode: "mutation", operations: ["create", "update", "request_confirmation", "execute_go"], requiredPermissions: ["assistant.fulfillment.create_shipment"], requiredContext: "current_entity", inputContract: "original_message", confirmationRequired: true, specialistCompiler: false, legacyCompatibility: false, readToolNames: [], commandNames: ["fulfillment.create_shipment", "fulfillment.update_shipment_details", "fulfillment.mark_shipped", "fulfillment.create_pickup_ticket", "fulfillment.add_note"] },
  { id: "billing_operations", domain: "billing", mode: "mutation", operations: ["create", "update", "request_confirmation", "execute_go"], requiredPermissions: ["assistant.billing.create_invoice"], requiredContext: "current_entity", inputContract: "original_message", confirmationRequired: true, specialistCompiler: false, legacyCompatibility: false, readToolNames: [], commandNames: ["billing.create_invoice", "billing.update_invoice_draft", "billing.send_invoice", "billing.add_invoice_note"] },
  { id: "payment_operations", domain: "payments", mode: "mutation", operations: ["create", "update", "request_confirmation", "execute_go"], requiredPermissions: ["assistant.payments.record_manual_payment"], requiredContext: "current_entity", inputContract: "original_message", confirmationRequired: true, specialistCompiler: false, legacyCompatibility: false, readToolNames: [], commandNames: ["payments.record_manual_payment", "payments.add_payment_note"] },
  { id: "crm_management", domain: "customers", mode: "mutation", operations: ["create", "update", "request_confirmation", "execute_go"], requiredPermissions: ["assistant.customers.create"], requiredContext: "none", inputContract: "original_message", confirmationRequired: true, specialistCompiler: false, legacyCompatibility: false, readToolNames: [], commandNames: ["customers.create", "customers.update_profile", "customers.update_commercial_terms", "contacts.create", "contacts.update"] },
  { id: "general_conversation", domain: "conversation", mode: "none", operations: ["general_conversation"], requiredPermissions: [], requiredContext: "none", inputContract: "original_message", confirmationRequired: false, specialistCompiler: false, legacyCompatibility: false, readToolNames: [], commandNames: [] },
] as const satisfies readonly AssistantCapabilityCatalogItem[];

export function getAssistantCapability(id: AssistantIntentCapabilityId): AssistantCapabilityCatalogItem {
  const capability = assistantCapabilityCatalog.find((entry) => entry.id === id);
  if (!capability) throw new Error(`Unknown assistant capability: ${id}`);
  return capability;
}

/** Fail closed during composition if a planner-visible entry drifts from an executable registry. */
export function validateAssistantCapabilityCatalog(): void {
  const catalogIds = new Set<string>();
  const registeredTools = new Set<string>(assistantToolNameValues);
  const registeredCommands = new Set<string>(assistantProductionCommandAllowlist);
  for (const rawCapability of assistantCapabilityCatalog) {
    // Widen the literal catalog entry so these are runtime drift checks rather
    // than TypeScript proving facts about today's tuple at compile time.
    const capability: AssistantCapabilityCatalogItem = rawCapability;
    assistantCapabilityCatalogItemSchema.parse(capability);
    if (catalogIds.has(capability.id)) throw new Error(`Duplicate assistant capability: ${capability.id}`);
    catalogIds.add(capability.id);
    for (const name of capability.readToolNames) if (!registeredTools.has(name)) throw new Error(`Capability ${capability.id} references an unregistered read tool: ${name}`);
    for (const name of capability.commandNames) if (!registeredCommands.has(name)) throw new Error(`Capability ${capability.id} references an unregistered command: ${name}`);
    if (capability.mode === "mutation" && capability.commandNames.length === 0) throw new Error(`Mutation capability ${capability.id} has no registered command.`);
    if (capability.mode === "read" && capability.confirmationRequired) throw new Error(`Read capability ${capability.id} cannot require confirmation.`);
  }
}

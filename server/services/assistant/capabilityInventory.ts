import { assistantToolNameValues, type AssistantToolName } from "@shared/assistantContracts";
import { assistantCapabilityCatalog } from "./aiFirstCapabilityCatalog";
import { assistantProductionCommandAllowlist } from "./execution/commandRegistry";
import { assistantToolRegistry } from "./toolRegistry";

/**
 * Phase 1 inventory only. This module deliberately has no execution API and
 * is not imported by the Operator runtime. It records source-backed facts and
 * known unknowns that will seed a future canonical capability registry.
 */
export const capabilityInventoryDomainValues = [
  "products", "pbv2_pricing", "quotes", "orders", "proofing", "prepress",
  "production", "fulfillment", "invoicing", "payments", "customers", "contacts",
  "materials", "settings_permissions", "public_research",
] as const;
export type CapabilityInventoryDomain = (typeof capabilityInventoryDomainValues)[number];

export const capabilityInventoryParityValues = [
  "shared_canonical_today",
  "ui_supported_ai_adapter_missing",
  "ai_specific_narrow_implementation",
  "underlying_support_not_demonstrated",
  "partial_or_indirect",
  "unknown",
] as const;
export type CapabilityInventoryParity = (typeof capabilityInventoryParityValues)[number];

export const capabilityInventoryAiExposureValues = [
  "none", "read_tool", "operator_semantic_tool", "command_plan_only", "legacy_planner_only", "provider_native_tool",
] as const;
export type CapabilityInventoryAiExposure = (typeof capabilityInventoryAiExposureValues)[number];

export type CapabilityInventorySource = {
  file: string;
  symbol?: string;
  route?: string;
  note?: string;
};

export type CapabilityInventoryItem = {
  id: string;
  domain: CapabilityInventoryDomain;
  operation: string;
  mode: "read" | "mutation";
  uiExposure: "none" | "route" | "page_and_route" | "unknown";
  aiExposure: CapabilityInventoryAiExposure;
  readToolName: AssistantToolName | null;
  commandName: (typeof assistantProductionCommandAllowlist)[number] | null;
  inputSchemaSource: CapabilityInventorySource | "unknown";
  resultContractSource: CapabilityInventorySource | "unknown";
  permissionSource: CapabilityInventorySource | "unknown";
  permissionRequirement: string | "unknown";
  tenantScopingSource: CapabilityInventorySource | "unknown";
  confirmation: "not_applicable" | "go_required" | "unknown";
  idempotency: "not_applicable" | "server_generated_with_request_hash" | "unknown";
  lifecycleValidationSource: CapabilityInventorySource | "unknown";
  canonicalCandidate: CapabilityInventorySource | "needs_extraction" | "unknown";
  routes: readonly CapabilityInventorySource[];
  audit: CapabilityInventorySource | "unknown";
  parity: CapabilityInventoryParity;
  migrationNotes: string;
};

export type AuthorizationInventorySource = {
  id: string;
  appliesTo: readonly string[];
  actorIdentitySource: CapabilityInventorySource;
  tenantIdentitySource: CapabilityInventorySource;
  permissionSource: CapabilityInventorySource | "none_explicit";
  roleTranslation: CapabilityInventorySource | "none_explicit";
  hardCodedPermissions: readonly string[];
  finding: string;
};

export type ProductParityInventoryItem = {
  id: string;
  productArea: string;
  uiSource: CapabilityInventorySource | "unknown";
  normalOperatorSource: CapabilityInventorySource | "none";
  classification: CapabilityInventoryParity;
  notes: string;
};

const source = (file: string, symbol?: string, route?: string, note?: string): CapabilityInventorySource => ({ file, ...(symbol ? { symbol } : {}), ...(route ? { route } : {}), ...(note ? { note } : {}) });
const assistantRoute = "server/routes/assistant.routes.ts";
const executionRoute = "server/routes/assistantExecution.routes.ts";
const productRoute = "server/routes/products.routes.ts";

/** Dependency-free source-backed command metadata snapshot. Phase 2B completed
 * the eight former mirror gaps by tracing each command definition's
 * requiredCapability; command definitions remain the runtime source of truth. */
const capabilityMirrorCommandPermissions: Readonly<Record<string, string>> = {
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
  "products.update_existing_product": "assistant.products.update_existing_product",
  "products.create_inactive_draft_batch": "assistant.products.create_inactive_draft_batch",
  "products.adjust_pricing": "assistant.products.adjust_pricing",
  "products.rollback_pricing_change_set": "assistant.products.adjust_pricing",
  "products.create_configurable_draft": "assistant.products.create_inactive_draft",
  "products.create_from_canonical_intent": "assistant.products.create_inactive_draft",
  "products.clone_to_inactive_draft": "assistant.products.clone_to_inactive_draft",
  "products.replace_inactive_matrix": "assistant.products.replace_inactive_matrix",
  "products.replace_inactive_quantity_tiers": "assistant.products.replace_inactive_quantity_tiers",
};

export const knownCapabilityMirrorReadTools = [
  "search.global", "quotes.search", "quotes.get_detail", "customers.get_summary",
  "orders.get_summary", "products.get_summary", "reports.operational_summary",
  "navigation.get_current_context", "production.get_queue_summary",
  "operations.get_attention_summary", "orders.get_due_summary", "production.get_completed_jobs",
  "analytics.resolve_customer", "analytics.customer_product_sales", "analytics.customer_uninvoiced_orders",
] as const;

function commandDomain(command: (typeof assistantProductionCommandAllowlist)[number]): CapabilityInventoryDomain {
  if (command.startsWith("products.")) return command.includes("pricing") || command.includes("matrix") || command.includes("quantity_tiers") ? "pbv2_pricing" : "products";
  if (command.startsWith("quotes.")) return "quotes";
  if (command.startsWith("orders.")) return "orders";
  if (command.startsWith("customers.")) return "customers";
  if (command.startsWith("contacts.")) return "contacts";
  if (command.startsWith("production.")) return "production";
  if (command.startsWith("fulfillment.")) return "fulfillment";
  if (command.startsWith("billing.")) return "invoicing";
  return "payments";
}

const commandSourceByName: Partial<Record<(typeof assistantProductionCommandAllowlist)[number], CapabilityInventorySource>> = {
  "quotes.add_internal_note": source("server/services/assistant/execution/quoteInternalNoteCommand.ts", "createQuoteInternalNoteCommandDefinition"),
  "products.create_inactive_draft": source("server/services/assistant/execution/productInactiveDraftCommand.ts", "createProductInactiveDraftCommandDefinition"),
  "products.create_inactive_draft_batch": source("server/services/assistant/execution/productInactiveDraftBatchCommand.ts", "createProductInactiveDraftBatchCommandDefinition"),
  "products.update_inactive_draft": source("server/services/assistant/execution/productInactiveDraftUpdateCommand.ts", "createProductInactiveDraftUpdateCommandDefinition"),
  "products.update_inactive_draft_batch": source("server/services/assistant/execution/productInactiveDraftBulkUpdateCommand.ts", "createProductInactiveDraftBulkUpdateCommandDefinition"),
  "products.adjust_pricing": source("server/services/assistant/execution/productPricingChangeSetCommand.ts", "createProductPricingChangeSetCommandDefinition"),
  "products.rollback_pricing_change_set": source("server/services/assistant/execution/productPricingChangeSetCommand.ts", "createProductPricingRollbackCommandDefinition"),
  "products.create_configurable_draft": source("server/services/assistant/execution/configurableProductDraftCommand.ts", "createConfigurableProductDraftCommandDefinition"),
  "products.create_from_canonical_intent": source("server/services/assistant/execution/canonicalProductIntentDraftCommand.ts", "createCanonicalProductIntentDraftCommandDefinition"),
  "products.clone_to_inactive_draft": source("server/services/assistant/execution/cloneInactiveProductDraftCommand.ts", "createCloneInactiveProductDraftCommandDefinition"),
  "products.replace_inactive_matrix": source("server/services/assistant/execution/inactivePbv2PricingMatrixEditCommand.ts", "createInactivePbv2PricingMatrixEditCommandDefinition"),
  "products.replace_inactive_quantity_tiers": source("server/services/assistant/execution/inactivePbv2QuantityTierEditCommand.ts", "createInactivePbv2QuantityTierEditCommandDefinition"),
  "products.update_existing_product": source("server/services/assistant/execution/existingProductEditCommand.ts", "createExistingProductEditCommandDefinition"),
  "quotes.create_draft": source("server/services/assistant/execution/quoteDraftCreateCommand.ts", "createQuoteDraftCreateCommandDefinition"),
  "quotes.update_draft": source("server/services/assistant/execution/quoteDraftUpdateCommand.ts", "createQuoteDraftUpdateCommandDefinition"),
  "orders.create": source("server/services/assistant/execution/deferredOrderCommands.ts", "createDeferredOrderCommandDefinition"),
  "orders.update_editable": source("server/services/assistant/execution/deferredOrderCommands.ts", "createEditableOrderUpdateCommandDefinition"),
  "quotes.convert_to_order": source("server/services/assistant/execution/deferredOrderCommands.ts", "createQuoteConvertOrderCommandDefinition"),
  "customers.create": source("server/services/assistant/execution/crmManagementCommands.ts", "createCrmManagementCommandDefinition"),
  "customers.update_profile": source("server/services/assistant/execution/crmManagementCommands.ts", "createCrmManagementCommandDefinition"),
  "customers.update_commercial_terms": source("server/services/assistant/execution/crmManagementCommands.ts", "createCrmManagementCommandDefinition"),
  "contacts.create": source("server/services/assistant/execution/crmManagementCommands.ts", "createCrmManagementCommandDefinition"),
  "contacts.update": source("server/services/assistant/execution/crmManagementCommands.ts", "createCrmManagementCommandDefinition"),
  "production.intake_line_items": source("server/services/assistant/execution/productionOperationsCommands.ts", "createProductionOperationCommandDefinition"),
  "production.send_to_prepress": source("server/services/assistant/execution/productionOperationsCommands.ts", "createProductionOperationCommandDefinition"),
  "production.update_job_status": source("server/services/assistant/execution/productionOperationsCommands.ts", "createProductionOperationCommandDefinition"),
  "production.add_job_note": source("server/services/assistant/execution/productionOperationsCommands.ts", "createProductionOperationCommandDefinition"),
  "fulfillment.create_shipment": source("server/services/assistant/execution/fulfillmentOperationsCommands.ts", "createFulfillmentOperationCommandDefinition"),
  "fulfillment.update_shipment_details": source("server/services/assistant/execution/fulfillmentOperationsCommands.ts", "createFulfillmentOperationCommandDefinition"),
  "fulfillment.mark_shipped": source("server/services/assistant/execution/fulfillmentOperationsCommands.ts", "createFulfillmentOperationCommandDefinition"),
  "fulfillment.create_pickup_ticket": source("server/services/assistant/execution/fulfillmentOperationsCommands.ts", "createFulfillmentOperationCommandDefinition"),
  "fulfillment.add_note": source("server/services/assistant/execution/fulfillmentOperationsCommands.ts", "createFulfillmentOperationCommandDefinition"),
  "billing.create_invoice": source("server/services/assistant/execution/billingInvoiceOperationsCommands.ts", "createBillingInvoiceOperationCommandDefinition"),
  "billing.update_invoice_draft": source("server/services/assistant/execution/billingInvoiceOperationsCommands.ts", "createBillingInvoiceOperationCommandDefinition"),
  "billing.send_invoice": source("server/services/assistant/execution/billingInvoiceOperationsCommands.ts", "createBillingInvoiceOperationCommandDefinition"),
  "billing.add_invoice_note": source("server/services/assistant/execution/billingInvoiceOperationsCommands.ts", "createBillingInvoiceOperationCommandDefinition"),
  "payments.record_manual_payment": source("server/services/assistant/execution/paymentOperationsCommands.ts", "createPaymentOperationCommandDefinition"),
  "payments.add_payment_note": source("server/services/assistant/execution/paymentOperationsCommands.ts", "createPaymentOperationCommandDefinition"),
};

const sharedCanonicalPricingCommands = new Set([
  "products.adjust_pricing",
  "products.rollback_pricing_change_set",
  "products.replace_inactive_matrix",
  "products.replace_inactive_quantity_tiers",
]);

const commandInventory: CapabilityInventoryItem[] = assistantProductionCommandAllowlist.map((command) => {
  const definition = commandSourceByName[command] ?? "unknown";
  const permission = Object.prototype.hasOwnProperty.call(capabilityMirrorCommandPermissions, command)
    ? capabilityMirrorCommandPermissions[command]!
    : "unknown";
  return {
    id: `ai.command.${command}`,
    domain: commandDomain(command),
    operation: command,
    mode: "mutation",
    uiExposure: "unknown",
    aiExposure: "command_plan_only",
    readToolName: null,
    commandName: command,
    inputSchemaSource: definition,
    resultContractSource: definition,
    permissionSource: permission === "unknown" ? "unknown" : source("server/services/assistant/assistantCapabilities.ts", "assistantCapabilityCommandPermissions"),
    permissionRequirement: permission,
    tenantScopingSource: source(executionRoute, "scope", undefined, "Authenticated request supplies organizationId; commands reload scoped records."),
    confirmation: "go_required",
    idempotency: "server_generated_with_request_hash",
    lifecycleValidationSource: definition,
    canonicalCandidate: sharedCanonicalPricingCommands.has(command)
      ? source("server/services/products/canonicalProductPricingOperations.ts", "CanonicalProductPricingOperations")
      : definition,
    routes: [source(executionRoute, "registerAssistantExecutionRoutes", "/api/assistant/conversations/:conversationId/plans")],
    audit: source("server/services/assistant/execution/executionPlanningService.ts", "ExecutionPlanningService"),
    parity: sharedCanonicalPricingCommands.has(command) ? "shared_canonical_today" : "partial_or_indirect",
    migrationNotes: sharedCanonicalPricingCommands.has(command)
      ? "Compatibility command delegates pricing validation or persistence to the shared canonical Product pricing boundary; existing GO, stale-state, snapshot, rollback, and audit controls remain authoritative."
      : "Registered, confirmation-bound AI command. UI parity and canonical ownership require source-by-source confirmation.",
  };
});

const readToolInventory: CapabilityInventoryItem[] = Array.from(assistantToolRegistry.values()).map((tool) => ({
  id: `ai.read.${tool.name}`,
  domain: tool.name.startsWith("products.") ? "products" : tool.name.startsWith("quotes.") ? "quotes" : tool.name.startsWith("orders.") ? "orders" : tool.name.startsWith("customers.") || tool.name.startsWith("analytics.") ? "customers" : tool.name.startsWith("production.") ? "production" : "settings_permissions",
  operation: tool.name,
  mode: "read",
  uiExposure: "unknown",
  aiExposure: "read_tool",
  readToolName: tool.name,
  commandName: null,
  inputSchemaSource: source("server/services/assistant/toolRegistry.ts", "toolMetadata"),
  resultContractSource: source("server/services/assistant/toolRegistry.ts", "toolMetadata"),
  permissionSource: source("server/services/assistant/toolRegistry.ts", "isAuthorizedForAssistantTool"),
  permissionRequirement: tool.requiredPermission,
  tenantScopingSource: source("server/services/assistant/toolRegistry.ts", "AssistantTrustedToolContext"),
  confirmation: "not_applicable",
  idempotency: "not_applicable",
  lifecycleValidationSource: "unknown",
  canonicalCandidate: source("server/services/assistant/assistantToolAdapters.ts", "createStage2AssistantToolAdapters"),
  routes: [source(assistantRoute, "registerAssistantRoutes", "/api/assistant/conversations/:conversationId/turns")],
  audit: source("server/services/assistant/orchestration.ts", "AssistantOrchestrationService"),
  parity: "partial_or_indirect",
  migrationNotes: "Authoritative for the assistant read boundary, not an inventory of all UI reads.",
}));

const uiOnlyInventory: CapabilityInventoryItem[] = [
  { id: "ui.quotes.manage_quote", domain: "quotes", operation: "create, edit, transition, approve, revise, and manage quote line items", mode: "mutation", uiExposure: "page_and_route", aiExposure: "none", readToolName: null, commandName: null, inputSchemaSource: source("server/routes/quotes.routes.ts", undefined, "POST/PATCH /api/quotes"), resultContractSource: "unknown", permissionSource: source("server/routes/quotes.routes.ts", "isAuthenticated/tenantContext"), permissionRequirement: "authenticated_tenant_user", tenantScopingSource: source("server/routes/quotes.routes.ts", "tenantContext"), confirmation: "unknown", idempotency: "unknown", lifecycleValidationSource: source("server/routes/quotes.routes.ts", undefined, "POST /api/quotes/:id/transition"), canonicalCandidate: "needs_extraction", routes: [source("server/routes/quotes.routes.ts", undefined, "POST/PATCH /api/quotes")], audit: "unknown", parity: "ui_supported_ai_adapter_missing", migrationNotes: "UI quote lifecycle is broader than the AI command-plan subset." },
  { id: "ui.orders.manage_order_lifecycle", domain: "orders", operation: "create, edit, transition, complete, close, reopen, cancel, and manage line items", mode: "mutation", uiExposure: "page_and_route", aiExposure: "none", readToolName: null, commandName: null, inputSchemaSource: source("server/routes/orders.routes.ts", undefined, "POST/PATCH /api/orders"), resultContractSource: "unknown", permissionSource: source("server/routes/orders.routes.ts", "isAuthenticated/tenantContext"), permissionRequirement: "route_specific_or_unknown", tenantScopingSource: source("server/routes/orders.routes.ts", "tenantContext"), confirmation: "unknown", idempotency: "unknown", lifecycleValidationSource: source("server/routes/orders.routes.ts", undefined, "POST /api/orders/:orderId/transition"), canonicalCandidate: "needs_extraction", routes: [source("server/routes/orders.routes.ts", undefined, "POST /api/orders/:orderId/transition")], audit: "unknown", parity: "ui_supported_ai_adapter_missing", migrationNotes: "AI commands cover only create/update-editable while UI exposes broader lifecycle operations." },
  { id: "ui.production.manage_jobs", domain: "production", operation: "transition line-item workflow, update jobs, and add job notes", mode: "mutation", uiExposure: "page_and_route", aiExposure: "none", readToolName: null, commandName: null, inputSchemaSource: source("server/routes/jobs.routes.ts", undefined, "POST /api/line-items/:lineItemId/workflow-transition"), resultContractSource: "unknown", permissionSource: source("server/routes/jobs.routes.ts", "isAuthenticated/tenantContext"), permissionRequirement: "authenticated_tenant_user", tenantScopingSource: source("server/routes/jobs.routes.ts", "tenantContext"), confirmation: "unknown", idempotency: "unknown", lifecycleValidationSource: source("server/routes/jobs.routes.ts", undefined, "POST /api/line-items/:lineItemId/workflow-transition"), canonicalCandidate: "needs_extraction", routes: [source("server/routes/jobs.routes.ts", undefined, "PATCH /api/jobs/:id")], audit: "unknown", parity: "partial_or_indirect", migrationNotes: "AI exposes a limited production command subset." },
  { id: "ui.fulfillment.manage_orders_shipments_pickups", domain: "fulfillment", operation: "ready/unready fulfillment, shipments, pickup tickets, and shipping state", mode: "mutation", uiExposure: "page_and_route", aiExposure: "none", readToolName: null, commandName: null, inputSchemaSource: source("server/routes/fulfillment.routes.ts", undefined, "fulfillment routes"), resultContractSource: "unknown", permissionSource: source("server/routes/fulfillment.routes.ts", "isAuthenticated/tenantContext"), permissionRequirement: "authenticated_tenant_user", tenantScopingSource: source("server/routes/fulfillment.routes.ts", "tenantContext"), confirmation: "unknown", idempotency: "unknown", lifecycleValidationSource: source("server/routes/fulfillment.routes.ts", undefined, "POST /api/fulfillment/shipments/:shipmentId/mark-shipped"), canonicalCandidate: "needs_extraction", routes: [source("server/routes/fulfillment.routes.ts", undefined, "POST/PATCH /api/fulfillment")], audit: "unknown", parity: "partial_or_indirect", migrationNotes: "AI commands cover selected shipment/pickup actions only." },
  { id: "ui.invoicing.manage_invoice", domain: "invoicing", operation: "create, edit, bill, send, and remind invoices", mode: "mutation", uiExposure: "page_and_route", aiExposure: "none", readToolName: null, commandName: null, inputSchemaSource: source("server/routes/mvpInvoicing.routes.ts", undefined, "invoice routes"), resultContractSource: "unknown", permissionSource: source("server/routes/mvpInvoicing.routes.ts", "isAuthenticated/tenantContext"), permissionRequirement: "route_specific_or_unknown", tenantScopingSource: source("server/routes/mvpInvoicing.routes.ts", "tenantContext"), confirmation: "unknown", idempotency: "unknown", lifecycleValidationSource: source("server/routes/mvpInvoicing.routes.ts", undefined, "POST /api/invoices/:id/send"), canonicalCandidate: "needs_extraction", routes: [source("server/routes/mvpInvoicing.routes.ts", undefined, "POST/PATCH /api/invoices")], audit: "unknown", parity: "partial_or_indirect", migrationNotes: "AI billing commands are narrower than the UI invoice lifecycle." },
  { id: "ui.payments.record_and_manage", domain: "payments", operation: "record, void, synchronize, refund, capture, and configure payments", mode: "mutation", uiExposure: "page_and_route", aiExposure: "none", readToolName: null, commandName: null, inputSchemaSource: source("server/routes/mvpInvoicing.routes.ts", undefined, "payment routes"), resultContractSource: "unknown", permissionSource: source("server/routes/paymentProvider.routes.ts", "requirePaymentRecordPermission/isAdminOrOwner"), permissionRequirement: "route_specific_or_unknown", tenantScopingSource: source("server/routes/mvpInvoicing.routes.ts", "tenantContext"), confirmation: "unknown", idempotency: "unknown", lifecycleValidationSource: source("server/routes/paymentProvider.routes.ts", undefined, "EPS payment routes"), canonicalCandidate: "needs_extraction", routes: [source("server/routes/mvpInvoicing.routes.ts", undefined, "POST /api/payments")], audit: "unknown", parity: "partial_or_indirect", migrationNotes: "AI only exposes manual payment recording and notes." },
  { id: "ui.customers.manage_customer", domain: "customers", operation: "create, edit, merge, import, and manage customer production references", mode: "mutation", uiExposure: "page_and_route", aiExposure: "none", readToolName: null, commandName: null, inputSchemaSource: source("server/routes/customers.routes.ts", undefined, "POST/PATCH /api/customers"), resultContractSource: "unknown", permissionSource: source("server/routes/customers.routes.ts", "isAuthenticated/tenantContext/isAdmin"), permissionRequirement: "route_specific_or_unknown", tenantScopingSource: source("server/routes/customers.routes.ts", "tenantContext"), confirmation: "unknown", idempotency: "unknown", lifecycleValidationSource: source("server/routes/customers.routes.ts", undefined, "customer routes"), canonicalCandidate: "needs_extraction", routes: [source("server/routes/customers.routes.ts", undefined, "POST/PATCH /api/customers")], audit: "unknown", parity: "partial_or_indirect", migrationNotes: "AI CRM commands cover selected create/profile/commercial operations." },
  { id: "ui.contacts.manage_contact_relationships", domain: "contacts", operation: "create, edit, link, set primary, and manage contact status", mode: "mutation", uiExposure: "page_and_route", aiExposure: "none", readToolName: null, commandName: null, inputSchemaSource: source("server/routes/customerRelations.routes.ts", undefined, "customer contact routes"), resultContractSource: "unknown", permissionSource: source("server/routes/customerRelations.routes.ts", "isAuthenticated/tenantContext"), permissionRequirement: "authenticated_tenant_user", tenantScopingSource: source("server/routes/customerRelations.routes.ts", "tenantContext"), confirmation: "unknown", idempotency: "unknown", lifecycleValidationSource: source("server/routes/customerRelations.routes.ts", undefined, "contact relationship routes"), canonicalCandidate: "needs_extraction", routes: [source("server/routes/customerRelations.routes.ts", undefined, "POST/PATCH /api/customer-contacts")], audit: "unknown", parity: "partial_or_indirect", migrationNotes: "AI CRM commands do not establish full relationship-management parity." },
  { id: "ui.products.edit_primary_fields", domain: "products", operation: "edit product identity, description, category, type, measurement, workflow, material", mode: "mutation", uiExposure: "page_and_route", aiExposure: "none", readToolName: null, commandName: null, inputSchemaSource: source(productRoute, undefined, "PATCH /api/products/:id"), resultContractSource: "unknown", permissionSource: source("server/routes.ts", "isAdminOrOwner"), permissionRequirement: "owner_or_admin", tenantScopingSource: source(productRoute, undefined, "PATCH /api/products/:id"), confirmation: "unknown", idempotency: "unknown", lifecycleValidationSource: source(productRoute, undefined, "PATCH /api/products/:id"), canonicalCandidate: "needs_extraction", routes: [source(productRoute, undefined, "PATCH /api/products/:id")], audit: "unknown", parity: "ui_supported_ai_adapter_missing", migrationNotes: "Route-level implementation; do not label canonical before extraction." },
  { id: "ui.pbv2.save_draft_tree", domain: "pbv2_pricing", operation: "save PBV2 draft tree", mode: "mutation", uiExposure: "page_and_route", aiExposure: "command_plan_only", readToolName: null, commandName: "products.update_existing_product", inputSchemaSource: source(productRoute, undefined, "PUT /api/products/:productId/pbv2/draft"), resultContractSource: source("server/services/products/canonicalPbv2OptionConfigurationOperations.ts"), permissionSource: source(productRoute, "isAuthenticated/tenantContext"), permissionRequirement: "authenticated_tenant_user (UI); assistant.products.update_existing_product (AI)", tenantScopingSource: source("server/services/products/canonicalPbv2OptionConfigurationOperations.ts"), confirmation: "go_required", idempotency: "server_generated_with_request_hash", lifecycleValidationSource: source("server/services/products/canonicalPbv2OptionConfigurationOperations.ts"), canonicalCandidate: source("server/services/products/canonicalPbv2OptionConfigurationOperations.ts"), routes: [source(productRoute, undefined, "PUT /api/products/:productId/pbv2/draft")], audit: source("server/services/assistant/execution/existingProductEditCommand.ts", "assistant_existing_product_edit"), parity: "shared_canonical_today", migrationNotes: "UI retains its existing save semantics; Operator option changes require GO. Both share products.update_option_configuration.v1 persistence and validation, and full arbitrary tree execution is not exposed." },
  { id: "ui.products.activate_published_configuration", domain: "products", operation: "activate/deactivate product and PBV2 configuration", mode: "mutation", uiExposure: "page_and_route", aiExposure: "none", readToolName: null, commandName: null, inputSchemaSource: source(productRoute, undefined, "PBV2 override and product lifecycle routes"), resultContractSource: "unknown", permissionSource: source(productRoute, "isAdmin"), permissionRequirement: "admin", tenantScopingSource: source(productRoute, "tenantContext"), confirmation: "unknown", idempotency: "unknown", lifecycleValidationSource: source(productRoute, "validateTreeForPublish"), canonicalCandidate: "needs_extraction", routes: [source(productRoute, undefined, "POST /api/products/:productId/pbv2/override/toggle")], audit: "unknown", parity: "ui_supported_ai_adapter_missing", migrationNotes: "Operator capability response currently advertises product activation disabled." },
  { id: "ui.proofing.order_proof_policy", domain: "proofing", operation: "edit order proof policy", mode: "mutation", uiExposure: "page_and_route", aiExposure: "none", readToolName: null, commandName: null, inputSchemaSource: source("server/routes/orders.routes.ts", undefined, "PATCH /api/orders/:orderId/proof-policy"), resultContractSource: "unknown", permissionSource: source("server/routes.ts", "isAdminOrOwner"), permissionRequirement: "owner_or_admin", tenantScopingSource: source("server/routes/orders.routes.ts", "tenantContext"), confirmation: "unknown", idempotency: "unknown", lifecycleValidationSource: source("server/routes/orders.routes.ts", undefined, "PATCH /api/orders/:orderId/proof-policy"), canonicalCandidate: "needs_extraction", routes: [source("server/routes/orders.routes.ts", undefined, "PATCH /api/orders/:orderId/proof-policy")], audit: "unknown", parity: "ui_supported_ai_adapter_missing", migrationNotes: "Portal proof decisions exist separately; no normal Operator proof capability was found." },
  { id: "ui.prepress.manage_sessions_and_files", domain: "prepress", operation: "manage prepress sessions, files, routing, and material overrides", mode: "mutation", uiExposure: "page_and_route", aiExposure: "none", readToolName: null, commandName: null, inputSchemaSource: source("server/routes/prepress.routes.ts", "registerPrepressQueueRoutes"), resultContractSource: "unknown", permissionSource: source("server/routes/prepress.routes.ts", "tenantContext"), permissionRequirement: "route_specific_or_unknown", tenantScopingSource: source("server/routes/prepress.routes.ts", "tenantContext"), confirmation: "unknown", idempotency: "unknown", lifecycleValidationSource: source("server/services/prepressQueueEligibility.ts", "resolvePrepressQueueEligibility"), canonicalCandidate: source("server/services/prepressQueueEligibility.ts", "resolvePrepressQueueEligibility"), routes: [source("server/routes/prepress.routes.ts", undefined, "POST /api/prepress/session/start")], audit: "unknown", parity: "ui_supported_ai_adapter_missing", migrationNotes: "AI only has a limited production send-to-prepress command." },
  { id: "ui.materials.manage_inventory", domain: "materials", operation: "create, update, adjust, reorder, receive material inventory", mode: "mutation", uiExposure: "page_and_route", aiExposure: "none", readToolName: null, commandName: null, inputSchemaSource: source("server/routes/orders.routes.ts", "registerOrderRoutes"), resultContractSource: "unknown", permissionSource: source("server/routes.ts", "isAdminOrOwner"), permissionRequirement: "owner_or_admin", tenantScopingSource: source("server/routes/orders.routes.ts", "tenantContext"), confirmation: "unknown", idempotency: "unknown", lifecycleValidationSource: source("server/routes/orders.routes.ts", "registerOrderRoutes"), canonicalCandidate: "needs_extraction", routes: [source("server/routes/orders.routes.ts", undefined, "POST/PATCH /api/materials")], audit: "unknown", parity: "ui_supported_ai_adapter_missing", migrationNotes: "Product drafting reads material candidates but does not expose inventory operations." },
  { id: "ui.settings.organization_preferences", domain: "settings_permissions", operation: "update organization preferences and settings", mode: "mutation", uiExposure: "page_and_route", aiExposure: "none", readToolName: null, commandName: null, inputSchemaSource: source("server/routes/organization.routes.ts", undefined, "PUT /api/organization/preferences"), resultContractSource: "unknown", permissionSource: source("server/routes.ts", "requireOrgOwnerAdmin"), permissionRequirement: "owner_or_admin", tenantScopingSource: source("server/routes/organization.routes.ts", "tenantContext"), confirmation: "unknown", idempotency: "unknown", lifecycleValidationSource: source("server/routes/organization.routes.ts", undefined, "PUT /api/organization/preferences"), canonicalCandidate: "needs_extraction", routes: [source("server/routes/organization.routes.ts", undefined, "PUT /api/organization/preferences")], audit: "unknown", parity: "ui_supported_ai_adapter_missing", migrationNotes: "System Guide can explain settings but does not mutate them." },
  { id: "ai.public_research", domain: "public_research", operation: "research public products, materials, supplier items, or concepts", mode: "read", uiExposure: "none", aiExposure: "provider_native_tool", readToolName: null, commandName: null, inputSchemaSource: source("server/services/assistant/operatorDecisionProvider.ts", "ConfiguredAssistantOperatorDecisionProvider"), resultContractSource: source("server/services/assistant/operatorDecisionProvider.ts", "withNativeSources"), permissionSource: source("server/services/assistant/assistantCapabilities.ts", "OrganizationAssistantCapabilityResolver"), permissionRequirement: "assistant_enabled_and_provider_capability", tenantScopingSource: source("server/services/assistant/operatorDecisionProvider.ts", "ConfiguredAssistantOperatorDecisionProvider"), confirmation: "not_applicable", idempotency: "not_applicable", lifecycleValidationSource: "unknown", canonicalCandidate: "unknown", routes: [source(assistantRoute, undefined, "/api/assistant/conversations/:conversationId/turns")], audit: source("shared/aiDiagnostics.ts", "aiDiagnosticEnvelopeSchema"), parity: "partial_or_indirect", migrationNotes: "Native DeepSeek web search or server fallback is selected by provider capability." },
];

export const capabilityInventory = Object.freeze([...readToolInventory, ...commandInventory, ...uiOnlyInventory] as const);

export const authorizationInventory = Object.freeze([
  { id: "ui.route.middleware", appliesTo: ["normal UI reads and mutations"], actorIdentitySource: source("server/routes.ts", "isAuthenticated"), tenantIdentitySource: source("server/tenantContext.ts", "tenantContext/getRequestOrganizationId"), permissionSource: source("server/routes.ts", "isAdminOrOwner/requireOrgOwnerAdmin"), roleTranslation: source("server/routes.ts", "isAdminOrOwner/requireOrgOwnerAdmin"), hardCodedPermissions: [], finding: "Route middleware is the UI authority, but exact policy varies by route and several routes use only authentication plus tenant context." },
  { id: "assistant.shared.authority", appliesTo: ["chat", "execution-plan creation", "GO confirmation", "command execution"], actorIdentitySource: source(assistantRoute, "getUserId"), tenantIdentitySource: source("server/tenantContext.ts", "tenantContext/getRequestOrganizationId"), permissionSource: source("shared/organizationRoleAuthority.ts", "resolveOrganizationRoleAuthority"), roleTranslation: source("shared/organizationRoleAuthority.ts", "resolveOrganizationRoleAuthority"), hardCodedPermissions: ["assistant.internal_staff", "catalog.read", "assistant.products.create_inactive_draft", "assistant.billing.send_invoice"], finding: "Shared tenant-role policy supplies grants to both chat and execution; command requiredCapability and allowedRoles are both enforced." },
  { id: "assistant.read.tool", appliesTo: ["AI read tool execution"], actorIdentitySource: source("server/services/assistant/toolRegistry.ts", "AssistantTrustedToolContext"), tenantIdentitySource: source("server/services/assistant/toolRegistry.ts", "AssistantTrustedToolContext"), permissionSource: source("server/services/assistant/toolRegistry.ts", "isAuthorizedForAssistantTool"), roleTranslation: "none_explicit", hardCodedPermissions: ["assistant.internal_staff", "catalog.read", "finance.read"], finding: "Read-tool policy is explicit and requires the server-derived internal-staff marker." },
  { id: "assistant.capability.mirror", appliesTo: ["capability description and filtering"], actorIdentitySource: source(assistantRoute, "buildActor"), tenantIdentitySource: source(assistantRoute, "resolveScope"), permissionSource: source("server/services/assistant/capabilityInventory.ts", "capabilityMirrorCommandPermissions"), roleTranslation: source("shared/organizationRoleAuthority.ts", "resolveOrganizationRoleAuthority"), hardCodedPermissions: [], finding: "Descriptive metadata now covers the production allowlist but is not runtime authority; command definitions and the shared policy are authoritative." },
  { id: "assistant.execution.shared_scope", appliesTo: ["execution-plan creation", "GO confirmation", "command execution"], actorIdentitySource: source(executionRoute, "userId"), tenantIdentitySource: source(executionRoute, "scope"), permissionSource: source("server/services/assistant/actorAuthorityResolver.ts", "resolveAssistantActorAuthority"), roleTranslation: source("shared/organizationRoleAuthority.ts", "resolveOrganizationRoleAuthority"), hardCodedPermissions: [], finding: "Execution uses the same resolver grants as chat and checks each command's required capability and allowed roles at planning, confirmation, and execution." },
  { id: "assistant.command.definition", appliesTo: ["command registration and execution metadata"], actorIdentitySource: source(executionRoute, "scope"), tenantIdentitySource: source(executionRoute, "scope"), permissionSource: source("server/services/assistant/execution/commandRegistry.ts", "AssistantCommandDefinition.requiredCapability/allowedRoles"), roleTranslation: source("server/services/assistant/execution/commandRegistry.ts", "AssistantCommandDefinition.allowedRoles"), hardCodedPermissions: [], finding: "Commands declare required capability and allowed roles; both are carried into the execution registry and enforced." },
] as const satisfies readonly AuthorizationInventorySource[]);

export const commandPermissionMetadataGaps = Object.freeze(
  assistantProductionCommandAllowlist.filter((command) => !Object.prototype.hasOwnProperty.call(capabilityMirrorCommandPermissions, command)),
);

export const productParityInventory = Object.freeze([
  { id: "products.name", productArea: "Name / identity", uiSource: source(productRoute, undefined, "PATCH /api/products/:id"), normalOperatorSource: source("server/services/products/canonicalProductConfigurationOperations.ts"), classification: "shared_canonical_today", notes: "Existing edits share products.update_configuration.v1; new drafts compose the same proposal schema before a Product ID exists." },
  { id: "products.description", productArea: "Description", uiSource: source(productRoute, undefined, "PATCH /api/products/:id"), normalOperatorSource: source("server/services/products/canonicalProductConfigurationOperations.ts"), classification: "shared_canonical_today", notes: "Product Editor and confirmed existing-product Operator share products.update_configuration.v1." },
  { id: "products.category_type", productArea: "Category / type", uiSource: source(productRoute, undefined, "PATCH /api/products/:id"), normalOperatorSource: source("server/services/products/canonicalProductConfigurationOperations.ts"), classification: "shared_canonical_today", notes: "Category and validated Product type are shared for existing Products." },
  { id: "products.measurement", productArea: "Measurement mode", uiSource: source(productRoute, undefined, "PATCH /api/products/:id"), normalOperatorSource: source("server/services/products/canonicalProductConfigurationOperations.ts"), classification: "shared_canonical_today", notes: "Existing edits and pre-persistence semantic proposals share the canonical configuration shape." },
  { id: "products.workflow", productArea: "Workflow intent", uiSource: source(productRoute, undefined, "PATCH /api/products/:id"), normalOperatorSource: source("server/services/products/canonicalProductConfigurationOperations.ts"), classification: "shared_canonical_today", notes: "Workflow intent and established service-fee defaults are shared canonical." },
  { id: "products.pricing", productArea: "Scalar pricing", uiSource: source(productRoute, undefined, "PATCH /api/products/:id"), normalOperatorSource: source("server/services/products/canonicalProductPricingOperations.ts", "CanonicalProductPricingOperations"), classification: "shared_canonical_today", notes: "Product Editor metadata/PBV2 saves, canonical Product intent proposals, and scalar change sets share products.update_pricing.v1 validation and persistence boundaries." },
  { id: "products.pricing_matrices", productArea: "Pricing matrices", uiSource: source(productRoute, undefined, "PUT /api/products/:productId/pbv2/draft"), normalOperatorSource: source("server/services/products/canonicalProductPricingOperations.ts", "validateCanonicalPricingMatrixReplacement"), classification: "shared_canonical_today", notes: "Product Editor DRAFT saves and the inactive-DRAFT compatibility command share canonical matrix validation; AI lifecycle scope remains intentionally narrower." },
  { id: "products.quantity_tiers", productArea: "Quantity tiers", uiSource: source(productRoute, undefined, "PUT /api/products/:productId/pbv2/draft"), normalOperatorSource: source("server/services/products/canonicalProductPricingOperations.ts", "validateCanonicalPricingTierReplacement"), classification: "shared_canonical_today", notes: "Product Editor DRAFT saves and the inactive-DRAFT compatibility command share canonical tier validation; AI lifecycle scope remains intentionally narrower." },
  { id: "products.materials", productArea: "Materials", uiSource: source(productRoute, undefined, "PATCH /api/products/:id"), normalOperatorSource: source("server/services/productIntentCompiler/semanticProductOperations.ts", "set_material"), classification: "ai_specific_narrow_implementation", notes: "Contained label-based new-draft compatibility path; existing Product adapter remains missing." },
  { id: "products.option_groups_values", productArea: "Option groups and values", uiSource: source(productRoute, undefined, "PUT /api/products/:productId/pbv2/draft"), normalOperatorSource: source("server/services/products/canonicalPbv2OptionConfigurationOperations.ts"), classification: "shared_canonical_today", notes: "Existing edits execute the shared operation; new drafts compose and apply its mutation schema through a pre-persistence adapter." },
  { id: "products.defaults", productArea: "Defaults", uiSource: source(productRoute, undefined, "PUT /api/products/:productId/pbv2/draft"), normalOperatorSource: source("server/services/products/canonicalPbv2OptionConfigurationOperations.ts"), classification: "shared_canonical_today", notes: "Defaults are validated against choice values; set_option_default is compatibility-only and translates to the shared operation." },
  { id: "products.required", productArea: "Required state", uiSource: source(productRoute, undefined, "PUT /api/products/:productId/pbv2/draft"), normalOperatorSource: source("server/services/products/canonicalPbv2OptionConfigurationOperations.ts"), classification: "shared_canonical_today", notes: "Group and input required state use the same PBV2 DRAFT operation." },
  { id: "products.conditional", productArea: "Conditional rules", uiSource: source(productRoute, undefined, "PUT /api/products/:productId/pbv2/draft"), normalOperatorSource: source("server/services/products/canonicalPbv2OptionConfigurationOperations.ts"), classification: "shared_canonical_today", notes: "Simple node/group/choice visibility uses validated selectionKey and choice-value references; complex nested authoring remains unmigrated." },
  { id: "products.free_form", productArea: "Free-form/text inputs", uiSource: source(productRoute, undefined, "PUT /api/products/:productId/pbv2/draft"), normalOperatorSource: source("server/services/products/canonicalPbv2OptionConfigurationOperations.ts"), classification: "shared_canonical_today", notes: "Text and textarea INPUT nodes, including conditional fields, are shared canonical." },
  { id: "products.proof", productArea: "Proof requirements", uiSource: source(productRoute, undefined, "PATCH /api/products/:id"), normalOperatorSource: source("server/services/products/canonicalProductConfigurationOperations.ts"), classification: "shared_canonical_today", notes: "Existing Product proof requirement is shared canonical." },
  { id: "products.prepress_routing", productArea: "Prepress and production routing", uiSource: source(productRoute, undefined, "PATCH /api/products/:id"), normalOperatorSource: "none", classification: "ui_supported_ai_adapter_missing", notes: "No normal Operator product operation found." },
  { id: "products.lifecycle", productArea: "Active/inactive, draft/publish", uiSource: source(productRoute, undefined, "PBV2 override routes"), normalOperatorSource: "none", classification: "ui_supported_ai_adapter_missing", notes: "Operator capabilities explicitly report product activation disabled." },
  { id: "products.customer_specific", productArea: "Customer-specific availability", uiSource: "unknown", normalOperatorSource: source("server/services/productIntentCompiler/productIntentCanonicalProposal.ts", "unsupportedDetails"), classification: "underlying_support_not_demonstrated", notes: "Proposal contract preserves this as unsupported without poisoning independent supported work." },
  { id: "products.grommet_quantity", productArea: "Exact grommet-count structure", uiSource: "unknown", normalOperatorSource: source("server/services/productIntentCompiler/productIntentCanonicalProposal.ts", "unsupportedDetails"), classification: "underlying_support_not_demonstrated", notes: "Preserved as unresolved; no phrase-specific choice repair remains active." },
] as const satisfies readonly ProductParityInventoryItem[]);

export function renderCapabilityInventoryMarkdown(): string {
  const domains = capabilityInventoryDomainValues.map((domain) => {
    const items = capabilityInventory.filter((item) => item.domain === domain);
    const rows = items.length ? items.map((item) => `| ${item.id} | ${item.mode} | ${item.uiExposure} | ${item.aiExposure} | ${item.commandName ?? item.readToolName ?? "—"} | ${item.permissionRequirement} | ${item.parity} |`).join("\n") : "| — | — | — | — | — | — | — |";
    return `### ${domain}\n\n| Provisional capability | Mode | UI | AI | Tool / command | Permission | Parity |\n|---|---|---|---|---|---|---|\n${rows}`;
  }).join("\n\n");
  const authority = authorizationInventory.map((item) => `| ${item.id} | ${item.appliesTo.join(", ")} | ${item.permissionSource === "none_explicit" ? "none explicit" : item.permissionSource.file} | ${item.finding} |`).join("\n");
  const product = productParityInventory.map((item) => `| ${item.productArea} | ${item.classification} | ${item.notes} |`).join("\n");
  return `# AI Operator capability and authority inventory\n\n> Generated from \`server/services/assistant/capabilityInventory.ts\`. Phase 1 inventory only; it does not register or execute capabilities.\n\n## Scope\n\nThis is a source-backed baseline for the future canonical capability registry. \`unknown\` means the source audit did not establish the fact conclusively.\n\n## Authorization sources\n\n| Source | Applies to | Permission authority | Finding |\n|---|---|---|---|\n${authority}\n\n## Known command-permission mirror gaps\n\n${commandPermissionMetadataGaps.length ? commandPermissionMetadataGaps.map((command) => `- \`${command}\``).join("\n") : "None."}\n\n## Product parity fixture\n\n| Product area | Classification | Notes |\n|---|---|---|\n${product}\n\n## Capability inventory by domain\n\n${domains}\n`;
}

export const knownReadToolNames = assistantToolNameValues;
export const knownLegacyCapabilityCatalog = assistantCapabilityCatalog;

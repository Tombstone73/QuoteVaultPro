import type { OrganizationRole } from "@shared/organizationRoleAuthority";
import { resolveOrganizationRoleAuthority } from "@shared/organizationRoleAuthority";
import { assistantProductionCommandAllowlist } from "./execution/commandRegistry";
import { operatorIndex, type OperatorDomain } from "./operatorIndex";
import { operatorSkillManifests, validateOperatorSkillManifests } from "./operatorSkillManifests";
import { assistantToolRegistry } from "./toolRegistry";
import type { AssistantActorAuthorityContext } from "./actorAuthorityResolver";

export const aiCapabilityEligibilityValues = ["eligible", "ineligible", "hard_denied"] as const;
export type AiCapabilityEligibility = (typeof aiCapabilityEligibilityValues)[number];
export const aiCapabilityDenialReasonValues = [
  "actor_not_authorized", "ai_ineligible", "ai_hard_denied", "tenant_mismatch",
  "capability_not_migrated", "unknown_authority", "exceeds_ai_privilege_ceiling",
] as const;
export type AiCapabilityDenialReason = (typeof aiCapabilityDenialReasonValues)[number];
export type CanonicalCapabilityMode = "read" | "mutation" | "lifecycle" | "administrative";
export type CanonicalCapabilitySource = "read_tool" | "command" | "ui_compatibility" | "security_policy";

export type CanonicalCapabilityDescriptor = {
  id: string;
  domain: OperatorDomain | "security";
  version: "v1";
  purpose: string;
  mode: CanonicalCapabilityMode;
  source: CanonicalCapabilitySource;
  sourceId: string | null;
  inputSchemaReference: string | "not_applicable";
  outputSchemaReference: string | "not_applicable";
  requiredGrant: string | null;
  allowedOrganizationRoles: readonly OrganizationRole[];
  tenantScope: "organization" | "platform";
  confirmation: "not_required" | "go_required";
  idempotency: "not_required" | "server_generated_with_request_hash";
  risk: "low" | "moderate" | "high" | "critical";
  lifecycleValidationReference: string | "not_applicable";
  handlerReference: string | "not_applicable";
  auditReference: string | "not_applicable";
  uiSurfaceReference: string | "unknown";
  aiExposure: "existing" | "not_exposed";
  migrationStatus: "wrapped_existing" | "shared_canonical" | "compatibility_only" | "security_policy";
  canonicalOperationReference: string;
  parityStatus: "shared_canonical" | "ai_specific" | "ui_only_not_migrated" | "security_policy";
  aiEligibility: AiCapabilityEligibility;
  hardDenyReason: string | null;
  skillId: string | null;
};

const allTenantRoles: readonly OrganizationRole[] = ["owner", "admin", "manager", "member", "employee"];
const adminRoles: readonly OrganizationRole[] = ["owner", "admin"];
const operationalRoles: readonly OrganizationRole[] = ["owner", "admin", "manager", "employee"];
const commandCapabilityOverrides: Readonly<Record<string, string>> = {
  "products.rollback_pricing_change_set": "assistant.products.adjust_pricing",
  "products.create_configurable_draft": "assistant.products.create_inactive_draft",
  "products.create_from_canonical_intent": "assistant.products.create_inactive_draft",
};
const sharedPricingCommands = new Set([
  "products.adjust_pricing",
  "products.rollback_pricing_change_set",
  "products.replace_inactive_matrix",
  "products.replace_inactive_quantity_tiers",
]);
const sharedOperationalCommands = new Set([
  "production.intake_line_items", "production.send_to_prepress", "production.update_job_status", "production.add_job_note",
  "fulfillment.create_shipment", "fulfillment.update_shipment_details", "fulfillment.mark_shipped", "fulfillment.create_pickup_ticket", "fulfillment.add_note",
  "customers.create", "customers.update_profile", "customers.update_commercial_terms", "contacts.create", "contacts.update",
  "billing.create_invoice", "billing.update_invoice_draft", "billing.send_invoice", "billing.add_invoice_note",
  "payments.record_manual_payment", "payments.add_payment_note",
]);
function sharedOperationalReference(command: string): string | null {
  if (command.startsWith("production.")) return "CanonicalProductionOperations / CanonicalPrepressOperations";
  if (command.startsWith("fulfillment.")) return "CanonicalFulfillmentOperations / FulfillmentService";
  if (command.startsWith("customers.") || command.startsWith("contacts.")) return "CanonicalCustomerContactOperations";
  if (command.startsWith("billing.")) return "CanonicalInvoiceOperations";
  if (command.startsWith("payments.")) return "CanonicalPaymentOperations";
  return null;
}

function sharedOperationalUiSurface(command: string): string {
  if (command.startsWith("production.")) return "Production board routes";
  if (command.startsWith("fulfillment.")) return "Fulfillment routes";
  if (command.startsWith("customers.") || command.startsWith("contacts.")) return "Customer and Contact routes";
  if (command.startsWith("billing.")) return "Invoice detail and Order billing routes";
  if (command.startsWith("payments.")) return "Invoice manual-payment routes";
  return "unknown";
}

function sharedOperationalCanonicalName(command: string): string {
  if (command === "customers.create") return "customers.create.v1";
  if (command.startsWith("customers.")) return "customers.update.v1";
  if (command === "contacts.create") return "contacts.create.v1";
  if (command === "contacts.update") return "contacts.update.v1";
  if (command === "billing.create_invoice") return "invoice.create_draft_from_order.v1";
  if (command === "billing.update_invoice_draft") return "invoice.update_draft.v1";
  if (command === "billing.send_invoice") return "invoice.mark_sent.v1";
  if (command === "billing.add_invoice_note") return "invoice.add_internal_note.v1";
  if (command === "payments.record_manual_payment") return "payments.record_manual_payment.v1";
  if (command === "payments.add_payment_note") return "payments.add_internal_note.v1";
  if (command === "production.intake_line_items") return "production.intake_line_items.v1";
  if (command === "production.send_to_prepress") return "prepress.return_from_production.v1";
  if (command === "production.update_job_status") return "production.start_job.v1";
  if (command === "production.add_job_note") return "production.add_job_note.v1";
  if (command.startsWith("fulfillment.")) return "fulfillment.update_shipment.v1";
  return "not_applicable";
}

function domainForCommand(command: string): OperatorDomain {
  if (command.startsWith("products.")) return command.includes("pricing") || command.includes("matrix") || command.includes("quantity_tiers") ? "pricing" : "products";
  if (command.startsWith("quotes.")) return "quotes";
  if (command.startsWith("orders.")) return "orders";
  if (command.startsWith("customers.") || command.startsWith("contacts.")) return "customers_contacts";
  if (command.startsWith("production.")) return "production";
  if (command.startsWith("fulfillment.")) return "fulfillment";
  if (command.startsWith("billing.")) return "invoicing";
  return "payments";
}
function skillForDomain(domain: OperatorDomain): string {
  const entry = operatorIndex.find((candidate) => candidate.domain === domain);
  if (!entry) throw new Error(`No Operator Index entry for capability domain: ${domain}`);
  return entry.skillId;
}
function requiredGrantForTool(policy: string): string {
  if (policy === "catalog_read") return "catalog.read";
  if (policy === "finance_read") return "finance.read";
  return "assistant.internal_staff";
}
function allowedRolesForTool(policy: string): readonly OrganizationRole[] {
  return policy === "finance_read" ? adminRoles : allTenantRoles;
}

const readCapabilities: readonly CanonicalCapabilityDescriptor[] = Array.from(assistantToolRegistry.values()).map((tool) => {
  const domain: OperatorDomain = tool.name.startsWith("products.") ? (tool.name.includes("pricing") ? "pricing" : "products")
    : tool.name.startsWith("quotes.") ? "quotes" : tool.name.startsWith("orders.") ? "orders"
    : tool.name.startsWith("customers.") || tool.name.startsWith("analytics.") ? "customers_contacts"
    : tool.name.startsWith("production.") ? "production" : "settings_permissions";
  return {
    id: `capability.read.${tool.name}`, domain, version: "v1", purpose: tool.description, mode: "read",
    source: "read_tool", sourceId: tool.name, inputSchemaReference: "server/services/assistant/toolRegistry.ts:toolMetadata",
    outputSchemaReference: "server/services/assistant/toolRegistry.ts:toolMetadata", requiredGrant: requiredGrantForTool(tool.requiredPermission),
    allowedOrganizationRoles: allowedRolesForTool(tool.requiredPermission), tenantScope: "organization", confirmation: "not_required",
    idempotency: "not_required", risk: tool.dataClassification === "restricted_finance" ? "moderate" : "low",
    lifecycleValidationReference: "not_applicable", handlerReference: "server/services/assistant/assistantToolAdapters.ts",
    auditReference: tool.auditCategory, uiSurfaceReference: "unknown", aiExposure: "existing", migrationStatus: "wrapped_existing",
    canonicalOperationReference: "not_applicable", parityStatus: "ui_only_not_migrated",
    aiEligibility: "eligible", hardDenyReason: null, skillId: skillForDomain(domain),
  };
});

const commandCapabilities: readonly CanonicalCapabilityDescriptor[] = assistantProductionCommandAllowlist.map((command) => {
  const domain = domainForCommand(command);
  const requiredGrant = commandCapabilityOverrides[command] ?? `assistant.${command}`;
  return {
    id: `capability.command.${command}`, domain, version: "v1", purpose: `Reviewed confirmation-bound ${command} command.`, mode: "mutation",
    source: "command", sourceId: command, inputSchemaReference: "server/services/assistant/execution/*Command.ts",
    outputSchemaReference: "server/services/assistant/execution/*Command.ts", requiredGrant,
    allowedOrganizationRoles: command.startsWith("products.") ? adminRoles : operationalRoles,
    tenantScope: "organization", confirmation: "go_required", idempotency: "server_generated_with_request_hash", risk: "high",
    lifecycleValidationReference: command === "products.update_existing_product" ? "CanonicalProductConfigurationOperations + CanonicalPbv2OptionConfigurationOperations + CanonicalProductMaterialOperations" : sharedPricingCommands.has(command) ? "CanonicalProductPricingOperations" : sharedOperationalReference(command) ?? "server/services/assistant/execution/*ExecutionCommand.ts", handlerReference: command === "products.update_existing_product" ? "CanonicalProductConfigurationOperations; CanonicalPbv2OptionConfigurationOperations; CanonicalProductMaterialOperations" : sharedPricingCommands.has(command) ? "CanonicalProductPricingOperations with compatibility command adapter" : sharedOperationalReference(command) ?? "AssistantCommandDefinition.adapter",
    auditReference: "ExecutionPlanningService + canonical domain audit", uiSurfaceReference: command === "products.update_existing_product" ? "Product Editor PATCH /api/products/:id; PUT /api/products/:productId/pbv2/draft" : sharedPricingCommands.has(command) ? "Product Editor PATCH /api/products/:id; PUT /api/products/:productId/pbv2/draft" : sharedOperationalUiSurface(command), aiExposure: "existing",
    migrationStatus: command === "products.update_existing_product" || sharedPricingCommands.has(command) || sharedOperationalCommands.has(command) ? "shared_canonical" : "wrapped_existing",
    canonicalOperationReference: command === "products.update_existing_product" ? "products.update_configuration.v1; products.update_option_configuration.v1; products.update_material_configuration.v1" : command === "products.replace_inactive_matrix" ? "products.replace_pricing_matrix.v1" : command === "products.replace_inactive_quantity_tiers" ? "products.replace_quantity_tiers.v1" : sharedPricingCommands.has(command) ? "products.update_pricing.v1" : sharedOperationalCanonicalName(command),
    parityStatus: command === "products.update_existing_product" || sharedPricingCommands.has(command) || sharedOperationalCommands.has(command) ? "shared_canonical" : "ai_specific",
    aiEligibility: "eligible", hardDenyReason: null, skillId: skillForDomain(domain),
  };
});

const ineligibleCapabilities: readonly CanonicalCapabilityDescriptor[] = [
  { id: "capability.ui.products.activate", domain: "products", version: "v1", purpose: "Activate or publish a product configuration through the Product Editor.", mode: "lifecycle", source: "ui_compatibility", sourceId: "products.activate", inputSchemaReference: "server/routes/products.routes.ts", outputSchemaReference: "unknown", requiredGrant: "products.activate", allowedOrganizationRoles: adminRoles, tenantScope: "organization", confirmation: "not_required", idempotency: "not_required", risk: "high", lifecycleValidationReference: "server/routes/products.routes.ts", handlerReference: "not_applicable", auditReference: "unknown", uiSurfaceReference: "Product Editor", aiExposure: "not_exposed", migrationStatus: "compatibility_only", canonicalOperationReference: "not_applicable", parityStatus: "ui_only_not_migrated", aiEligibility: "ineligible", hardDenyReason: null, skillId: "products.pbv2" },
  { id: "capability.ui.settings.organization_preferences", domain: "settings_permissions", version: "v1", purpose: "Update organization preferences through settings UI.", mode: "administrative", source: "ui_compatibility", sourceId: "organization.preferences.update", inputSchemaReference: "server/routes/organization.routes.ts", outputSchemaReference: "unknown", requiredGrant: "organization.settings.update", allowedOrganizationRoles: adminRoles, tenantScope: "organization", confirmation: "not_required", idempotency: "not_required", risk: "high", lifecycleValidationReference: "not_applicable", handlerReference: "not_applicable", auditReference: "unknown", uiSurfaceReference: "Organization Settings", aiExposure: "not_exposed", migrationStatus: "compatibility_only", canonicalOperationReference: "not_applicable", parityStatus: "ui_only_not_migrated", aiEligibility: "ineligible", hardDenyReason: null, skillId: "settings.permissions" },
];

const hardDeniedCapabilities: readonly CanonicalCapabilityDescriptor[] = [
  ["organization.delete", "Delete an organization and its owned data.", "Owner-only destructive organization action."],
  ["organization.destroy_tenant", "Destroy or tear down a tenant.", "Tenant destruction is never an AI capability."],
  ["organization.transfer_ownership", "Irreversibly transfer or destroy organization ownership.", "Owner-only irreversible organization control."],
  ["platform.developer_operations", "Run developer-only repair, debug, or maintenance operations.", "Developer and internal operations are permanently excluded."],
  ["platform.infrastructure_administration", "Change infrastructure, deployment, environment, or server controls.", "Infrastructure and system administration are permanently excluded."],
  ["platform.cross_tenant_mutation", "Mutate another tenant or platform-wide state.", "Cross-tenant mutation is permanently excluded."],
  ["platform.arbitrary_database_or_api_execution", "Run arbitrary SQL, backend calls, or API execution.", "Arbitrary database and backend execution are permanently excluded."],
].map(([id, purpose, hardDenyReason]) => ({
  id: `capability.hard_deny.${id}`, domain: "security" as const, version: "v1" as const, purpose, mode: "administrative" as const,
  source: "security_policy" as const, sourceId: id, inputSchemaReference: "not_applicable" as const, outputSchemaReference: "not_applicable" as const,
  requiredGrant: null, allowedOrganizationRoles: [] as readonly OrganizationRole[], tenantScope: "platform" as const,
  confirmation: "not_required" as const, idempotency: "not_required" as const, risk: "critical" as const,
  lifecycleValidationReference: "not_applicable" as const, handlerReference: "not_applicable" as const, auditReference: "security_policy" as const,
  uiSurfaceReference: "unknown" as const, aiExposure: "not_exposed" as const, migrationStatus: "security_policy" as const,
  aiEligibility: "hard_denied" as const, hardDenyReason, skillId: null, canonicalOperationReference: "not_applicable" as const, parityStatus: "security_policy" as const,
}));

export const canonicalCapabilityRegistry = Object.freeze([...readCapabilities, ...commandCapabilities, ...ineligibleCapabilities, ...hardDeniedCapabilities] as const);

export function getCanonicalCapability(id: string): CanonicalCapabilityDescriptor | undefined {
  return canonicalCapabilityRegistry.find((capability) => capability.id === id);
}

/** Existing command execution remains owned by the command/GO system. This
 * lookup only enforces the registry's eligibility classification at that
 * reviewed boundary; it does not expose generic capability invocation. */
export function getCanonicalCapabilityForCommand(commandName: string): CanonicalCapabilityDescriptor | undefined {
  return canonicalCapabilityRegistry.find((capability) => capability.source === "command" && capability.sourceId === commandName);
}

export function isAiExecutableCanonicalCapability(capability: CanonicalCapabilityDescriptor | undefined): boolean {
  return capability?.source === "command" && capability.aiEligibility === "eligible" && capability.hardDenyReason === null;
}

export type AiCapabilityDiscoveryInput = {
  authority: AssistantActorAuthorityContext;
  /** Must be supplied by trusted server routing, never model or page context. */
  targetOrganizationId?: string;
};
export type AiCapabilityDiscoveryResult = {
  modelFacing: readonly CanonicalCapabilityDescriptor[];
  diagnostics: readonly { capabilityId: string; available: boolean; reason: AiCapabilityDenialReason | null }[];
};

function availability(capability: CanonicalCapabilityDescriptor, input: AiCapabilityDiscoveryInput): AiCapabilityDenialReason | null {
  if (capability.aiEligibility === "hard_denied") return "ai_hard_denied";
  if (capability.aiEligibility !== "eligible") return "ai_ineligible";
  if (input.targetOrganizationId && input.targetOrganizationId !== input.authority.organizationId) return "tenant_mismatch";
  if (input.authority.status !== "resolved" || !input.authority.organizationRole) return "unknown_authority";
  // Admin capability eligibility is the permanent AI ceiling. A future
  // owner-only/developer grant cannot leak through an eligible descriptor.
  const adminAuthority = resolveOrganizationRoleAuthority("admin");
  if ((capability.requiredGrant && !adminAuthority.grants.includes(capability.requiredGrant)) || !capability.allowedOrganizationRoles.includes("admin")) return "exceeds_ai_privilege_ceiling";
  if (capability.requiredGrant && !input.authority.grants.includes(capability.requiredGrant)) return "actor_not_authorized";
  if (!capability.allowedOrganizationRoles.includes(input.authority.organizationRole as OrganizationRole)) return "actor_not_authorized";
  return null;
}

/** Discovery only. It returns metadata, never handlers, routes, adapters, SQL,
 * or arbitrary execution access. */
export function getCapabilitiesForActor(input: AiCapabilityDiscoveryInput): AiCapabilityDiscoveryResult {
  const diagnostics = canonicalCapabilityRegistry.map((capability) => {
    const reason = availability(capability, input);
    return { capabilityId: capability.id, available: reason === null, reason };
  });
  const availableIds = new Set(diagnostics.filter((item) => item.available).map((item) => item.capabilityId));
  return { modelFacing: canonicalCapabilityRegistry.filter((capability) => availableIds.has(capability.id)), diagnostics };
}

export function validateCanonicalCapabilityRegistry(): void {
  validateOperatorSkillManifests();
  const ids = new Set<string>(); const skills = new Set(operatorSkillManifests.map((manifest) => manifest.skillId));
  for (const capability of canonicalCapabilityRegistry) {
    if (ids.has(capability.id)) throw new Error(`Duplicate canonical capability ID: ${capability.id}`);
    ids.add(capability.id);
    if (capability.skillId && !skills.has(capability.skillId)) throw new Error(`Unknown capability skill: ${capability.skillId}`);
    if (capability.mode === "mutation" && !aiCapabilityEligibilityValues.includes(capability.aiEligibility)) throw new Error(`Mutation capability missing AI eligibility: ${capability.id}`);
    if (capability.aiEligibility === "hard_denied" && !capability.hardDenyReason) throw new Error(`Hard-denied capability missing reason: ${capability.id}`);
    if (capability.aiEligibility === "hard_denied" && capability.aiExposure !== "not_exposed") throw new Error(`Hard-denied capability is exposed: ${capability.id}`);
    if (capability.source === "command" && !assistantProductionCommandAllowlist.includes(capability.sourceId as never)) throw new Error(`Unknown command source: ${capability.id}`);
    if (capability.source === "read_tool" && !assistantToolRegistry.has(capability.sourceId as never)) throw new Error(`Unknown read-tool source: ${capability.id}`);
  }
}

export function renderCanonicalCapabilityRegistryMarkdown(): string {
  const rows = canonicalCapabilityRegistry.map((capability) => `| ${capability.id} | ${capability.domain} | ${capability.mode} | ${capability.source} | ${capability.sourceId ?? "—"} | ${capability.requiredGrant ?? "—"} | ${capability.aiEligibility} | ${capability.hardDenyReason ?? "—"} | ${capability.skillId ?? "—"} | ${capability.migrationStatus} |`).join("\n");
  return `# Canonical AI capability registry\n\n> Generated from \`server/services/assistant/canonicalCapabilityRegistry.ts\`. This is metadata and discovery only; it is not a generic execution API.\n\n## Counts\n\n- Registered: ${canonicalCapabilityRegistry.length}\n- Read: ${canonicalCapabilityRegistry.filter((item) => item.mode === "read").length}\n- Mutation: ${canonicalCapabilityRegistry.filter((item) => item.mode === "mutation").length}\n- Eligible: ${canonicalCapabilityRegistry.filter((item) => item.aiEligibility === "eligible").length}\n- Ineligible: ${canonicalCapabilityRegistry.filter((item) => item.aiEligibility === "ineligible").length}\n- Hard denied: ${canonicalCapabilityRegistry.filter((item) => item.aiEligibility === "hard_denied").length}\n\n## Registry\n\n| Capability ID | Domain | Mode | Source | Existing ID | Required grant | AI eligibility | Hard-deny reason | Operator skill | Migration status |\n|---|---|---|---|---|---|---|---|---|---|\n${rows}\n`;
}
